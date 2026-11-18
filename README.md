# Technically Social

Technically Social is an event check-in and networking app. Attendees register or check in with their email, then browse the people attending that day's event. Organizers can manage attendance and choose the event's visual theme.

## Features

### Attendees

- Check in with an email address. Returning attendees are checked in for the current event; new attendees are sent to registration.
- Create a profile with first and last name, email, and LinkedIn URL. Profession, website, location, age-range response, sex, and a profile photo are optional.
- Upload a profile photo, automatically cropped and resized in the browser.
- Browse contact cards for people checked in to today's event, including the details and links they chose to share. Attendee lists do not expose other attendees' email addresses.
- Switch to another email from the attendee list.

### Organizers

- Sign in at `/admin` using the configured organizer password.
- Review check-ins grouped by event date, including attendee contact details and check-in times.
- Download a CSV for one event or all events.
- Remove a person from one event without deleting their profile, or delete their profile, photo, and check-in history.
- Preview and save one of four themes for an event date, including future dates.

### Event themes

The four themes are **After hours** (default), **Ticker**, **Secure channel**, and **Blueprint**. The selected theme is stored per event date. Open pages refresh the current event's theme periodically. To preview a theme without saving it, add `?theme=ticker`, `?theme=secure`, `?theme=blueprint`, or `?theme=after-hours` to a page URL.

## Tech stack

- Next.js and React frontend
- Express attendance API
- Supabase Postgres and Storage
- TypeScript

## Run locally

1. Install dependencies:

   ```sh
   npm install
   ```

2. Create a Supabase project. In its SQL Editor, run the migrations in order:

   1. `supabase/migrations/20261114000000_create_attendance.sql`
   2. `supabase/migrations/20261116000000_add_profile_details.sql`
   3. `supabase/migrations/20261116020000_event_themes.sql`

   These create the attendee and attendance tables, registration functions, profile fields, the public `avatars` storage bucket, and the per-event theme table.

3. Copy `.env.example` to `.env` and set:

   - `SUPABASE_URL` and the server-only `SUPABASE_SECRET_KEY` from your Supabase project.
   - `ADMIN_PASSWORD` to a strong organizer password. The `/admin` page remains locked if it is blank.
   - `NEXT_PUBLIC_API_URL` to the API origin; the default is `http://localhost:4000`.
   - `EVENT_TIMEZONE` to the event's IANA time zone; the default is `America/New_York`.

   Keep `.env` and the Supabase secret key private. Never put the secret key in browser code or source control.

4. Start the API and frontend in separate terminals:

   ```sh
   npm run dev:api
   npm run dev
   ```

5. Open [http://localhost:3000](http://localhost:3000). The API listens on port `4000` by default, and its health endpoint is `/health`.

Optional API settings:

- `API_PORT` changes the API's listening port.
- `API_CORS_ORIGIN` changes the frontend origin allowed by CORS; the default is `http://localhost:3000`.

## Data and access notes

- Each attendee can have at most one check-in per event date.
- The API calculates the event date using `EVENT_TIMEZONE`.
- The public attendee list shows people checked in for the current event date. Organizers can view historical events.
- Attendee registration and lookup use an email address but do not verify email ownership. Anyone who knows a registered email can check in as that attendee and see the attendee list for the current event.
- The API uses the Supabase secret key, which bypasses row-level security. The API is the access boundary for this app; email entry alone is not authentication. Use a private, strong `ADMIN_PASSWORD` and only share organizer access with trusted organizers.
