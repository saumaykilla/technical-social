import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { runAdmin } from "./admin-commands.ts";
import {
  attendanceSummary,
  findUserByEmail,
  findUserByToken,
  openDatabase,
  recordAttendance,
  registerAndAttend,
  type AttendanceDatabase,
} from "./db.ts";

// The tests assume the default zone, whatever the shell running them has set.
delete process.env.EVENT_TIME_ZONE;

const ada = {
  email: "ada@example.com",
  name: "Ada Lovelace",
  linkedin: "https://www.linkedin.com/in/ada",
  website: "https://ada.example",
  profession: "Engineer",
};
const grace = {
  email: "grace@example.com",
  name: "Grace Hopper",
  linkedin: "https://www.linkedin.com/in/grace",
  website: null,
  profession: null,
};

/** Ada attended November 6 and 20. Grace attended November 20, which the clock says is today. */
function seeded() {
  const db = openDatabase(":memory:");
  registerAndAttend(db, ada, "2026-11-06");
  registerAndAttend(db, ada, "2026-11-20");
  registerAndAttend(db, grace, "2026-11-20");

  let answer = false;
  const questions: string[] = [];
  async function admin(...argv: string[]) {
    const out: string[] = [];
    const err: string[] = [];
    const code = await runAdmin(argv, {
      databasePath: "data/attendance.sqlite",
      open: () => db,
      out: (line) => out.push(line),
      err: (line) => err.push(line),
      confirm: async (question) => {
        questions.push(question);
        return answer;
      },
      // 8 PM on November 20 in New York, which is already November 21 in UTC.
      now: () => new Date("2026-11-21T01:00:00.000Z"),
    });
    return { code, out: out.join("\n"), err: err.join("\n") };
  }
  return { db, admin, questions, answerYes: () => { answer = true; } };
}

function count(db: AttendanceDatabase, table: "users" | "attendance" | "tokens") {
  return (db.prepare(`select count(*) as total from ${table}`).get() as { total: number }).total;
}

function rows(output: string) {
  return output.split("\n").map((line) => line.split(/ {2,}/));
}

function temporaryDirectory(t: TestContext) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "attendance-admin-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test("help lists every command, and an unknown command fails with the list", async () => {
  const { admin } = seeded();

  for (const argv of [[], ["help"], ["--help"]]) {
    const { code, out } = await admin(...argv);
    assert.equal(code, 0);
    for (const name of ["events", "event", "attendees", "checkin", "uncheck", "people", "show", "edit", "rotate", "delete", "backup"]) {
      assert.match(out, new RegExp(`^  ${name}\\b`, "m"), name);
    }
  }

  const unknown = await admin("drop-everything");
  assert.equal(unknown.code, 1);
  assert.equal(unknown.out, "");
  assert.match(unknown.err, /^Unknown command "drop-everything"\./);

  const inherited = await admin("constructor");
  assert.equal(inherited.code, 1);
});

test("a mistyped command names the problem and shows its usage, without touching the database", async () => {
  const { admin } = seeded();
  const neverOpened = () => assert.fail("the database was opened");

  for (const [argv, message] of [
    [["attendees", "--cvs"], /Unknown option '--cvs'/],
    [["attendees", "2026-11-20", "extra"], /Too many arguments\./],
  ] as const) {
    const err: string[] = [];
    const code = await runAdmin([...argv], {
      databasePath: "",
      open: neverOpened,
      out: () => {},
      err: (line) => err.push(line),
      confirm: async () => false,
      now: () => new Date(),
    });
    assert.equal(code, 1);
    assert.match(err[0], message);
    assert.equal(err[1], "Usage: npm run admin -- attendees [date] [--csv]");
  }

  for (const argv of [["attendees", "20-11-2026"], ["checkin", "ada@example.com", "2026-02-31"], ["show"]]) {
    const { code, err } = await admin(...argv);
    assert.equal(code, 1, argv.join(" "));
    assert.match(err, /\nUsage: npm run admin -- /);
  }
});

