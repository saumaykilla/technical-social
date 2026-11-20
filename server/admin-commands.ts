// The admin command: `npm run admin -- <command>`, run on the instance.
// It works on the SQLite file directly, so whoever can run it already has the database.
import fs from "node:fs";
import path from "node:path";
import { parseArgs, type ParseArgsConfig } from "node:util";
import { calendarDate, clockTime, eventTimeZone, isCalendarDate } from "./dates.ts";
import {
  backupDatabase,
  changeEmail,
  deleteUser,
  findUserByEmail,
  issueEvent,
  listCheckIns,
  listEventDays,
  listPeople,
  recordAttendance,
  removeAttendance,
  rotateTokens,
  updateProfile,
  userTokens,
  visitDates,
  type AttendanceDatabase,
  type Person,
  type TokenKind,
} from "./db.ts";
import { invalidProfile, normalizedEmail, profileFields } from "./validation.ts";

export type AdminIo = {
  /** Opens the database. Called once a command is known to be well-formed. */
  open(): AttendanceDatabase;
  /** The database file, which a backup is written next to when no file is named. */
  databasePath: string;
  out(line: string): void;
  err(line: string): void;
  /** Asks a yes-or-no question. False when the answer is no or there is nobody to ask. */
  confirm(question: string): Promise<boolean>;
  now(): Date;
};

/** A failure the admin can act on. Its message is printed without a stack trace. */
export class AdminError extends Error {}

/** A command that was typed wrong. The command's usage line is printed after the message. */
class UsageError extends AdminError {}

type Value = string | number | null | undefined;
type Flags = Record<string, string | boolean | (string | boolean)[] | undefined>;
type Context = { db: AttendanceDatabase; io: AdminIo; timeZone: string; today: string };
type Command = {
  group: "Events" | "Attendance" | "People" | "Database";
  usage: string;
  summary: string;
  maxArguments: number;
  options?: NonNullable<ParseArgsConfig["options"]>;
  run(context: Context, args: string[], flags: Flags): void | Promise<void>;
};

const yes = { yes: { type: "boolean" } } as const;
const csvFlag = { csv: { type: "boolean" } } as const;
const editable = ["name", "email", "linkedin", "website", "profession"] as const;
const rotations: Record<string, { kinds: TokenKind[]; label: string }> = {
  checkin: { kinds: ["checkIn"], label: "check-in code" },
  profile: { kinds: ["profile"], label: "profile code" },
  both: { kinds: ["checkIn", "profile"], label: "check-in and profile codes" },
};

