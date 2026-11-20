import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export type AttendanceDatabase = DatabaseSync;

export type Profile = {
  id: string;
  name: string;
  email: string;
  linkedin: string;
  website: string | null;
  profession: string | null;
};

export type Attendee = Omit<Profile, "email">;

export type Registration = {
  name: string;
  email: string;
  linkedin: string;
  website: string | null;
  profession: string | null;
};

const tokenKinds = ["checkIn", "profile"] as const;

export type TokenKind = (typeof tokenKinds)[number];

export type Tokens = Record<TokenKind, string>;

// An event is an opaque id for one calendar date, so (user_id, date) on
// attendance is also the one-visit-per-person-per-event constraint.
const schema = `
  create table if not exists users (
    id text primary key,
    name text not null check (length(trim(name)) > 0),
    email text not null unique check (email = lower(trim(email))),
    linkedin text not null check (length(trim(linkedin)) > 0),
    website text,
    profession text,
    created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  create table if not exists attendance (
    id text primary key,
    date text not null check (length(date) = 10),
    user_id text not null references users(id) on delete cascade,
    created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    unique (user_id, date)
  );

  create index if not exists attendance_date_idx on attendance (date);

  create table if not exists events (
    id text primary key,
    date text not null unique check (length(date) = 10),
    created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  create table if not exists tokens (
    user_id text not null references users(id) on delete cascade,
    kind text not null check (kind in ('checkIn', 'profile')),
    token text not null,
    digest text not null unique,
    primary key (user_id, kind)
  );
`;

export function openDatabase(filename: string): AttendanceDatabase {
  if (filename !== ":memory:") {
    fs.mkdirSync(path.dirname(path.resolve(filename)), { recursive: true });
  }

  const db = new DatabaseSync(filename);
  db.exec("PRAGMA foreign_keys = ON");
  if (filename !== ":memory:") db.exec("PRAGMA journal_mode = WAL");
  db.exec(schema);
  return db;
}

export function findUserByEmail(db: AttendanceDatabase, email: string): Profile | undefined {
  return db.prepare(`
    select id, name, email, linkedin, website, profession
    from users
    where email = ?
  `).get(email) as Profile | undefined;
}

/**
 * The profile whose token of this kind is `token`. The row is found by the
 * token's SHA-256 digest, so lookup timing says nothing about the token, and
 * the stored token is then compared in constant time.
 */
export function findUserByToken(db: AttendanceDatabase, kind: TokenKind, token: string): Profile | undefined {
  const presented = tokenDigest(token);
  const row = db.prepare(`
    select u.id as id, u.name as name, u.email as email, u.linkedin as linkedin,
           u.website as website, u.profession as profession, t.token as token
    from tokens t
    join users u on u.id = t.user_id
    where t.kind = ? and t.digest = ?
  `).get(kind, presented.toString("hex")) as (Profile & { token: string }) | undefined;
  if (!row || !timingSafeEqual(tokenDigest(row.token), presented)) return undefined;

  return {
    id: row.id,
    name: row.name,
    email: row.email,
    linkedin: row.linkedin,
    website: row.website,
    profession: row.profession,
  };
}

/** The date of an issued event, or undefined when the id was never issued. */
export function findEventDate(db: AttendanceDatabase, id: string): string | undefined {
  const row = db.prepare("select date from events where id = ?").get(id) as { date: string } | undefined;
  return row?.date;
}

/** The event id for a calendar date. A date keeps the id it was first issued. */
export function issueEvent(db: AttendanceDatabase, date: string): string {
  db.prepare(`
    insert into events (id, date)
    values (?, ?)
    on conflict (date) do nothing
  `).run(`evt_${randomBytes(12).toString("base64url")}`, date);
  const row = db.prepare("select id from events where date = ?").get(date) as { id: string };
  return row.id;
}

export function recordAttendance(db: AttendanceDatabase, userId: string, date: string): void {
  db.prepare(`
    insert into attendance (id, date, user_id)
    values (?, ?, ?)
    on conflict (user_id, date) do nothing
  `).run(crypto.randomUUID(), date, userId);
}

/** Checks the email's profile in for `date`, creating the profile first when the email is new. */
export function registerAndAttend(db: AttendanceDatabase, registration: Registration, date: string): Profile {
  db.exec("BEGIN IMMEDIATE");
  try {
    let profile = findUserByEmail(db, registration.email);
    if (!profile) {
      profile = { id: crypto.randomUUID(), ...registration };
      db.prepare(`
        insert into users (id, name, email, linkedin, website, profession)
        values (?, ?, ?, ?, ?, ?)
      `).run(
        profile.id,
        profile.name,
        profile.email,
        profile.linkedin,
        profile.website,
        profile.profession,
      );
    }
    recordAttendance(db, profile.id, date);
    db.exec("COMMIT");
    return profile;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function attendanceSummary(db: AttendanceDatabase, profile: Profile) {
  const rows = db.prepare(`
    select a.date as date, u.id as id, u.name as name, u.linkedin as linkedin,
           u.website as website, u.profession as profession
    from attendance a
    join users u on u.id = a.user_id
    where a.date in (select date from attendance where user_id = ?)
    order by a.date desc, a.rowid asc
  `).all(profile.id) as Array<Attendee & { date: string }>;

  const visits: { date: string; attendees: Attendee[] }[] = [];
  for (const row of rows) {
    const current = visits.at(-1);
    const attendee = {
      id: row.id,
      name: row.name,
      linkedin: row.linkedin,
      website: row.website,
      profession: row.profession,
    };
    if (current?.date === row.date) current.attendees.push(attendee);
    else visits.push({ date: row.date, attendees: [attendee] });
  }

  return { profile, visits, tokens: userTokens(db, profile.id) };
}

/**
 * A person's two tokens. They are minted the first time they are needed, which
 * also covers profiles created before tokens existed, and never change after.
 */
function userTokens(db: AttendanceDatabase, userId: string): Tokens {
  const stored = db.prepare("select kind, token from tokens where user_id = ?")
    .all(userId) as { kind: TokenKind; token: string }[];
  const tokens: Partial<Tokens> = Object.fromEntries(stored.map(({ kind, token }) => [kind, token]));

  for (const kind of tokenKinds) {
    if (tokens[kind]) continue;
    const token = randomBytes(16).toString("base64url");
    db.prepare("insert into tokens (user_id, kind, token, digest) values (?, ?, ?, ?)")
      .run(userId, kind, token, tokenDigest(token).toString("hex"));
    tokens[kind] = token;
  }
  return tokens as Tokens;
}

function tokenDigest(token: string): Buffer {
  return createHash("sha256").update(token).digest();
}
