/*
 * Technically Social: backend server (API)
 * Written by Himal Shrestha
 *
 * This is the "kitchen" of the app. The pages never talk to the database
 * directly. They send requests here, and this file checks the input, talks to
 * Supabase, and sends back only what each person is allowed to see.
 *
 * Start it with:  npm run dev:api   (runs on http://localhost:4000)
 */

import { timingSafeEqual } from "node:crypto";
import cors from "cors";
import express from "express";
import { supabase } from "./supabase.js";
import { defaultTheme, isThemeId } from "../lib/themes.js";

// ==================================================================
// SETUP
// Creates the server and reads settings from the .env file.
// ==================================================================
const app = express();
const port = Number(process.env.API_PORT ?? 4000);
const allowedOrigin = process.env.API_CORS_ORIGIN ?? "http://localhost:3000";
const adminPassword = process.env.ADMIN_PASSWORD ?? "";

// Which time zone "today" means. Computers usually count days in UTC (London
// time), so an event at 8pm New York time would get saved as TOMORROW. Using
// the event's own time zone keeps everyone at the same event on the same date.
const eventTimeZone = process.env.EVENT_TIMEZONE ?? "America/New_York";

// Today's date in the event's time zone, like "2026-11-16".
// ("en-CA" is just a trick: Canada writes dates as YYYY-MM-DD, the format the database wants.)
function eventDate(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: eventTimeZone, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

// ==================================================================
// REQUEST RULES
// Who is allowed to talk to this server, and how big a request can be.
// ==================================================================
// cors: only our own website (allowedOrigin) can send requests here.
app.use(cors({ origin: allowedOrigin }));

// Most requests are tiny (just an email), so 16kb is plenty.
// The register request is the exception: it can carry a profile photo, so it
// gets a bigger 2mb limit. The photo gets shrunk in the browser before it's
// sent, so it's usually well under 100kb anyway.
const smallJson = express.json({ limit: "16kb" });
const photoJson = express.json({ limit: "2mb" });
app.use((request, response, next) => {
  if (request.path === "/api/attendance/register") return next();
  return smallJson(request, response, next);
});

// ==================================================================
// DATA SHAPES
// Describes what a person's profile looks like, so TypeScript can catch mistakes.
// ==================================================================
type Profile = {
  id: string;
  name: string;
  first_name: string | null;
  last_name: string | null;
  email: string;
  linkedin: string;
  website: string | null;
  profession: string | null;
  over_18: boolean | null;
  sex: string | null;
  location: string | null;
  photo_url: string | null;
};
// An attendee is a profile minus the email. Other people's emails should
// never get sent to the browser.
type Attendee = Omit<Profile, "email">;

const profileFields = "id,name,first_name,last_name,email,linkedin,website,profession,over_18,sex,location,photo_url";

// The only answers allowed for sex. Has to match the list in the database.
const sexOptions = ["Female", "Male", "Non-binary", "Other"];

// ==================================================================
// INPUT CHECKERS
// Clean up and double-check everything people type before it's saved.
// Never trust the browser. Someone could send anything.
// ==================================================================
// Trims spaces, makes it lowercase, and checks it looks like name@site.com.
function normalizedEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

// Trims spaces. Returns null if the box was left empty.
function optionalText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return value.trim() || null;
}

// Same as optionalText. The caller treats null as "missing" and rejects the form.
function requiredText(value: unknown): string | null {
  return optionalText(value);
}

// Makes sure a link is a real web address (starts with http:// or https://).
function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

// The 18+ question is optional. The form sends "yes", "no", or "" (skipped).
// Returns true / false / null (skipped), or "invalid" for anything else.
function parseOver18(value: unknown): boolean | null | "invalid" {
  if (value === undefined || value === null || value === "") return null;
  if (value === "yes") return true;
  if (value === "no") return false;
  return "invalid";
}

