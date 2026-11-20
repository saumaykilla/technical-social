import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Tag } from "./validation.ts";

export type AttendanceDatabase = DatabaseSync;

export type Profile = {
  id: string;
  name: string;
  email: string;
  linkedin: string;
  website: string | null;
  profession: string | null;
  intro: string | null;
  /** Topic ids without duplicates, in the order the site lists them. */
  tags: Tag[];
};

/** A person on a date's list. `visitCount` is how many events they have attended in all. */
export type Attendee = Omit<Profile, "email"> & { visitCount: number };

/**
 * The fields a registration or an edit sets. A registration without `intro`
 * or `tags` stores none. An edit without one keeps what is stored.
 */
export type Registration = {
  name: string;
  email: string;
  linkedin: string;
  website: string | null;
  profession: string | null;
  intro?: string | null;
  tags?: Tag[];
};

/** A profile as its `users` row holds it, with the topics as a JSON array. */
type ProfileRow = Omit<Profile, "tags"> & { tags: string };

const tokenKinds = ["checkIn", "profile"] as const;

export type TokenKind = (typeof tokenKinds)[number];

export type Tokens = Record<TokenKind, string>;

// Columns `users` gained after the first deploy. A database from before then gets them when it is opened.
const laterUserColumns = {
  intro: "text check (length(intro) <= 140)",
  // A JSON array of topic ids.
  tags: "text not null default '[]'",
};

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
    created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    intro ${laterUserColumns.intro},
    tags ${laterUserColumns.tags}
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
  // The API and the admin command write to the same file. Wait for the other one instead of failing.
  db.exec("PRAGMA busy_timeout = 5000");
  if (filename !== ":memory:") db.exec("PRAGMA journal_mode = WAL");
  db.exec(schema);
  addUserColumns(db);
  return db;
}

/** Brings a `users` table created by an earlier version up to the schema. Existing rows get no intro and no topics. */
function addUserColumns(db: AttendanceDatabase): void {
  const missing = () => {
    const present = db.prepare("select name from pragma_table_info('users')").all() as { name: string }[];
    return Object.entries(laterUserColumns).filter(([name]) => !present.some((column) => column.name === name));
  };
  if (missing().length === 0) return;

  // The API and the admin command can open the file at the same moment, so look again once the write lock is held.
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const [name, definition] of missing()) db.exec(`alter table users add column ${name} ${definition}`);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

const profileColumns = `
  u.id as id, u.name as name, u.email as email, u.linkedin as linkedin,
  u.website as website, u.profession as profession, u.intro as intro, u.tags as tags
`;

function profileFromRow(row: ProfileRow): Profile {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    linkedin: row.linkedin,
    website: row.website,
    profession: row.profession,
    intro: row.intro,
    tags: JSON.parse(row.tags) as Tag[],
  };
}

export function findUserByEmail(db: AttendanceDatabase, email: string): Profile | undefined {
  const row = db.prepare(`select ${profileColumns} from users u where u.email = ?`).get(email) as ProfileRow | undefined;
  return row && profileFromRow(row);
}

/**
 * The profile whose token of this kind is `token`. The row is found by the
 * token's SHA-256 digest, so lookup timing says nothing about the token, and
 * the stored token is then compared in constant time.
 */
