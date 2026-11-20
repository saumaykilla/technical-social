// Prints the event id for a calendar date, issuing one the first time.
//   npm run event                 the event open today
//   npm run event -- 2026-12-04   the event on that date
import "dotenv/config";
import { calendarDate, eventTimeZone, isCalendarDate } from "./dates.ts";
import { issueEvent, openDatabase } from "./db.ts";

const date = process.argv[2] ?? calendarDate(new Date(), eventTimeZone());
if (!isCalendarDate(date)) {
  console.error("Usage: npm run event -- [YYYY-MM-DD]");
  process.exit(1);
}

const db = openDatabase(process.env.SQLITE_PATH ?? "data/attendance.sqlite");
console.error(`Event id for ${date}:`);
console.log(issueEvent(db, date));