const commands: Record<string, Command> = {
  events: {
    group: "Events",
    usage: "events",
    summary: "List event dates and door codes",
    maxArguments: 0,
    run({ db, io }) {
      const days = listEventDays(db);
      if (days.length === 0) return io.out("No events yet.");
      table(io, ["DATE", "CHECKED IN", "FIRST TIME", "DOOR CODE"], days.map((day) => [
        day.date,
        day.attendees,
        day.firstTimers,
        day.id,
      ]));
    },
  },

  event: {
    group: "Events",
    usage: "event [date]",
    summary: "Print or issue a date's door code",
    maxArguments: 1,
    run({ db, io, today }, [date]) {
      const day = dateOr(today, date);
      io.err(`Event id for ${day}:`);
      io.out(issueEvent(db, day));
    },
  },

  attendees: {
    group: "Attendance",
    usage: "attendees [date] [--csv]",
    summary: "List who checked in, in arrival order",
    maxArguments: 1,
    options: csvFlag,
    run({ db, io, timeZone, today }, [date], flags) {
      const day = dateOr(today, date);
      const people = listCheckIns(db, day);
      if (flags.csv) {
        return csv(
          io,
          ["name", "email", "linkedin", "website", "profession", "visits", "first_time", "checked_in_at"],
          people.map((person) => [
            person.name,
            person.email,
            person.linkedin,
            person.website,
            person.profession,
            person.visitCount,
            person.firstTime ? "yes" : "no",
            person.checkedInAt,
          ]),
        );
      }
      if (people.length === 0) return io.out(`Nobody is checked in on ${day}.`);

      const firstTimers = people.filter((person) => person.firstTime).length;
      io.out(`${day}: ${people.length} checked in, ${firstTimers} for the first time`);
      io.out("");
      table(io, ["TIME", "NAME", "EMAIL", "PROFESSION", "VISITS", "FIRST TIME"], people.map((person) => [
        clockTime(new Date(person.checkedInAt), timeZone),
        person.name,
        person.email,
        person.profession,
        person.visitCount,
        person.firstTime ? "yes" : "",
      ]));
    },
  },

  checkin: {
    group: "Attendance",
    usage: "checkin <email> [date]",
    summary: "Record a visit",
    maxArguments: 2,
    run({ db, io, today }, [email, date]) {
      const person = findPerson(db, email);
      const day = dateOr(today, date);
      io.out(
        recordAttendance(db, person.id, day)
          ? `Checked ${label(person)} in for ${day}.`
          : `${label(person)} was already checked in for ${day}.`,
      );
    },
  },

  uncheck: {
    group: "Attendance",
    usage: "uncheck <email> [date]",
    summary: "Remove a visit",
    maxArguments: 2,
    run({ db, io, today }, [email, date]) {
      const person = findPerson(db, email);
      const day = dateOr(today, date);
      if (!removeAttendance(db, person.id, day)) throw new AdminError(`${label(person)} has no visit on ${day}.`);
      io.out(`Removed the visit on ${day} for ${label(person)}.`);
    },
  },

  people: {
    group: "People",
    usage: "people [search] [--csv]",
    summary: "List or search profiles",
    maxArguments: 1,
    options: csvFlag,
    run({ db, io }, [search = ""], flags) {
      const needle = search.trim().toLowerCase();
      const people = listPeople(db).filter((person) =>
        [person.name, person.email, person.profession ?? ""].some((text) => text.toLowerCase().includes(needle)));
      if (flags.csv) {
        return csv(
          io,
          ["name", "email", "linkedin", "website", "profession", "visits", "last_visit", "created_at"],
          people.map((person) => [
            person.name,
            person.email,
            person.linkedin,
            person.website,
            person.profession,
            person.visitCount,
            person.lastVisit,
            person.createdAt,
          ]),
        );
      }
      if (people.length === 0) return io.out(needle ? `No profile matches "${printable(search)}".` : "No profiles yet.");

      io.out(`${people.length} ${people.length === 1 ? "profile" : "profiles"}`);
      io.out("");
      table(io, ["NAME", "EMAIL", "PROFESSION", "VISITS", "LAST VISIT"], people.map((person) => [
        person.name,
        person.email,
        person.profession,
        person.visitCount,
        person.lastVisit,
      ]));
    },
  },

  show: {
    group: "People",
    usage: "show <email>",
    summary: "Show a profile, its visits and tokens",
    maxArguments: 1,
    run({ db, io }, [email]) {
      const person = findPerson(db, email);
      const dates = visitDates(db, person.id);
      const tokens = userTokens(db, person.id);
      const rows: [string, Value][] = [
        ["Name", person.name],
        ["Email", person.email],
        ["LinkedIn", person.linkedin],
        ["Website", person.website],
        ["Profession", person.profession],
        ["Id", person.id],
        ["Created", person.createdAt],
        [`Visits (${dates.length})`, dates.join(", ") || null],
        ["Check-in token", tokens.checkIn],
        ["Profile token", tokens.profile],
      ];
      const width = Math.max(...rows.map(([name]) => name.length)) + 1;
      for (const [name, value] of rows) io.out(`${`${name}:`.padEnd(width)} ${printable(value)}`);
    },
  },

  edit: {
    group: "People",
    usage: "edit <email> --<field> <value> ...",
    summary: "Change profile fields",
    maxArguments: 1,
    options: Object.fromEntries(editable.map((field) => [field, { type: "string" } as const])),
    run({ db, io }, [email], flags) {
      const person = findPerson(db, email);
      const given = editable.filter((field) => typeof flags[field] === "string");
      if (given.length === 0) {
        throw new UsageError(`Nothing to change. Pass at least one of ${editable.map((field) => `--${field}`).join(", ")}.`);
      }

      const next = profileFields({ ...person, ...Object.fromEntries(given.map((field) => [field, flags[field]])) });
      if (!next) throw new AdminError(invalidProfile);
      const changed = editable.filter((field) => next[field] !== person[field]);
      if (changed.length === 0) return io.out(`${label(person)} already has those values.`);

      if (next.email !== person.email) {
        const owner = findUserByEmail(db, next.email);
        if (owner) throw new AdminError(`${next.email} already belongs to ${printable(owner.name)}.`);
        changeEmail(db, person.id, next.email);
      }
      updateProfile(db, next);

      io.out(`Updated ${label(next)}.`);
      for (const field of changed) io.out(`  ${field}: ${printable(person[field])} -> ${printable(next[field])}`);
    },
  },

  rotate: {
    group: "People",
    usage: "rotate <email> <checkin|profile|both>",
    summary: "Replace a person's saved QR codes",
    maxArguments: 2,
    options: yes,
    async run({ db, io }, [email, which], flags) {
      const person = findPerson(db, email);
      const rotation = which !== undefined && Object.hasOwn(rotations, which) ? rotations[which] : undefined;
      if (!rotation) throw new UsageError("Say which code to rotate: checkin, profile, or both.");

      await confirmed(io, flags, `Rotate the ${rotation.label} for ${label(person)}? What they saved will stop working.`);
      rotateTokens(db, person.id, rotation.kinds);
      io.out(`Rotated the ${rotation.label} for ${label(person)}. Their attendee list shows the new QR.`);
    },
  },

  delete: {
    group: "People",
    usage: "delete <email>",
    summary: "Delete a profile, its visits and tokens",
    maxArguments: 1,
    options: yes,
    async run({ db, io }, [email], flags) {
      const person = findPerson(db, email);
      const visits = `${person.visitCount} ${person.visitCount === 1 ? "visit" : "visits"}`;
      await confirmed(io, flags, `Delete ${label(person)} and their ${visits}? This cannot be undone.`);
      deleteUser(db, person.id);
      io.out(`Deleted ${label(person)} and their ${visits}.`);
    },
  },

  backup: {
    group: "Database",
    usage: "backup [file]",
    summary: "Copy the database while the API runs",
    maxArguments: 1,
    run({ db, io }, [file = defaultBackupPath(io.databasePath, io.now())]) {
      if (fs.existsSync(file)) throw new AdminError(`${file} already exists.`);
      fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
      backupDatabase(db, file);
      io.out(`Backup written to ${file}`);
    },
  },
};

