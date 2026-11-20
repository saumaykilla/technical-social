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
| `/api/attendance/register` | `email`, `name`, `linkedin`, optional `website`, `profession`, `event` | Creates the profile and checks it in. An email that already has a profile is checked in as it is. |
| `/api/attendance/redeem` | `token` (a check-in token) | Checks the token's owner in to the open event. `401` for any other token. |
| `/api/attendance/profile` | `token` (a profile token) | Returns the owner's name and links. No email, no visit. `404` for any other token. |

Lookup, register, and redeem return `{ profile, visits, tokens }`. `tokens.checkIn` and `tokens.profile` go into the two personal QR codes.

## Events

An event is one calendar date. The event that is open is today's date, and a request without `event` checks into it.

An event id is the door code. The site puts it in the door QR as `/checkin?event=<id>` and sends it back as `event`. A request with an id is accepted only on that event's date. On any other date, and for an id this API did not issue, the attendee gets a `400` with a message and no visit is recorded. So a door code left over from an earlier event cannot add anyone to that event's list.

The door code is optional. With `NEXT_PUBLIC_CHECKIN_EVENT_TOKEN` unset on the site, the door QR is plain `/checkin` and everyone checks into the open event.

### Before each event with a door code

1. On the instance, print the id for the event's date. This can be done days ahead, and a date always keeps the same id.

   ```sh
   npm run event -- 2026-12-04
   ```

   Without a date it prints the id for today.

2. Set that id as `NEXT_PUBLIC_CHECKIN_EVENT_TOKEN` on the site and redeploy the site. The value is read when the site is built, so changing it without a redeploy does nothing.

3. On the day, scan the door QR and check yourself in. An id from another event or a mistyped one shows an error here instead of your attendee list.

The id lives in the instance's database, so one printed on another machine will not work. A door code stops working at midnight New York time on its date. Personal check-in codes and plain `/checkin` are not tied to an id and keep working.

## Data and behavior

- `users` stores the required name, unique email, and LinkedIn URL, plus optional website and profession.
- `attendance` stores a date and a user ID. A unique constraint prevents duplicate check-ins by the same attendee on one date, so checking in again for the same event returns the same visit.
- `events` stores the id issued for each date.
- `tokens` stores each attendee's check-in token and profile token. They are created the first time the attendee is returned and stay the same after that. To rotate one, delete its row; the next lookup issues a new token and the old one stops working.
- Existing attendees are checked in and receive the attendee list grouped by dates on which they have checked in.
- New registrations insert the user and their first attendance row in one transaction.
- Other attendees' email addresses are not included in the attendee list response.

Typing an email does not prove ownership of that email. Anyone who knows or guesses a registered email can check in as that attendee, see the attendee lists for their visit dates, and receive their tokens. A check-in token checks its owner in and returns the same response, so treat it like the email. A profile token only reveals the owner's name and links.
