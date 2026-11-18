import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

export type AttendanceDatabase = Database.Database;

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

export class DuplicateEmailError extends Error {
  constructor() {
    super("That email is already registered.");
    this.name = "DuplicateEmailError";
  }
}

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
`;

export function openDatabase(filename: string): AttendanceDatabase {
  if (filename !== ":memory:") {
    fs.mkdirSync(path.dirname(path.resolve(filename)), { recursive: true });
  }

  const db = new Database(filename);
  db.pragma("foreign_keys = ON");
  if (filename !== ":memory:") db.pragma("journal_mode = WAL");
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

export function findUserById(db: AttendanceDatabase, id: string): Profile | undefined {
  return db.prepare(`
    select id, name, email, linkedin, website, profession
    from users
    where id = ?
  `).get(id) as Profile | undefined;
}

export function recordAttendance(db: AttendanceDatabase, userId: string, date: string): void {
  db.prepare(`
    insert into attendance (id, date, user_id)
    values (?, ?, ?)
    on conflict (user_id, date) do nothing
  `).run(crypto.randomUUID(), date, userId);
}

export function registerAndAttend(db: AttendanceDatabase, registration: Registration, date: string): string {
  const insert = db.transaction(() => {
    const existing = findUserByEmail(db, registration.email);
    if (existing) throw new DuplicateEmailError();

    const id = crypto.randomUUID();
    db.prepare(`
      insert into users (id, name, email, linkedin, website, profession)
      values (?, ?, ?, ?, ?, ?)
    `).run(
      id,
      registration.name,
      registration.email,
      registration.linkedin,
      registration.website,
      registration.profession,
    );
    recordAttendance(db, id, date);
    return id;
  });

  try {
    return insert();
  } catch (error) {
    if (error instanceof DuplicateEmailError) throw error;
    if (error instanceof Database.SqliteError && error.code === "SQLITE_CONSTRAINT_UNIQUE") {
      throw new DuplicateEmailError();
    }
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

  return { profile, visits };
}