/** Runs one admin command and returns the process exit code. */
export async function runAdmin(argv: string[], io: AdminIo): Promise<number> {
  const [name, ...rest] = argv;
  if (name === undefined || ["help", "--help", "-h"].includes(name)) {
    io.out(help());
    return 0;
  }
  if (!Object.hasOwn(commands, name)) {
    io.err(`Unknown command "${printable(name)}".`);
    io.err("");
    io.err(help());
    return 1;
  }

  const command = commands[name];
  try {
    const { values, positionals } = parseArgs({
      args: rest,
      options: command.options ?? {},
      allowPositionals: true,
      strict: true,
    });
    if (positionals.length > command.maxArguments) throw new UsageError("Too many arguments.");

    const timeZone = eventTimeZone();
    const today = calendarDate(io.now(), timeZone);
    await command.run({ db: io.open(), io, timeZone, today }, positionals, values);
    return 0;
  } catch (error) {
    if (!(error instanceof AdminError) && !isParseError(error)) throw error;
    io.err(error.message);
    if (!(error instanceof AdminError) || error instanceof UsageError) {
      io.err(`Usage: npm run admin -- ${command.usage}`);
    }
    return 1;
  }
}

function help(): string {
  const width = Math.max(...Object.values(commands).map((command) => command.usage.length));
  const lines = [
    "Admin commands for the attendance database.",
    "Run them on the instance, from the API's directory:",
    "",
    "  npm run admin -- <command>",
  ];
  for (const group of ["Events", "Attendance", "People", "Database"] as const) {
    lines.push("", group);
    for (const command of Object.values(commands)) {
      if (command.group === group) lines.push(`  ${command.usage.padEnd(width)}  ${command.summary}`);
    }
  }
  lines.push(
    "",
    "A date is YYYY-MM-DD and defaults to today.",
    "search matches part of a name, email, or profession.",
    `edit takes ${editable.map((field) => `--${field}`).join(", ")}.`,
    'Pass "" to clear the website or profession.',
    "rotate and delete ask first. Add --yes to skip the question.",
    "backup writes next to the database unless a file is named.",
  );
  return lines.join("\n");
}