test("events lists each date with its attendance, first-timers, and door code", async () => {
  const { admin } = seeded();
  const issued = await admin("event", "2026-12-04");

  const { code, out } = await admin("events");

  assert.equal(code, 0);
  assert.deepEqual(rows(out), [
    ["DATE", "TIME", "NAME", "VENUE", "CHECKED IN", "FIRST TIME", "DOOR CODE"],
    ["2026-12-04", "-", "-", "-", "0", "0", issued.out],
    ["2026-11-20", "-", "-", "-", "2", "1", "-"],
    ["2026-11-06", "-", "-", "-", "1", "1", "-"],
  ]);
});

test("event saves a name, venue, and time for its date and lists them", async () => {
  const { db, admin } = seeded();

  const saved = await admin("event", "--name", "Friday Meetup", "--venue", "The Malt House", "--time", "18:30");

  assert.equal(saved.code, 0);
  assert.match(saved.out, /^evt_[A-Za-z0-9_-]{16}$/);
  assert.equal(
    saved.err,
    "Event id for 2026-11-20:\nName: Friday Meetup\nVenue: The Malt House\nTime: 18:30",
  );
  const listed = rows((await admin("events")).out);
  assert.deepEqual(listed[1], ["2026-11-20", "18:30", "Friday Meetup", "The Malt House", "2", "1", saved.out]);
  assert.deepEqual(listed[2].slice(1, 4), ["-", "-", "-"]);

  // Only the parts that are given change, and an empty one clears it. The door code stays.
  const venue = await admin("event", "2026-11-20", "--venue", "The Irish American Pub", "--time", "");
  assert.equal(venue.out, saved.out);
  assert.equal(venue.err, "Event id for 2026-11-20:\nName: Friday Meetup\nVenue: The Irish American Pub\nTime: -");
  assert.deepEqual(
    { ...(db.prepare("select name, venue, starts_at from events where date = '2026-11-20'").get() as object) },
    { name: "Friday Meetup", venue: "The Irish American Pub", starts_at: null },
  );
});

test("event refuses a time that is not 24-hour HH:MM, or text that is too long, and saves nothing", async () => {
  const { db, admin } = seeded();

  for (const time of ["6:30 PM", "24:00", "18:60", "1830"]) {
    const { code, err } = await admin("event", "--name", "Nope", "--time", time);
    assert.equal(code, 1, time);
    assert.match(err, /is not a time\. Use 24-hour HH:MM/);
  }
  const long = await admin("event", "--venue", "x".repeat(101));
  assert.equal(long.code, 1);
  assert.match(long.err, /venue to 100 characters or fewer/);
  assert.equal((db.prepare("select count(*) as total from events").get() as { total: number }).total, 0);
});

test("event prints the door code for today in New York or for a given date, and keeps it", async () => {
  const { db, admin } = seeded();

  const today = await admin("event");
  assert.equal(today.code, 0);
  assert.match(today.out, /^evt_[A-Za-z0-9_-]{16}$/);
  assert.equal(today.err, "Event id for 2026-11-20:");
  assert.equal((await admin("event")).out, today.out);
  assert.equal((await admin("event", "2026-11-20")).out, today.out);

  const later = await admin("event", "2026-12-04");
  assert.notEqual(later.out, today.out);
  assert.deepEqual(
    db.prepare("select id, date from events order by date").all().map((row) => ({ ...(row as object) })),
    [{ id: today.out, date: "2026-11-20" }, { id: later.out, date: "2026-12-04" }],
  );
});