// Checks the organizer password. timingSafeEqual compares in a way that
// doesn't leak hints about how close a wrong guess was.
// If no ADMIN_PASSWORD is set in .env, the organizer page stays locked.
function isAdmin(value: unknown): boolean {
  if (!adminPassword || typeof value !== "string") return false;
  const given = Buffer.from(value);
  const expected = Buffer.from(adminPassword);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

// ==================================================================
// PHOTO HELPERS
// Turn the uploaded photo back into an image and store it in Supabase.
// ==================================================================
// The browser sends the photo as a long text string called a "data URL"
// (it looks like "data:image/jpeg;base64,/9j/4AAQ..."). This turns it back
// into the actual image bytes so we can upload it. Returns null if it's not
// a JPEG or it's too big.
function decodePhoto(value: unknown): Buffer | null {
  if (typeof value !== "string") return null;
  const match = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(value);
  if (!match) return null;
  const bytes = Buffer.from(match[1], "base64");
  return bytes.length > 0 && bytes.length <= 1_000_000 ? bytes : null;
}

// Uploads the photo to the "avatars" storage bucket, named after the user's id
// (so each person has exactly one photo), then saves its link on their profile.
async function savePhoto(userId: string, photo: Buffer) {
  const path = `${userId}.jpg`;
  const { error: uploadError } = await supabase.storage
    .from("avatars")
    .upload(path, photo, { contentType: "image/jpeg", upsert: true });
  if (uploadError) throw uploadError;

  const { data } = supabase.storage.from("avatars").getPublicUrl(path);
  const { error: updateError } = await supabase
    .from("users")
    .update({ photo_url: data.publicUrl })
    .eq("id", userId);
  if (updateError) throw updateError;
}

// ==================================================================
// ATTENDEE LIST BUILDERS
// Put together the list of people that a regular attendee is allowed to see.
// ==================================================================
// Removes the email from a profile so it's safe to show other attendees.
function toAttendee(profile: Profile): Attendee {
  const attendee: Partial<Profile> = { ...profile };
  delete attendee.email;
  return attendee as Attendee;
}

// Builds what a regular attendee gets to see: their own profile, plus
// everyone checked in TODAY. Past events are only visible to organizers.
// (It's still shaped as a list of visits so the listing page stays simple.)
async function attendanceSummary(profile: Profile) {
  const today = eventDate();

  const { data: todayAttendance, error: attendanceError } = await supabase
    .from("attendance")
    .select("user_id,created_at")
    .eq("date", today)
    .order("created_at", { ascending: true }); // earliest check-ins first

  if (attendanceError) throw attendanceError;

  const attendeeIds = (todayAttendance ?? []).map(({ user_id }) => user_id);
  if (attendeeIds.length === 0) return { profile, visits: [] };

  const { data: profiles, error: profilesError } = await supabase
    .from("users")
    .select(profileFields)
    .in("id", attendeeIds);

  if (profilesError) throw profilesError;

  const profilesById = new Map(
    ((profiles ?? []) as Profile[]).map((attendee) => [attendee.id, toAttendee(attendee)]),
  );
  const attendees = attendeeIds
    .map((id) => profilesById.get(id))
    .filter((attendee): attendee is Attendee => attendee !== undefined);

  return { profile, visits: [{ date: today, attendees }] };
}

// ==================================================================
// ATTENDEE ROUTES
// The requests the public pages make: check in, and sign up.
// ==================================================================
// Quick "are you alive?" check. Visit http://localhost:4000/health to test.
app.get("/health", (_request, response) => response.json({ status: "ok" }));

// THEME: which look today's event uses. Every page asks this when it opens.
// If the organizer hasn't picked one (or the themes table isn't set up yet),
// it falls back to the default instead of breaking the site.
app.get("/api/theme", async (_request, response) => {
  const today = eventDate();
  const { data } = await supabase.from("event_themes").select("theme").eq("date", today).maybeSingle();
  return response.json({ date: today, theme: isThemeId(data?.theme) ? data.theme : defaultTheme });
});

// CHECK IN: someone typed their email on the home page.
// Found them?  -> check them in for today and send back today's list.
// Not found?   -> tell the page to send them to the sign-up form.
app.post("/api/attendance/lookup", async (request, response) => {
  const email = normalizedEmail(request.body?.email);
  if (!email) return response.status(400).json({ error: "Enter a valid email address." });

  const { data: profile, error } = await supabase
    .from("users")
    .select(profileFields)
    .eq("email", email)
    .maybeSingle<Profile>();

  if (error) return response.status(500).json({ error: "Could not look up your profile." });
  if (!profile) {
    return response.status(404).json({ registrationRequired: true, error: "That email is not registered." });
  }

  const { error: attendanceError } = await supabase.rpc("record_attendance", {
    attendee_id: profile.id,
    attendance_date: eventDate(),
  });

  if (attendanceError) {
    return response.status(500).json({ error: "Could not record your attendance." });
  }

  try {
    return response.json(await attendanceSummary(profile));
  } catch {
    return response.status(500).json({ error: "Could not load the attendee list." });
  }
});

// SIGN UP: a new person filled in the form. Validate it, save the profile,
// check them in for today, save their photo, then send back today's list.
app.post("/api/attendance/register", photoJson, async (request, response) => {
  const body = request.body ?? {};
  const email = normalizedEmail(body.email);
  const firstName = requiredText(body.firstName);
  const lastName = requiredText(body.lastName);
  const linkedin = requiredText(body.linkedin);
  const website = optionalText(body.website);
  const sex = optionalText(body.sex);
  const over18 = parseOver18(body.over18);

  // Check everything BEFORE saving anything, so a bad form never half-saves.
  if (!email || !firstName || !lastName || !linkedin || !isHttpUrl(linkedin) || (website && !isHttpUrl(website))) {
    return response.status(400).json({
      error: "First name, last name, a valid email, and LinkedIn URL are required. Website must also be a valid URL when provided.",
    });
  }
  if (over18 === "invalid") {
    return response.status(400).json({ error: "Answer the 18+ question with yes, no, or leave it blank." });
  }
  if (sex && !sexOptions.includes(sex)) {
    return response.status(400).json({ error: "Pick one of the listed options for sex, or leave it blank." });
  }

  // The photo is optional, but if they sent one it has to be a valid JPEG.
  const photo = body.photo ? decodePhoto(body.photo) : null;
  if (body.photo && !photo) {
    return response.status(400).json({ error: "That photo couldn't be used. Try a different picture." });
  }

  const { data: userId, error: registrationError } = await supabase.rpc("register_attendee", {
    attendee_first_name: firstName,
    attendee_last_name: lastName,
    attendee_email: email,
    attendee_linkedin: linkedin,
    attendee_website: website,
    attendee_profession: optionalText(body.profession),
    attendee_over_18: over18,
    attendee_sex: sex,
    attendee_location: optionalText(body.location),
    attendance_date: eventDate(),
  });

  if (registrationError) {
    // 23505 is the database's code for "this already exists" (email is unique).
    if (registrationError.code === "23505") {
      return response.status(409).json({ error: "That email is already registered. Return and enter it to check in." });
    }
    return response.status(500).json({ error: "Could not complete registration." });
  }

  // If the photo upload fails, I don't want to throw away their whole signup.
  // They're still registered and checked in; their card just shows initials.
  if (photo) {
    try {
      await savePhoto(userId, photo);
    } catch (photoError) {
      console.error("Photo upload failed:", photoError);
    }
  }

  const { data: profile, error: profileError } = await supabase
    .from("users")
    .select(profileFields)
    .eq("id", userId)
    .single<Profile>();

  if (profileError || !profile) {
    return response.status(500).json({ error: "Registration succeeded, but your attendee list could not be loaded." });
  }

  try {
    return response.status(201).json(await attendanceSummary(profile));
  } catch {
    return response.status(500).json({ error: "Registration succeeded, but the attendee list could not be loaded." });
  }
});

// ==================================================================
// ORGANIZER ROUTES
// Used by the /admin page. Every one of these requires ADMIN_PASSWORD.
// ==================================================================
// Sends back EVERY event date and everyone who came, emails included.
// Only works with the right ADMIN_PASSWORD (set in .env).
app.post("/api/admin/events", async (request, response) => {
  if (!isAdmin(request.body?.password)) {
    return response.status(401).json({ error: "Wrong organizer password." });
  }

  const { data: attendance, error: attendanceError } = await supabase
    .from("attendance")
    .select("date,user_id,created_at")
    .order("date", { ascending: false })        // newest event first
    .order("created_at", { ascending: true });  // then in check-in order
  if (attendanceError) return response.status(500).json({ error: "Could not load attendance." });

  const { data: profiles, error: profilesError } = await supabase.from("users").select(profileFields);
  if (profilesError) return response.status(500).json({ error: "Could not load profiles." });

  const profilesById = new Map(((profiles ?? []) as Profile[]).map((person) => [person.id, person]));

  // Group the rows by date: { "2026-11-16": [people...], "2026-11-09": [people...] }
  const byDate = new Map<string, (Profile & { checked_in_at: string })[]>();
  for (const row of attendance ?? []) {
    const person = profilesById.get(row.user_id);
    if (!person) continue;
    if (!byDate.has(row.date)) byDate.set(row.date, []);
    byDate.get(row.date)!.push({ ...person, checked_in_at: row.created_at });
  }

  // Which theme each event date uses, so the organizer page can show it.
  // (Empty list if the themes table hasn't been set up yet.)
  const { data: themeRows } = await supabase.from("event_themes").select("date,theme");

  return response.json({
    events: [...byDate].map(([date, attendees]) => ({ date, attendees })),
    themes: themeRows ?? [],
    today: eventDate(),
  });
});

// Quick format checks so junk input never reaches the database.
// A user id looks like "00efa6bd-2105-4327-8db0-1c1bed516475", a date like "2026-11-16".
const isUuid = (value: unknown): value is string =>
  typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const isDate = (value: unknown): value is string =>
  typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);

