# Tech Social Attendance

An event check-in app with a Next.js frontend, a small Express API, and a SQLite database.

The API and the Next.js app are separate packages. Install and run each one from its own directory. The repo root is the API, so `npm install` there does not install React or Next.js.

## Setup

1. Install and start the API from the repo root. It creates `data/attendance.sqlite` on startup. Set `SQLITE_PATH` to store the file somewhere else.

   ```sh
   npm install
   npm run dev
   ```

2. Set `NEXT_PUBLIC_API_URL` in `frontend/.env` to the Express API origin. For local development, use `http://localhost:4000`.

3. Install and start the frontend from `frontend/`:

   ```sh
   cd frontend
   npm install
   npm run dev
   ```

On the EC2 instance, install and run only the API from the repo root. It needs Node.js 22.18 or newer, which can run the TypeScript server directly:

```sh
npm install --omit=dev
npm start
```

The API listens on port `4000` by default. Set `API_PORT` or `API_CORS_ORIGIN` in the root `.env` to change its port or accepted frontend origins. Separate multiple origins with commas. Keep the `data/` directory on the instance; that file is the whole database.

Visit dates follow the calendar in New York, where the meetup is held, so an evening event stays on one date. Set `EVENT_TIME_ZONE` in the root `.env` to use another zone, for example `America/Chicago`. The API refuses to start on a zone name it does not recognize.

## Routes

Every route is a JSON `POST` and answers in JSON. A failure is a non-2xx status with `{ "error": "..." }`.

| Route | Body | Result |
| --- | --- | --- |
| `/api/attendance/lookup` | `email`, optional `event` | Checks the profile in. `404` with `registrationRequired: true` when the email has no profile. |
| `/api/attendance/register` | `email`, `name`, `linkedin`, optional `website`, `profession`, `intro`, `tags`, `event` | Creates the profile and checks it in. An email that already has a profile is checked in as it is, and nothing in the request overwrites it. |
| `/api/attendance/update` | `email`, `name`, `linkedin`, optional `website`, `profession`, `intro`, `tags` | Replaces the name, LinkedIn, website, profession, intro, and topics for that email. An empty `website`, `profession`, or `intro` clears it, and `tags: []` clears the topics. No visit, and the email and tokens stay the same. `404` when the email has no profile. |
| `/api/attendance/redeem` | `token` (a check-in token) | Checks the token's owner in to the open event. `401` for any other token. |
| `/api/attendance/profile` | `token` (a profile token) | Returns the owner's name, links, intro, and topics. No email, no visit. `404` for any other token. |
| `/api/attendance/live` | `email` | Returns `{ visit }`, the open event's list, for the site to poll. `visit` is `null` when that profile is not checked in on the open date. Records no visit and returns no tokens. `400` for an invalid email, `404` when the email has no profile. |

Lookup, register, update, and redeem return `{ profile, visits, tokens, openDate }`. `tokens.checkIn` and `tokens.profile` go into the two personal QR codes. `openDate` is the date of the event that is open right now, so the site can tell tonight's list from the earlier ones.

Each entry in `visits`, and `visit` from `/live`, is `{ date, event, attendees }`. `event` is `{ name, venue, time }`, or `null` when none of the three is set. Any one of them can be `null` on its own, and `time` is 24-hour `HH:MM` (`"18:30"`). The door code is never part of it.

Each attendee in `visits` carries `visitCount`, the number of events that person has attended in all, including events that are not in the response. The site marks someone "First time" when it is exactly 1.

### Intro and topics

Every profile and every attendee row has `intro` and `tags`, also when the person has neither: `intro` is then `null` and `tags` is `[]`.

- `intro` is at most 140 characters, counted after trimming the way the site's `maxLength` counts them. A longer one is a `400`.
- `tags` is an array of topic ids: `ml`, `llms`, `web`, `data`, `hiring`, `job-hunting`. Any other id, or a value that is not an array, is a `400`. Duplicates are dropped and the ids come back in that order.
- On register, a missing `intro` or `tags` stores none.
- On update, a missing `intro` or `tags` key leaves that field as it is stored, so a page loaded before the site knew about them cannot erase them. The site always sends both.

## Events

An event is one calendar date. The event that is open is today's date, and a request without `event` checks into it.

An event id is the door code. The site puts it in the door QR as `/checkin?event=<id>` and sends it back as `event`. A request with an id is accepted only on that event's date. On any other date, and for an id this API did not issue, the attendee gets a `400` with a message and no visit is recorded. So a door code left over from an earlier event cannot add anyone to that event's list.

The door code is optional. With `NEXT_PUBLIC_CHECKIN_EVENT_TOKEN` unset on the site, the door QR is plain `/checkin` and everyone checks into the open event.

### Event details