function isParseError(error: unknown): error is TypeError {
  return error instanceof TypeError && String((error as { code?: unknown }).code).startsWith("ERR_PARSE_ARGS_");
}

function findPerson(db: AttendanceDatabase, value: string | undefined): Person {
  if (value === undefined) throw new UsageError("Say whose profile, by email.");
  const email = normalizedEmail(value);
  if (!email) throw new AdminError(`"${printable(value)}" is not an email address.`);
  const person = listPeople(db).find((entry) => entry.email === email);
  if (!person) throw new AdminError(`No profile for ${email}.`);
  return person;
}

function dateOr(today: string, value: string | undefined): string {
  if (value === undefined) return today;
  if (!isCalendarDate(value)) throw new UsageError(`"${printable(value)}" is not a date. Use YYYY-MM-DD.`);
  return value;
}

async function confirmed(io: AdminIo, flags: Flags, question: string): Promise<void> {
  if (flags.yes) return;
  if (!(await io.confirm(question))) throw new AdminError("Nothing changed.");
}

function defaultBackupPath(databasePath: string, now: Date): string {
  const { dir, name } = path.parse(databasePath);
  const stamp = `${now.toISOString().slice(0, 19).replaceAll(":", "")}Z`;
  return path.join(dir, `${name}-backup-${stamp}.sqlite`);
}

function label(person: { name: string; email: string }): string {
  return `${printable(person.name)} <${person.email}>`;
}

/**
 * Text for the terminal. Names and professions are typed by attendees, so
 * control characters are dropped before they can reach the admin's terminal.
 */
function printable(value: Value): string {
  if (value === null || value === undefined) return "-";
  return String(value).replace(/[\u0000-\u001f\u007f-\u009f]/g, " ");
}

function table(io: AdminIo, headers: string[], rows: Value[][]): void {
  const cells = [headers, ...rows.map((row) => row.map(printable))];
  const widths = headers.map((_, column) => Math.max(...cells.map((row) => row[column].length)));
  for (const row of cells) {
    io.out(row.map((cell, column) => cell.padEnd(widths[column])).join("  ").trimEnd());
  }
}

function csv(io: AdminIo, headers: string[], rows: Value[][]): void {
  for (const row of [headers, ...rows]) io.out(row.map(csvCell).join(","));
}

/**
 * One CSV field. Text that a spreadsheet would run as a formula gets a leading
 * apostrophe, because these values are typed by attendees.
 */
function csvCell(value: Value): string {
  if (value === null || value === undefined) return "";
  let text = String(value);
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}