// Organizer action 1: take someone off ONE event's list.
// Their profile stays, so they can still check in at future events.
app.post("/api/admin/remove-checkin", async (request, response) => {
  const { password, userId, date } = request.body ?? {};
  if (!isAdmin(password)) return response.status(401).json({ error: "Wrong organizer password." });
  if (!isUuid(userId) || !isDate(date)) return response.status(400).json({ error: "Missing person or date." });

  const { error } = await supabase.from("attendance").delete().eq("user_id", userId).eq("date", date);
  if (error) return response.status(500).json({ error: "Could not remove that check-in." });
  return response.json({ ok: true });
});

// Organizer action 2: erase a person completely. Their photo, their profile,
// and every check-in they ever made. This can't be undone.
// (Their check-ins disappear automatically because the attendance table was set
// up with "on delete cascade": delete the person and their rows go with them.)
app.post("/api/admin/delete-person", async (request, response) => {
  const { password, userId } = request.body ?? {};
  if (!isAdmin(password)) return response.status(401).json({ error: "Wrong organizer password." });
  if (!isUuid(userId)) return response.status(400).json({ error: "Missing person." });

  // Delete the photo first. If they never uploaded one, this just does nothing.
  await supabase.storage.from("avatars").remove([`${userId}.jpg`]);

  const { error } = await supabase.from("users").delete().eq("id", userId);
  if (error) return response.status(500).json({ error: "Could not delete that person." });
  return response.json({ ok: true });
});

// Organizer action 3: pick the theme for an event date (today or a future one).
// "upsert" = add a row for that date, or update it if one already exists.
app.post("/api/admin/theme", async (request, response) => {
  const { password, date, theme } = request.body ?? {};
  if (!isAdmin(password)) return response.status(401).json({ error: "Wrong organizer password." });
  if (!isDate(date) || !isThemeId(theme)) return response.status(400).json({ error: "Pick a date and a theme." });

  const { error } = await supabase
    .from("event_themes")
    .upsert({ date, theme, updated_at: new Date().toISOString() }, { onConflict: "date" });
  if (error) {
    return response.status(500).json({
      error: "Could not save the theme. Make sure the event_themes database update (1116020000) was run in Supabase.",
    });
  }
  return response.json({ ok: true });
});

// ==================================================================
// START THE SERVER
// Opens the server so the pages can reach it.
// ==================================================================
app.listen(port, () => {
  console.log(`Attendance API listening on http://localhost:${port}`);
});
