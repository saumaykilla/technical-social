import assert from "node:assert/strict";
import { once } from "node:events";
import test, { type TestContext } from "node:test";
import { createApp } from "./app.ts";
import { issueEvent, openDatabase } from "./db.ts";

// The tests assume the default zone, whatever the shell running them has set.
delete process.env.EVENT_TIME_ZONE;

async function start(t: TestContext, now: () => Date = () => new Date("2026-11-18T15:00:00.000Z")) {
  const db = openDatabase(":memory:");
  const app = createApp(db, now);
  const server = app.listen(0);
  await once(server, "listening");
  t.after(() => server.close());
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Expected a TCP port.");
  return {
    db,
    url: `http://127.0.0.1:${address.port}`,
  };
}

async function post(url: string, path: string, body: unknown) {
  const response = await fetch(`${url}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

function count(db: ReturnType<typeof openDatabase>, table: "users" | "attendance") {
  return (db.prepare(`select count(*) as total from ${table}`).get() as { total: number }).total;
}

function setEnv(t: TestContext, name: string, value: string) {
  const previous = process.env[name];
  process.env[name] = value;
  t.after(() => {
    if (previous === undefined) delete process.env[name];
    else process.env[name] = previous;
  });
}

const registration = {
  email: "Ada@Example.com",
  name: "Ada Lovelace",
  linkedin: "https://www.linkedin.com/in/ada",
  website: "https://ada.example",
  profession: "Engineer",
};

const grace = {
  email: "grace@example.com",
  name: "Grace Hopper",
  linkedin: "https://www.linkedin.com/in/grace",
};

const token = /^[A-Za-z0-9_-]{22}$/;

test("register stores a profile and checks the attendee in for today's date", async (t) => {
  const { url } = await start(t);

  const { status, body } = await post(url, "/api/attendance/register", registration);

  assert.equal(status, 200);
  assert.equal(body.profile.email, "ada@example.com");
  assert.equal(body.profile.name, "Ada Lovelace");
  assert.equal(body.profile.website, "https://ada.example");
  assert.equal(body.profile.profession, "Engineer");
  assert.deepEqual(body.visits, [{
    date: "2026-11-18",
    attendees: [{
      id: body.profile.id,
      name: "Ada Lovelace",
      linkedin: "https://www.linkedin.com/in/ada",
      website: "https://ada.example",
      profession: "Engineer",
      visitCount: 1,
    }],
  }]);
  assert.equal("email" in body.visits[0].attendees[0], false);
});

test("register stores an empty website and profession as null", async (t) => {
  const { url } = await start(t);

  const { status, body } = await post(url, "/api/attendance/register", { ...grace, website: "", profession: "" });

  assert.equal(status, 200);
  assert.equal(body.profile.website, null);
  assert.equal(body.profile.profession, null);
});

test("register returns the existing profile for a known email and rejects an incomplete one", async (t) => {
  const { db, url } = await start(t);

  const created = await post(url, "/api/attendance/register", registration);
  const repeated = await post(url, "/api/attendance/register", { ...registration, name: "Someone Else" });
  assert.equal(repeated.status, 200);
  assert.deepEqual(repeated.body, created.body);
  assert.equal(count(db, "users"), 1);
  assert.equal(count(db, "attendance"), 1);

  const invalid = await post(url, "/api/attendance/register", {
    email: "new@example.com",
    name: "Ada",
    linkedin: "not-a-url",
  });
  assert.equal(invalid.status, 400);
  assert.equal(typeof invalid.body.error, "string");
  assert.equal(count(db, "users"), 1);
});

test("lookup checks an existing attendee in without duplicating the same day", async (t) => {
  let current = new Date("2026-11-18T15:00:00.000Z");
  const { url } = await start(t, () => current);

  await post(url, "/api/attendance/register", registration);
  await post(url, "/api/attendance/register", grace);

  const first = await post(url, "/api/attendance/lookup", { email: " ada@example.com " });
  const second = await post(url, "/api/attendance/lookup", { email: "ada@example.com" });
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(second.body.visits.length, 1);
  assert.equal(second.body.visits[0].attendees.length, 2);
  assert.deepEqual(
    second.body.visits[0].attendees.map((attendee: { name: string }) => attendee.name).sort(),
    ["Ada Lovelace", "Grace Hopper"],
  );
  assert.equal(second.body.visits[0].attendees.every((attendee: object) => !("email" in attendee)), true);

  // 8 PM in New York is already the next day in UTC. It is still the same event.
  current = new Date("2026-11-19T01:00:00.000Z");
  const evening = await post(url, "/api/attendance/lookup", { email: "ada@example.com" });
  assert.deepEqual(evening.body.visits.map((visit: { date: string }) => visit.date), ["2026-11-18"]);

  current = new Date("2026-11-19T23:00:00.000Z");
  const nextDay = await post(url, "/api/attendance/lookup", { email: "ada@example.com" });
  assert.deepEqual(nextDay.body.visits.map((visit: { date: string; attendees: { name: string }[] }) => ({
    date: visit.date,
    names: visit.attendees.map((attendee) => attendee.name),
  })), [
    { date: "2026-11-19", names: ["Ada Lovelace"] },
    { date: "2026-11-18", names: ["Ada Lovelace", "Grace Hopper"] },
  ]);
});

test("allows each origin listed in API_CORS_ORIGIN", async (t) => {
  setEnv(t, "API_CORS_ORIGIN", "https://technicallysocial.org, https://www.technicallysocial.org");
  const { url } = await start(t);

  const response = await fetch(`${url}/health`, {
    headers: { Origin: "https://www.technicallysocial.org" },
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("access-control-allow-origin"), "https://www.technicallysocial.org");

  const preflight = await fetch(`${url}/api/attendance/redeem`, {
    method: "OPTIONS",
    headers: {
      Origin: "https://technicallysocial.org",
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "content-type",
    },
  });
  assert.equal(preflight.headers.get("access-control-allow-origin"), "https://technicallysocial.org");
});

test("lookup reports an unknown email without creating a profile and rejects an invalid one", async (t) => {
  const { db, url } = await start(t);

  const missing = await post(url, "/api/attendance/lookup", { email: "missing@example.com" });
  assert.equal(missing.status, 404);
  assert.deepEqual(missing.body, { error: "Create a profile to check in.", registrationRequired: true });
  assert.equal(count(db, "users"), 0);

  const invalid = await post(url, "/api/attendance/lookup", { email: "not-an-email" });
  assert.equal(invalid.status, 400);
  assert.equal(typeof invalid.body.error, "string");
  assert.equal("registrationRequired" in invalid.body, false);
});

test("register then lookup returns one visit for today and the same two tokens", async (t) => {
  const { url } = await start(t);

  const registered = await post(url, "/api/attendance/register", registration);
  const first = await post(url, "/api/attendance/lookup", { email: "ada@example.com" });
  const second = await post(url, "/api/attendance/lookup", { email: "ada@example.com" });

  assert.equal(first.status, 200);
  assert.deepEqual(first.body.visits.map((visit: { date: string }) => visit.date), ["2026-11-18"]);
  assert.equal(second.body.visits.length, 1);
  assert.match(first.body.tokens.checkIn, token);
  assert.match(first.body.tokens.profile, token);
  assert.notEqual(first.body.tokens.checkIn, first.body.tokens.profile);
  assert.deepEqual(first.body.tokens, registered.body.tokens);
  assert.deepEqual(second.body.tokens, registered.body.tokens);
});

test("visitCount is the number of events a person has attended, not the rows in the response", async (t) => {
  let current = new Date("2026-11-18T15:00:00.000Z");
  const { url } = await start(t, () => current);
  const counts = (body: { visits: { date: string; attendees: { name: string; visitCount: number }[] }[] }) =>
    body.visits.map((visit) => [visit.date, Object.fromEntries(visit.attendees.map((a) => [a.name, a.visitCount]))]);

  await post(url, "/api/attendance/register", registration);
  await post(url, "/api/attendance/register", grace);

  current = new Date("2026-12-02T15:00:00.000Z");
  await post(url, "/api/attendance/lookup", { email: "ada@example.com" });
  const ada = await post(url, "/api/attendance/lookup", { email: "ada@example.com" });
  assert.deepEqual(counts(ada.body), [
    ["2026-12-02", { "Ada Lovelace": 2 }],
    ["2026-11-18", { "Ada Lovelace": 2, "Grace Hopper": 1 }],
  ]);

  // A newcomer's response holds only tonight, where Ada is still on her second event.
  const hedy = await post(url, "/api/attendance/register", {
    email: "hedy@example.com",
    name: "Hedy Lamarr",
    linkedin: "https://www.linkedin.com/in/hedy",
  });
  assert.deepEqual(counts(hedy.body), [["2026-12-02", { "Ada Lovelace": 2, "Hedy Lamarr": 1 }]]);

  const redeemed = await post(url, "/api/attendance/redeem", { token: hedy.body.tokens.checkIn });
  assert.deepEqual(counts(redeemed.body), counts(hedy.body));
});

test("update changes the profile everywhere it is shown and nothing else", async (t) => {
  let current = new Date("2026-11-18T15:00:00.000Z");
  const { db, url } = await start(t, () => current);
  const registered = await post(url, "/api/attendance/register", registration);
  const graceRegistered = await post(url, "/api/attendance/register", grace);

  // A later day: an update must not check anyone in.
  current = new Date("2026-12-02T15:00:00.000Z");
  const { status, body } = await post(url, "/api/attendance/update", {
    email: " ADA@example.com ",
    name: " Ada King ",
    linkedin: "https://www.linkedin.com/in/king",
    website: "",
    profession: "",
    event: "evt_ignored",
  });

  assert.equal(status, 200);
  assert.deepEqual(body.profile, {
    id: registered.body.profile.id,
    name: "Ada King",
    email: "ada@example.com",
    linkedin: "https://www.linkedin.com/in/king",
    website: null,
    profession: null,
  });
  assert.deepEqual(body.tokens, registered.body.tokens);
  assert.deepEqual(body.visits, [{
    date: "2026-11-18",
    attendees: [
      {
        id: registered.body.profile.id,
        name: "Ada King",
        linkedin: "https://www.linkedin.com/in/king",
        website: null,
        profession: null,
        visitCount: 1,
      },
      {
        id: graceRegistered.body.profile.id,
        name: "Grace Hopper",
        linkedin: grace.linkedin,
        website: null,
        profession: null,
        visitCount: 1,
      },
    ],
  }]);
  assert.equal(count(db, "attendance"), 2);
  assert.equal(count(db, "users"), 2);

  // Everyone else sees the new details too.
  const seenByGrace = await post(url, "/api/attendance/lookup", { email: grace.email });
  assert.equal(seenByGrace.body.visits.at(-1).attendees[0].name, "Ada King");
  const scanned = await post(url, "/api/attendance/profile", { token: registered.body.tokens.profile });
  assert.equal(scanned.body.profile.name, "Ada King");
  assert.equal(scanned.body.profile.linkedin, "https://www.linkedin.com/in/king");

  const restored = await post(url, "/api/attendance/update", { ...registration, profession: "Mathematician" });
  assert.equal(restored.body.profile.website, "https://ada.example");
  assert.equal(restored.body.profile.profession, "Mathematician");
});

test("update rejects an unknown email and an incomplete profile without changing anything", async (t) => {
  const { db, url } = await start(t);
  const registered = await post(url, "/api/attendance/register", registration);

  const unknown = await post(url, "/api/attendance/update", { ...grace });
  assert.equal(unknown.status, 404);
  assert.deepEqual(unknown.body, { error: "Check in again to update your profile." });
  assert.equal(count(db, "users"), 1);

  const valid = { email: "ada@example.com", name: "Ada King", linkedin: "https://www.linkedin.com/in/king" };
  const invalid = [
    { ...valid, name: "" },
    { ...valid, name: undefined },
    { ...valid, linkedin: "" },
    { ...valid, linkedin: "not-a-url" },
    { ...valid, linkedin: "javascript:alert(1)" },
    { ...valid, website: "not-a-url" },
    { ...valid, email: "not-an-email" },
    { ...valid, email: undefined },
  ];
  for (const body of invalid) {
    const response = await post(url, "/api/attendance/update", body);
    assert.equal(response.status, 400, JSON.stringify(body));
    assert.equal(typeof response.body.error, "string");
  }

  const after = await post(url, "/api/attendance/lookup", { email: "ada@example.com" });
  assert.deepEqual(after.body, registered.body);
});

test("each person gets their own tokens, including profiles stored before tokens existed", async (t) => {
  const { db, url } = await start(t);
  db.prepare("insert into users (id, name, email, linkedin) values ('legacy', 'Old Timer', 'old@example.com', 'https://www.linkedin.com/in/old')").run();

  const legacy = await post(url, "/api/attendance/lookup", { email: "old@example.com" });
  const ada = await post(url, "/api/attendance/register", registration);

  assert.match(legacy.body.tokens.checkIn, token);
  assert.match(legacy.body.tokens.profile, token);
  const all = [...Object.values(legacy.body.tokens), ...Object.values(ada.body.tokens)];
  assert.equal(new Set(all).size, 4);

  const redeemed = await post(url, "/api/attendance/redeem", { token: legacy.body.tokens.checkIn });
  assert.equal(redeemed.body.profile.id, "legacy");
});

test("redeem checks the token's owner in once and returns their profile with email", async (t) => {
  const { db, url } = await start(t);
  const registered = await post(url, "/api/attendance/register", registration);

  const first = await post(url, "/api/attendance/redeem", { token: registered.body.tokens.checkIn });
  const second = await post(url, "/api/attendance/redeem", { token: registered.body.tokens.checkIn });

  assert.equal(first.status, 200);
  assert.deepEqual(first.body, registered.body);
  assert.equal(first.body.profile.email, "ada@example.com");
  assert.deepEqual(second.body, registered.body);
  assert.equal(count(db, "attendance"), 1);
});

test("redeem checks a returning attendee in to the event that is open now", async (t) => {
  let current = new Date("2026-11-18T15:00:00.000Z");
  const { url } = await start(t, () => current);
  const registered = await post(url, "/api/attendance/register", registration);

  current = new Date("2026-12-02T15:00:00.000Z");
  const redeemed = await post(url, "/api/attendance/redeem", { token: registered.body.tokens.checkIn });

  assert.equal(redeemed.status, 200);
  assert.deepEqual(redeemed.body.visits.map((visit: { date: string }) => visit.date), ["2026-12-02", "2026-11-18"]);
  assert.deepEqual(redeemed.body.tokens, registered.body.tokens);
});

test("profile returns the public fields for a profile token and records no visit", async (t) => {
  let current = new Date("2026-11-18T15:00:00.000Z");
  const { db, url } = await start(t, () => current);
  const registered = await post(url, "/api/attendance/register", registration);

  current = new Date("2026-11-19T15:00:00.000Z");
  const { status, body } = await post(url, "/api/attendance/profile", { token: registered.body.tokens.profile });

  assert.equal(status, 200);
  assert.deepEqual(body, {
    profile: {
      id: registered.body.profile.id,
      name: "Ada Lovelace",
      linkedin: "https://www.linkedin.com/in/ada",
      website: "https://ada.example",
      profession: "Engineer",
    },
  });
  assert.equal(count(db, "attendance"), 1);
});

test("a token only works on its own route", async (t) => {
  const { db, url } = await start(t);
  const { body } = await post(url, "/api/attendance/register", registration);

  const profileAtRedeem = await post(url, "/api/attendance/redeem", { token: body.tokens.profile });
  assert.equal(profileAtRedeem.status, 401);
  assert.deepEqual(profileAtRedeem.body, { error: "This check-in code is invalid or expired." });

  const checkInAtProfile = await post(url, "/api/attendance/profile", { token: body.tokens.checkIn });
  assert.equal(checkInAtProfile.status, 404);
  assert.deepEqual(checkInAtProfile.body, { error: "Profile not found." });

  const unknownRedeem = await post(url, "/api/attendance/redeem", { token: "AAAAAAAAAAAAAAAAAAAAAA" });
  assert.equal(unknownRedeem.status, 401);
  const unknownProfile = await post(url, "/api/attendance/profile", { token: "AAAAAAAAAAAAAAAAAAAAAA" });
  assert.equal(unknownProfile.status, 404);

  for (const path of ["/api/attendance/redeem", "/api/attendance/profile"]) {
    for (const missing of [{}, { token: "" }, { token: 42 }]) {
      const response = await post(url, path, missing);
      assert.equal(response.status, 400, `${path} ${JSON.stringify(missing)}`);
      assert.equal(typeof response.body.error, "string");
    }
  }
  assert.equal(count(db, "attendance"), 1);
});

test("a rotated token stops working", async (t) => {
  const { db, url } = await start(t);
  const { body } = await post(url, "/api/attendance/register", registration);
  db.prepare("delete from tokens where kind = 'checkIn'").run();

  const rotated = await post(url, "/api/attendance/lookup", { email: "ada@example.com" });
  assert.notEqual(rotated.body.tokens.checkIn, body.tokens.checkIn);
  assert.equal(rotated.body.tokens.profile, body.tokens.profile);

  assert.equal((await post(url, "/api/attendance/redeem", { token: body.tokens.checkIn })).status, 401);
  assert.equal((await post(url, "/api/attendance/redeem", { token: rotated.body.tokens.checkIn })).status, 200);
});

test("the open event's id records one visit, the same one as leaving it out", async (t) => {
  const { db, url } = await start(t);
  const tonight = issueEvent(db, "2026-11-18");
  assert.equal(issueEvent(db, "2026-11-18"), tonight);
  assert.notEqual(issueEvent(db, "2026-11-11"), tonight);

  const registered = await post(url, "/api/attendance/register", { ...registration, event: tonight });
  assert.equal(registered.status, 200);
  assert.deepEqual(registered.body.visits.map((visit: { date: string }) => visit.date), ["2026-11-18"]);

  const requests = [
    await post(url, "/api/attendance/lookup", { email: "ada@example.com", event: tonight }),
    await post(url, "/api/attendance/lookup", { email: "ada@example.com" }),
    await post(url, "/api/attendance/lookup", { email: "ada@example.com", event: "" }),
    await post(url, "/api/attendance/register", { ...registration, event: tonight }),
    await post(url, "/api/attendance/redeem", { token: registered.body.tokens.checkIn }),
  ];
  for (const { status, body } of requests) {
    assert.equal(status, 200);
    assert.deepEqual(body, registered.body);
  }
  assert.equal(count(db, "attendance"), 1);
});

test("the id of an event that is not open is refused and records nothing", async (t) => {
  let current = new Date("2026-11-18T15:00:00.000Z");
  const { db, url } = await start(t, () => current);
  const earlier = issueEvent(db, "2026-11-11");
  const tonight = issueEvent(db, "2026-11-18");
  const later = issueEvent(db, "2026-12-02");
  await post(url, "/api/attendance/register", { ...registration, event: tonight });

  const refused = { error: "This check-in link is for a different event. Scan tonight's door code to check in." };
  for (const event of [earlier, later]) {
    const lookup = await post(url, "/api/attendance/lookup", { email: "ada@example.com", event });
    assert.equal(lookup.status, 400);
    assert.deepEqual(lookup.body, refused);

    // A new attendee is told about the link, not sent off to register with it.
    const stranger = await post(url, "/api/attendance/lookup", { email: "grace@example.com", event });
    assert.equal(stranger.status, 400);
    assert.deepEqual(stranger.body, refused);

    const register = await post(url, "/api/attendance/register", { ...grace, event });
    assert.equal(register.status, 400);
    assert.deepEqual(register.body, refused);
  }
  assert.equal(count(db, "users"), 1);
  assert.equal(count(db, "attendance"), 1);

  // On the night of the later event its id opens and tonight's closes.
  current = new Date("2026-12-03T01:00:00.000Z");
  const stale = await post(url, "/api/attendance/lookup", { email: "ada@example.com", event: tonight });
  assert.equal(stale.status, 400);
  assert.deepEqual(stale.body, refused);

  const opened = await post(url, "/api/attendance/lookup", { email: "ada@example.com", event: later });
  assert.equal(opened.status, 200);
  assert.deepEqual(opened.body.visits.map((visit: { date: string }) => visit.date), ["2026-12-02", "2026-11-18"]);
  assert.equal(count(db, "attendance"), 2);
});

test("an unknown event is rejected before anything is stored", async (t) => {
  const { db, url } = await start(t);
  await post(url, "/api/attendance/register", registration);

  for (const event of ["evt_nope", 7]) {
    const lookup = await post(url, "/api/attendance/lookup", { email: "ada@example.com", event });
    assert.equal(lookup.status, 400);
    assert.equal(typeof lookup.body.error, "string");
    assert.equal("registrationRequired" in lookup.body, false);

    const register = await post(url, "/api/attendance/register", { ...grace, event });
    assert.equal(register.status, 400);
    assert.equal(typeof register.body.error, "string");
  }
  assert.equal(count(db, "users"), 1);
  assert.equal(count(db, "attendance"), 1);
});

test("the open event is dated in New York unless EVENT_TIME_ZONE says otherwise", async (t) => {
  // 8 PM on November 20 in New York is already November 21 in UTC.
  const eightPm = () => new Date("2026-11-21T01:00:00.000Z");

  const newYork = await start(t, eightPm);
  const { body } = await post(newYork.url, "/api/attendance/register", registration);
  assert.deepEqual(body.visits.map((visit: { date: string }) => visit.date), ["2026-11-20"]);
  assert.equal(new Date(`${body.visits[0].date}T12:00:00`).getDate(), 20);

  setEnv(t, "EVENT_TIME_ZONE", "UTC");
  const utc = await start(t, eightPm);
  const overridden = await post(utc.url, "/api/attendance/register", registration);
  assert.deepEqual(overridden.body.visits.map((visit: { date: string }) => visit.date), ["2026-11-21"]);

  setEnv(t, "EVENT_TIME_ZONE", "America/New_Yrok");
  assert.throws(() => createApp(openDatabase(":memory:")), RangeError);
});

test("a body that is not JSON is answered in JSON", async (t) => {
  const { url } = await start(t);

  const { status, body } = await post(url, "/api/attendance/lookup", "{ not json");

  assert.equal(status, 400);
  assert.equal(typeof body.error, "string");
});
