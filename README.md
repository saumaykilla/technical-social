# Technically Social Attendance

An event check-in app with a Next.js frontend, a small Express API, and Supabase Postgres.

## Setup

1. Create a Supabase project and copy `.env.example` to `.env`.
2. Set `SUPABASE_URL` and the server-only `SUPABASE_SECRET_KEY` in `.env`. Keep this key out of browser code and source control.
3. Set `NEXT_PUBLIC_API_URL` to the Express API origin. For local development, the example uses `http://localhost:4000`.
4. Apply `supabase/migrations/20261114000000_create_attendance.sql` to the Supabase project, either with the Supabase CLI (`supabase db push`) or the SQL editor.
5. Start the API and frontend in separate terminals:

   ```sh
   npm run dev:api
   npm run dev
   ```

The API listens on port `4000` by default. Set `API_PORT` or `API_CORS_ORIGIN` in `.env` to change its port or accepted frontend origin.

## Data and behavior

- `users` stores the required name, unique email, and LinkedIn URL, plus optional website and profession.
- `attendance` stores a date and a user ID. A unique constraint prevents duplicate check-ins by the same attendee on one date.
- Existing attendees are checked in and receive the attendee list grouped by dates on which they have checked in.
- New registrations call a Postgres function that inserts the user and their first attendance row atomically.
- Dates are determined by the API server's current UTC date.
- Other attendees' email addresses are not included in the attendee list response.

## Email and row-level security

The migration enables RLS and defines policies using the email claim in a Supabase Auth JWT. The app does not use Supabase Auth: it sends the typed email to the Express API, which uses the server-only Supabase secret key. Supabase secret keys bypass RLS, so the API itself is the access boundary for the no-auth flow.

Typing an email does not prove ownership of that email. As requested, anyone who knows or guesses a registered email can check in as that attendee and see the attendee lists for their visit dates. To make email-based access private, add email verification (for example, a magic link) and pass a verified Supabase Auth token so RLS can trust its email claim.