test("attendees lists a date in arrival order with emails, visit counts, and first-timers", async () => {
  const { db, admin } = seeded();
  db.prepare("update attendance set created_at = '2026-11-20T23:05:00.000Z' where date = '2026-11-20' and user_id = ?")
    .run(findUserByEmail(db, ada.email)!.id);
  db.prepare("update attendance set created_at = '2026-11-21T00:40:00.000Z' where date = '2026-11-20' and user_id = ?")
    .run(findUserByEmail(db, grace.email)!.id);

  const today = await admin("attendees");
  assert.equal(today.code, 0);
  assert.deepEqual(rows(today.out), [
    ["2026-11-20: 2 checked in, 1 for the first time"],
    [""],
    ["TIME", "NAME", "EMAIL", "PROFESSION", "VISITS", "FIRST TIME"],
    ["18:05", "Ada Lovelace", "ada@example.com", "Engineer", "2"],
    ["19:40", "Grace Hopper", "grace@example.com", "-", "1", "yes"],
  ]);

  const earlier = await admin("attendees", "2026-11-06");
  assert.match(earlier.out, /^2026-11-06: 1 checked in, 1 for the first time\n/);
  assert.match(earlier.out, /Ada Lovelace +ada@example\.com +Engineer +2 +yes$/);

  const empty = await admin("attendees", "2026-01-01");
  assert.equal(empty.code, 0);
  assert.equal(empty.out, "Nobody is checked in on 2026-01-01.");
});

test("csv exports quote their fields and defuse spreadsheet formulas", async () => {
  const { db, admin } = seeded();
  registerAndAttend(db, {
    email: "mallory@example.com",
    name: '=HYPERLINK("https://evil.example","Click")',
    linkedin: "https://www.linkedin.com/in/mallory",
    website: null,
    profession: "Sales, Marketing",
  }, "2026-11-20");

  const attendees = await admin("attendees", "--csv");
  const lines = attendees.out.split("\n");
  assert.equal(lines[0], "name,email,linkedin,website,profession,visits,first_time,checked_in_at");
  assert.match(lines[1], /^Ada Lovelace,ada@example\.com,https:\/\/www\.linkedin\.com\/in\/ada,https:\/\/ada\.example,Engineer,2,no,2026-/);
  assert.match(lines[2], /^Grace Hopper,grace@example\.com,https:\/\/www\.linkedin\.com\/in\/grace,,,1,yes,2026-/);
  assert.match(lines[3], /^"'=HYPERLINK\(""https:\/\/evil\.example"",""Click""\)",mallory@example\.com,[^,]+,,"Sales, Marketing",1,yes,/);
  assert.equal(lines.length, 4);

  const people = await admin("people", "--csv");
  assert.equal(people.out.split("\n")[0], "name,email,linkedin,website,profession,visits,last_visit,created_at");
  assert.equal(people.out.split("\n").length, 4);

  const nobody = await admin("attendees", "2026-01-01", "--csv");
  assert.equal(nobody.out, "name,email,linkedin,website,profession,visits,first_time,checked_in_at");
});

test("control characters typed into a profile never reach the terminal", async () => {
  const { db, admin } = seeded();
  registerAndAttend(db, {
    email: "eve@example.com",
    name: "Eve\u001b[2J\u001b]0;owned\u0007",
    linkedin: "https://www.linkedin.com/in/eve",
    website: null,
    profession: "Tester\r\nroot",
  }, "2026-11-20");

  for (const argv of [["attendees"], ["people"], ["show", "eve@example.com"], ["checkin", "eve@example.com"]]) {
    const { out } = await admin(...argv);
    assert.match(out, /Eve/);
    assert.doesNotMatch(out.replaceAll("\n", ""), /[\u0000-\u001f\u007f-\u009f]/, argv.join(" "));
  }
});