An event can have a name, a venue, and a start time, which the site shows on that date's list so a visit date is recognizably tonight's meetup. They are set on the instance, per date, and can be set before or after the event. A date with none of them shows only its date.

```sh
npm run admin -- event --name "Friday Meetup" --venue "The Malt House" --time 18:30
npm run admin -- event 2026-12-04 --time 19:00   # another date; only the parts you pass change
npm run admin -- event --venue ""                # an empty value clears that part
```

`--time` is 24-hour `HH:MM`. The name and venue are at most 100 characters. The command prints the date's door code on stdout, as it does without flags, and the stored details on stderr. Setting details on a date also issues its door code, which stays the same afterwards.

A database from before this feature gains the three columns on `events` the next time the API or the admin command opens it. Existing dates have no details.

### Live list

While the listing is open, the site asks `/api/attendance/live` for tonight's list every 15 seconds, so late arrivals and the headcount appear without a reload. It never records a visit. Unlike `lookup`, it also does nothing for someone who is not already on the open date's list, so a phone left open past midnight New York time does not check anyone in to the next day.

### Before each event with a door code

1. On the instance, print the id for the event's date. This can be done days ahead, and a date always keeps the same id.

   ```sh
   npm run event -- 2026-12-04
   ```

   Without a date it prints the id for today.

2. Set that id as `NEXT_PUBLIC_CHECKIN_EVENT_TOKEN` on the site and redeploy the site. The value is read when the site is built, so changing it without a redeploy does nothing.

3. On the day, scan the door QR and check yourself in. An id from another event or a mistyped one shows an error here instead of your attendee list.

The id lives in the instance's database, so one printed on another machine will not work. A door code stops working at midnight New York time on its date. Personal check-in codes and plain `/checkin` are not tied to an id and keep working.

## Admin

`npm run admin` manages the database from an SSH session on the instance. Run it from the repo root there, as the user the API runs as. It reads and writes the SQLite file directly while the API keeps running, so anyone who can run it already has full access to the data. Nothing here is reachable over HTTP.

```sh
npm run admin                                    # list the commands
npm run admin -- events                          # dates, details, attendance, first-timers, door codes
npm run admin -- event 2026-12-04                # same as npm run event -- 2026-12-04
npm run admin -- event 2026-12-04 --name "Friday Meetup" --venue "The Malt House" --time 18:30
npm run admin -- attendees                       # who is checked in today, with emails
npm run admin -- attendees 2026-11-20            # or on another date
npm run admin -- checkin ada@example.com         # check someone in by hand
npm run admin -- uncheck ada@example.com 2026-11-20
npm run admin -- people ada                      # search name, email, or profession
npm run admin -- show ada@example.com            # profile, visit dates, tokens
npm run admin -- edit ada@example.com --name "Ada King" --email king@example.com --website ""
npm run admin -- rotate ada@example.com checkin  # or profile, or both
npm run admin -- delete ada@example.com
npm run admin -- backup                          # data/attendance-backup-<time>.sqlite
```

- `rotate` and `delete` cannot be undone, so they ask before acting. Add `--yes` to skip the question, which a script with no terminal has to do.
- `edit` applies the same rules as the API and is the only way to change an email. Visits and QR codes stay with the profile. It does not show or change the intro and topics.
- `backup` is safe while the API is running. Copying the `.sqlite` file by hand is not, because recent writes may still be in the `-wal` file beside it.
- For a spreadsheet, add `--csv` to `attendees` or `people` and use `npm run -s` so npm prints nothing of its own:

  ```sh
  npm run -s admin -- attendees 2026-11-20 --csv > attendees.csv
  ```

## Data and behavior

- `users` stores the required name, unique email, and LinkedIn URL, plus optional website, profession, intro, and topics. A database created before intros and topics existed gains the two columns the next time the API or the admin command opens it.
- `attendance` stores a date and a user ID. A unique constraint prevents duplicate check-ins by the same attendee on one date, so checking in again for the same event returns the same visit.
- `events` stores the id issued for each date, and the name, venue, and start time (`name`, `venue`, `starts_at`) the admin has set for it.
- `tokens` stores each attendee's check-in token and profile token. They are created the first time the attendee is returned and stay the same after that. To rotate one, use `npm run admin -- rotate`; the old value stops working at once.
- Existing attendees are checked in and receive the attendee list grouped by dates on which they have checked in.
- New registrations insert the user and their first attendance row in one transaction.
- Other attendees' email addresses are not included in the attendee list response.

Typing an email does not prove ownership of that email. Anyone who knows or guesses a registered email can check in as that attendee, see the attendee lists for their visit dates, receive their tokens, and change the name, links, intro, and topics other attendees see for them. A check-in token checks its owner in and returns the same response, so treat it like the email. A profile token only reveals the owner's name and links.