export function findUserByToken(db: AttendanceDatabase, kind: TokenKind, token: string): Profile | undefined {
  const presented = tokenDigest(token);
  const row = db.prepare(`
    select ${profileColumns}, t.token as token
    from tokens t
    join users u on u.id = t.user_id
    where t.kind = ? and t.digest = ?
  `).get(kind, presented.toString("hex")) as (ProfileRow & { token: string }) | undefined;
  if (!row || !timingSafeEqual(tokenDigest(row.token), presented)) return undefined;

  return profileFromRow(row);
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

/** Records the visit. Returns false when the person was already checked in on that date. */
export function recordAttendance(db: AttendanceDatabase, userId: string, date: string): boolean {
  const { changes } = db.prepare(`
    insert into attendance (id, date, user_id)
    values (?, ?, ?)
    on conflict (user_id, date) do nothing
  `).run(crypto.randomUUID(), date, userId);
  return Number(changes) > 0;
}

/**
 * Checks the email's profile in for `date`, creating the profile first when the email is new.
 * A profile that already exists is returned as it is stored, whatever the registration says.
 */
export function registerAndAttend(db: AttendanceDatabase, registration: Registration, date: string): Profile {
  db.exec("BEGIN IMMEDIATE");
  try {
    let profile = findUserByEmail(db, registration.email);
    if (!profile) {
      profile = {
        id: crypto.randomUUID(),
        name: registration.name,
        email: registration.email,
        linkedin: registration.linkedin,
        website: registration.website,
        profession: registration.profession,
        intro: registration.intro ?? null,
        tags: registration.tags ?? [],
      };
      db.prepare(`
        insert into users (id, name, email, linkedin, website, profession, intro, tags)
        values (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        profile.id,
        profile.name,
        profile.email,
        profile.linkedin,
        profile.website,
        profile.profession,
        profile.intro,
        JSON.stringify(profile.tags),
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

/**
 * Replaces the name, LinkedIn, website, and profession stored for the email,
 * and the intro and topics when the changes include them.
 * Returns the updated profile, or undefined when the email has no profile.
 */
export function updateProfile(db: AttendanceDatabase, changes: Registration): Profile | undefined {
  db.prepare(`
    update users
    set name = ?, linkedin = ?, website = ?, profession = ?,
        intro = case when ? then ? else intro end,
        tags = coalesce(?, tags)
    where email = ?
  `).run(
    changes.name,
    changes.linkedin,
    changes.website,
    changes.profession,
    changes.intro === undefined ? 0 : 1,
    changes.intro ?? null,
    changes.tags ? JSON.stringify(changes.tags) : null,
    changes.email,
  );
  return findUserByEmail(db, changes.email);
}

export function attendanceSummary(db: AttendanceDatabase, profile: Profile) {
  const rows = db.prepare(`
    select a.date as date, ${profileColumns},
           (select count(*) from attendance visits where visits.user_id = u.id) as visitCount
    from attendance a
    join users u on u.id = a.user_id
    where a.date in (select date from attendance where user_id = ?)
    order by a.date desc, a.rowid asc
  `).all(profile.id) as Array<ProfileRow & { date: string; visitCount: number }>;

  const visits: { date: string; attendees: Attendee[] }[] = [];
  for (const row of rows) {
    const current = visits.at(-1);
    // Everyone on the list sees these rows, so the email stays out of them.
    const { email: _email, ...shown } = profileFromRow(row);
    const attendee = { ...shown, visitCount: row.visitCount };
    if (current?.date === row.date) current.attendees.push(attendee);
    else visits.push({ date: row.date, attendees: [attendee] });
  }

  return { profile, visits, tokens: userTokens(db, profile.id) };
}

/**
 * A person's two tokens. They are minted the first time they are needed, which
 * also covers profiles created before tokens existed, and never change after.
 */
export function userTokens(db: AttendanceDatabase, userId: string): Tokens {
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

// Everything below is used only by the admin command, which does not list intros or topics.

type Contact = Omit<Profile, "intro" | "tags">;

export type Person = Contact & {
  createdAt: string;
  visitCount: number;
  lastVisit: string | null;
};

export type CheckIn = Contact & {
  visitCount: number;
  /** 1 when the person had attended no earlier event, otherwise 0. */
  firstTime: number;
  checkedInAt: string;
};

export type EventDay = {
  date: string;
  /** The door code issued for the date, if one was. */
  id: string | null;
  attendees: number;
  /** Attendees whose first event this was. */
  firstTimers: number;
};

/** Every profile, by name. */
export function listPeople(db: AttendanceDatabase): Person[] {
  return db.prepare(`
    select u.id as id, u.name as name, u.email as email, u.linkedin as linkedin,
           u.website as website, u.profession as profession, u.created_at as createdAt,
           (select count(*) from attendance a where a.user_id = u.id) as visitCount,
           (select max(a.date) from attendance a where a.user_id = u.id) as lastVisit
    from users u
    order by lower(u.name), u.email
  `).all() as Person[];
}

/** The people checked in on a date, in the order they arrived. */
export function listCheckIns(db: AttendanceDatabase, date: string): CheckIn[] {
  return db.prepare(`
    select u.id as id, u.name as name, u.email as email, u.linkedin as linkedin,
           u.website as website, u.profession as profession, a.created_at as checkedInAt,
           (select count(*) from attendance visits where visits.user_id = u.id) as visitCount,
           not exists (
             select 1 from attendance earlier
             where earlier.user_id = a.user_id and earlier.date < a.date
           ) as firstTime
    from attendance a
    join users u on u.id = a.user_id
    where a.date = ?
    order by a.rowid
  `).all(date) as CheckIn[];
}

/** Every date that has a door code or a check-in, newest first. */
export function listEventDays(db: AttendanceDatabase): EventDay[] {
  return db.prepare(`
    select d.date as date, e.id as id,
           (select count(*) from attendance a where a.date = d.date) as attendees,
           (select count(*) from attendance a
            where a.date = d.date and not exists (
              select 1 from attendance earlier
              where earlier.user_id = a.user_id and earlier.date < a.date
            )) as firstTimers
    from (select date from events union select date from attendance) d
    left join events e on e.date = d.date
    order by d.date desc
  `).all() as EventDay[];
}

/** The dates a person attended, newest first. */
export function visitDates(db: AttendanceDatabase, userId: string): string[] {
  const rows = db.prepare("select date from attendance where user_id = ? order by date desc")
    .all(userId) as { date: string }[];
  return rows.map((row) => row.date);
}

/** Removes a visit. Returns false when the person had none on that date. */
export function removeAttendance(db: AttendanceDatabase, userId: string, date: string): boolean {
  const { changes } = db.prepare("delete from attendance where user_id = ? and date = ?").run(userId, date);
  return Number(changes) > 0;
}

/** Changes the email a profile is found by. The caller checks that no other profile has it. */
export function changeEmail(db: AttendanceDatabase, userId: string, email: string): void {
  db.prepare("update users set email = ? where id = ?").run(email, userId);
}

/** Replaces the person's tokens of these kinds. The old values stop working at once. */
export function rotateTokens(db: AttendanceDatabase, userId: string, kinds: readonly TokenKind[]): Tokens {
  for (const kind of kinds) {
    db.prepare("delete from tokens where user_id = ? and kind = ?").run(userId, kind);
  }
  return userTokens(db, userId);
}

/** Deletes a profile along with its visits and tokens. */
export function deleteUser(db: AttendanceDatabase, userId: string): void {
  db.prepare("delete from users where id = ?").run(userId);
}

/** Writes a consistent copy of the database to a new file. Safe while the API is running. */
export function backupDatabase(db: AttendanceDatabase, file: string): void {
  db.prepare("vacuum into ?").run(file);
}