test("checkin and uncheck add and remove one visit", async () => {
  const { db, admin } = seeded();

  const added = await admin("checkin", " Grace@Example.com ", "2026-11-06");
  assert.equal(added.code, 0);
  assert.equal(added.out, "Checked Grace Hopper <grace@example.com> in for 2026-11-06.");
  const again = await admin("checkin", "grace@example.com", "2026-11-06");
  assert.equal(again.code, 0);
  assert.equal(again.out, "Grace Hopper <grace@example.com> was already checked in for 2026-11-06.");
  assert.equal(count(db, "attendance"), 4);

  const removed = await admin("uncheck", "grace@example.com");
  assert.equal(removed.code, 0);
  assert.equal(removed.out, "Removed the visit on 2026-11-20 for Grace Hopper <grace@example.com>.");
  const missing = await admin("uncheck", "grace@example.com");
  assert.equal(missing.code, 1);
  assert.equal(missing.err, "Grace Hopper <grace@example.com> has no visit on 2026-11-20.");
  assert.equal(count(db, "attendance"), 3);

  const today = await admin("checkin", "grace@example.com");
  assert.equal(today.out, "Checked Grace Hopper <grace@example.com> in for 2026-11-20.");

  const stranger = await admin("checkin", "nobody@example.com");
  assert.equal(stranger.code, 1);
  assert.equal(stranger.err, "No profile for nobody@example.com.");
  const notAnEmail = await admin("checkin", "grace");
  assert.equal(notAnEmail.code, 1);
  assert.equal(notAnEmail.err, '"grace" is not an email address.');
  assert.equal(count(db, "attendance"), 4);
});

test("people lists profiles by name and filters by name, email, or profession", async () => {
  const { admin } = seeded();

  const all = await admin("people");
  assert.deepEqual(rows(all.out), [
    ["2 profiles"],
    [""],
    ["NAME", "EMAIL", "PROFESSION", "VISITS", "LAST VISIT"],
    ["Ada Lovelace", "ada@example.com", "Engineer", "2", "2026-11-20"],
    ["Grace Hopper", "grace@example.com", "-", "1", "2026-11-20"],
  ]);

  for (const search of ["HOPPER", "grace@", "engineer"]) {
    const { out } = await admin("people", search);
    assert.match(out, /^1 profile\n/, search);
    assert.equal(out.includes("Grace Hopper"), search !== "engineer", search);
  }

  const none = await admin("people", "zzz");
  assert.equal(none.code, 0);
  assert.equal(none.out, 'No profile matches "zzz".');
});

test("show prints a profile with its visits and the tokens the API hands out", async () => {
  const { db, admin } = seeded();
  const profile = findUserByEmail(db, ada.email)!;
  const { tokens } = attendanceSummary(db, profile);

  const { code, out } = await admin("show", "ADA@example.com");

  assert.equal(code, 0);
  assert.deepEqual(out.split("\n").map((line) => line.split(/: +/)).slice(0, 5), [
    ["Name", "Ada Lovelace"],
    ["Email", "ada@example.com"],
    ["LinkedIn", "https://www.linkedin.com/in/ada"],
    ["Website", "https://ada.example"],
    ["Profession", "Engineer"],
  ]);
  assert.match(out, new RegExp(`^Id: +${profile.id}$`, "m"));
  assert.match(out, /^Visits \(2\): +2026-11-20, 2026-11-06$/m);
  assert.match(out, new RegExp(`^Check-in token: +${tokens.checkIn}$`, "m"));
  assert.match(out, new RegExp(`^Profile token: +${tokens.profile}$`, "m"));
});

test("edit changes the fields it is given, including the email, and keeps visits and tokens", async () => {
  const { db, admin } = seeded();
  const before = attendanceSummary(db, findUserByEmail(db, ada.email)!);

  const { code, out } = await admin(
    "edit", "ada@example.com",
    "--name", " Ada King ",
    "--email", "Ada.King@Example.com",
    "--website", "",
    "--profession", "Mathematician",
  );

  assert.equal(code, 0);
  assert.deepEqual(out.split("\n"), [
    "Updated Ada King <ada.king@example.com>.",
    "  name: Ada Lovelace -> Ada King",
    "  email: ada@example.com -> ada.king@example.com",
    "  website: https://ada.example -> -",
    "  profession: Engineer -> Mathematician",
  ]);
  assert.equal(findUserByEmail(db, "ada@example.com"), undefined);
  const after = attendanceSummary(db, findUserByEmail(db, "ada.king@example.com")!);
  assert.deepEqual({ ...after.profile }, {
    id: before.profile.id,
    name: "Ada King",
    email: "ada.king@example.com",
    linkedin: ada.linkedin,
    website: null,
    profession: "Mathematician",
    intro: null,
    tags: [],
  });
  assert.deepEqual(after.tokens, before.tokens);
  assert.deepEqual(after.visits.map((visit) => visit.date), ["2026-11-20", "2026-11-06"]);

  const same = await admin("edit", "ada.king@example.com", "--name", "Ada King");
  assert.equal(same.code, 0);
  assert.equal(same.out, "Ada King <ada.king@example.com> already has those values.");
});

