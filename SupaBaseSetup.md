# Technically Social: getting it running

My step-by-step notes for setting this up from scratch. — Himal Shrestha

## 1. Make the database (Supabase, free)

1. Go to **supabase.com**, sign up, and click **New project**. Pick any name and set a database password (save it somewhere).
2. Wait a minute or two while it sets up.
3. In the left sidebar, open **SQL Editor** → **New query**.
4. Open `supabase/migrations/20261114000000_create_attendance.sql` in VS Code, copy all of it, paste it into the SQL Editor, and click **Run**.
5. Do the same with `supabase/migrations/20261116000000_add_profile_details.sql`, and then `supabase/migrations/20261116020000_event_themes.sql`. **Order matters: 1114 first, then 1116000000, then 1116020000.**
6. Check that it worked: **Table Editor** should show `users`, `attendance` and `event_themes`, and **Storage** should show a bucket called `avatars`.

## 2. Connect the app to the database

1. In Supabase, open **Project Settings** → **API** (sometimes called **API Keys**).
2. In VS Code, copy `.env.example` and rename the copy to `.env`.
3. Paste in the **Project URL** as `SUPABASE_URL`, and the **secret** key (sometimes labeled `service_role`) as `SUPABASE_SECRET_KEY`.
4. Set `ADMIN_PASSWORD` to a long password only organizers know. This unlocks the organizer page.
5. Leave `EVENT_TIMEZONE` as `America/New_York` unless the event is somewhere else.
6. Save. Don't share this file or upload it anywhere.

## 3. Run it

You need **two** terminals open in VS Code (click the **+** in the terminal panel to open a second one).

```
npm install        # only needed the first time
```

Terminal 1, the backend:
```
npm run dev:api
```

Terminal 2, the pages:
```
npm run dev
```

Then open **http://localhost:3000**.

## Who sees what

- **Attendees** (after checking in at `/`): only the people checked in **today**.
- **Organizers** (at **http://localhost:3000/admin**, with the `ADMIN_PASSWORD`): **every** event, everyone who came, their emails, and **Download** buttons that save the lists as spreadsheets (CSV files open in Excel or Google Sheets).

Only give the organizer link and password to organizers. The page shows everyone's email.

## Event themes

There are four looks: **After hours** (default), **Ticker**, **Secure channel** and **Blueprint**.

- On `/admin`, use the **Event theme** box: pick the event date, click a theme to preview it, then press **Save**. Everyone who opens the site on that date gets that theme.
- You can set the theme for a future event ahead of time. Dates with no theme saved use After hours.
- To preview a theme on any page without saving, add `?theme=ticker` (or `secure`, `blueprint`, `after-hours`) to the end of the address.

## 4. The QR code

The QR code just needs to point at the site's address. Any free QR generator works.

- Testing on my phone over the same Wi-Fi: the address is `http://<my laptop's IP>:3000`. Find the IP with `ipconfig` (look for IPv4 Address). For this to work I also have to set `NEXT_PUBLIC_API_URL=http://<my IP>:4000` and `API_CORS_ORIGIN=http://<my IP>:3000` in `.env`, then restart both terminals.
- At the real event, once it's hosted online, I'll make the QR point to the real web address instead.

## If something breaks

- **"Could not reach the attendance service"**: Terminal 1 (`npm run dev:api`) isn't running.
- **"SUPABASE_URL and SUPABASE_SECRET_KEY must be configured"**: the `.env` file is missing, misnamed, or empty.
- **"Could not complete registration"**: the 1116 migration probably wasn't run in Supabase.
- **"Wrong organizer password"**: check `ADMIN_PASSWORD` in `.env`, then restart Terminal 1. Changes to `.env` only kick in after a restart.
- **"Could not save the theme"**: the `20261116020000_event_themes.sql` file wasn't run in Supabase yet.
- **Photo doesn't show up**: check that the `avatars` bucket exists in Storage and is marked Public.
