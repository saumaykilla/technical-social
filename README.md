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

On the EC2 instance, install and run only the API from the repo root. `tsx` and `better-sqlite3` are runtime dependencies, so `npm install --omit=dev` is enough:

```sh
npm install --omit=dev
npm start
```

The API listens on port `4000` by default. Set `API_PORT` or `API_CORS_ORIGIN` in the root `.env` to change its port or accepted frontend origin. Keep the `data/` directory on the instance; that file is the whole database.

## Data and behavior

- `users` stores the required name, unique email, and LinkedIn URL, plus optional website and profession.
- `attendance` stores a date and a user ID. A unique constraint prevents duplicate check-ins by the same attendee on one date.
- Existing attendees are checked in and receive the attendee list grouped by dates on which they have checked in.
- New registrations insert the user and their first attendance row in one transaction.
- Dates are determined by the API server's current UTC date.
- Other attendees' email addresses are not included in the attendee list response.

Typing an email does not prove ownership of that email. Anyone who knows or guesses a registered email can check in as that attendee and see the attendee lists for their visit dates.