test("edit leaves the intro and topics the attendee chose as they are", async () => {
  const { db, admin } = seeded();
  registerAndAttend(db, {
    email: "hedy@example.com",
    name: "Hedy Lamarr",
    linkedin: "https://www.linkedin.com/in/hedy",
    website: null,
    profession: null,
    intro: "Looking for a cofounder",
    tags: ["llms", "hiring"],
  }, "2026-11-20");

  const { code } = await admin("edit", "hedy@example.com", "--name", "Hedy Kiesler", "--email", "kiesler@example.com");

  assert.equal(code, 0);
  const after = findUserByEmail(db, "kiesler@example.com")!;
  assert.equal(after.name, "Hedy Kiesler");
  assert.equal(after.intro, "Looking for a cofounder");
  assert.deepEqual(after.tags, ["llms", "hiring"]);
});

test("edit refuses values the API would refuse and an email that is taken", async () => {
  const { db, admin } = seeded();
  const before = db.prepare("select * from users order by email").all();

  for (const [argv, message] of [
    [["--name", " "], /^Name, a valid email, and LinkedIn URL are required\./],
    [["--linkedin", "not-a-url"], /^Name, a valid email, and LinkedIn URL are required\./],
    [["--linkedin", ""], /^Name, a valid email, and LinkedIn URL are required\./],
    [["--website", "javascript:alert(1)"], /^Name, a valid email, and LinkedIn URL are required\./],
    [["--email", "not-an-email"], /^Name, a valid email, and LinkedIn URL are required\./],
    [["--email", "GRACE@example.com"], /^grace@example\.com already belongs to Grace Hopper\.$/],
    [[], /^Nothing to change\. Pass at least one of --name, --email, --linkedin, --website, --profession\./],
    [["--nickname", "Countess"], /Unknown option '--nickname'/],
  ] as const) {
    const { code, err } = await admin("edit", "ada@example.com", ...argv);
    assert.equal(code, 1, argv.join(" "));
    assert.match(err, message);
  }
  assert.deepEqual(db.prepare("select * from users order by email").all(), before);
});

test("rotate asks first, then replaces only the code it was told to", async () => {
  const { db, admin, questions, answerYes } = seeded();
  const before = attendanceSummary(db, findUserByEmail(db, ada.email)!).tokens;
  const graceTokens = attendanceSummary(db, findUserByEmail(db, grace.email)!).tokens;

  const declined = await admin("rotate", "ada@example.com", "checkin");
  assert.equal(declined.code, 1);
  assert.equal(declined.err, "Nothing changed.");
  assert.deepEqual(questions, [
    "Rotate the check-in code for Ada Lovelace <ada@example.com>? What they saved will stop working.",
  ]);
  assert.deepEqual(attendanceSummary(db, findUserByEmail(db, ada.email)!).tokens, before);

  answerYes();
  const rotated = await admin("rotate", "ada@example.com", "checkin");
  assert.equal(rotated.code, 0);
  const after = attendanceSummary(db, findUserByEmail(db, ada.email)!).tokens;
  assert.notEqual(after.checkIn, before.checkIn);
  assert.match(after.checkIn, /^[A-Za-z0-9_-]{22}$/);
  assert.equal(after.profile, before.profile);
  assert.equal(findUserByToken(db, "checkIn", before.checkIn), undefined);
  assert.equal(findUserByToken(db, "checkIn", after.checkIn)?.email, "ada@example.com");
  assert.deepEqual(attendanceSummary(db, findUserByEmail(db, grace.email)!).tokens, graceTokens);

  // --yes skips the question, which is what a script without a terminal needs.
  questions.length = 0;
  const both = await admin("rotate", "ada@example.com", "both", "--yes");
  assert.equal(both.code, 0);
  assert.deepEqual(questions, []);
  const last = attendanceSummary(db, findUserByEmail(db, ada.email)!).tokens;
  assert.notEqual(last.checkIn, after.checkIn);
  assert.notEqual(last.profile, after.profile);
  assert.equal(findUserByToken(db, "profile", after.profile), undefined);

  for (const which of [[], ["everything"], ["toString"]]) {
    const { code, err } = await admin("rotate", "ada@example.com", ...which, "--yes");
    assert.equal(code, 1);
    assert.match(err, /^Say which code to rotate: checkin, profile, or both\./);
  }
  assert.deepEqual(attendanceSummary(db, findUserByEmail(db, ada.email)!).tokens, last);
});

test("delete asks first, then removes the profile with its visits and tokens only", async () => {
  const { db, admin, questions, answerYes } = seeded();
  attendanceSummary(db, findUserByEmail(db, ada.email)!);
  attendanceSummary(db, findUserByEmail(db, grace.email)!);

  const declined = await admin("delete", "ada@example.com");
  assert.equal(declined.code, 1);
  assert.equal(declined.err, "Nothing changed.");
  assert.deepEqual(questions, ["Delete Ada Lovelace <ada@example.com> and their 2 visits? This cannot be undone."]);
  assert.equal(count(db, "users"), 2);

  answerYes();
  const deleted = await admin("delete", "ada@example.com");
  assert.equal(deleted.code, 0);
  assert.equal(deleted.out, "Deleted Ada Lovelace <ada@example.com> and their 2 visits.");
  assert.equal(findUserByEmail(db, ada.email), undefined);
  assert.equal(count(db, "users"), 1);
  assert.equal(count(db, "attendance"), 1);
  assert.equal(count(db, "tokens"), 2);
  assert.equal(attendanceSummary(db, findUserByEmail(db, grace.email)!).visits[0].attendees.length, 1);

  const gone = await admin("delete", "ada@example.com", "--yes");
  assert.equal(gone.code, 1);
  assert.equal(gone.err, "No profile for ada@example.com.");
});

test("backup writes a database that opens with the same data and never overwrites a file", async (t) => {
  const { db, admin } = seeded();
  const directory = temporaryDirectory(t);
  const file = path.join(directory, "nested", "copy.sqlite");

  const { code, out } = await admin("backup", file);
  assert.equal(code, 0);
  assert.equal(out, `Backup written to ${file}`);

  recordAttendance(db, findUserByEmail(db, grace.email)!.id, "2026-12-04");
  const copy = openDatabase(file);
  assert.equal(count(copy, "users"), 2);
  assert.equal(count(copy, "attendance"), 3);
  assert.equal(findUserByEmail(copy, ada.email)?.name, "Ada Lovelace");

  const again = await admin("backup", file);
  assert.equal(again.code, 1);
  assert.equal(again.err, `${file} already exists.`);
});

test("backup without a file name goes next to the database, stamped with the time", async (t) => {
  const db = openDatabase(":memory:");
  const directory = temporaryDirectory(t);
  const out: string[] = [];

  const code = await runAdmin(["backup"], {
    databasePath: path.join(directory, "attendance.sqlite"),
    open: () => db,
    out: (line) => out.push(line),
    err: () => {},
    confirm: async () => false,
    now: () => new Date("2026-11-21T01:02:03.456Z"),
  });

  assert.equal(code, 0);
  const file = path.join(directory, "attendance-backup-2026-11-21T010203Z.sqlite");
  assert.deepEqual(out, [`Backup written to ${file}`]);
  assert.equal(fs.existsSync(file), true);
});
