import cors from "cors";
import express from "express";
import { calendarDate, eventTimeZone } from "./dates.ts";
import {
  attendanceSummary,
  findEventDate,
  findUserByEmail,
  findUserByToken,
  recordAttendance,
  registerAndAttend,
  updateProfile,
  visitOn,
  type AttendanceDatabase,
  type Profile,
} from "./db.ts";
import { normalizedEmail, profileFields, requiredText } from "./validation.ts";

const unknownEvent = "This event code is not recognized.";
const closedEvent = "This check-in link is for a different event. Scan tonight's door code to check in.";

export function createApp(db: AttendanceDatabase, now: () => Date = () => new Date()) {
  const app = express();
  const allowedOrigins = (process.env.API_CORS_ORIGIN ?? "http://localhost:3000")
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
  const timeZone = eventTimeZone();
  calendarDate(now(), timeZone); // Fail at startup, not at the door, on a misspelled zone.

  app.use(cors({ origin: allowedOrigins }));
  app.use(express.json({ limit: "16kb" }));

  /** The date of the event that is open right now. */
  function today() {
    return calendarDate(now(), timeZone);
  }

  /** The attendee's lists, plus the open date so the site can tell tonight's list from the others. */
  function summary(profile: Profile) {
    return { ...attendanceSummary(db, profile), openDate: today() };
  }

  /**
   * The date to record a visit on, or why `event` cannot be checked into.
   * Only the open event takes check-ins, so a door code left over from an
   * earlier event is refused instead of adding a visit to that event's date.
   */
  function openEvent(event: unknown): { date: string } | { error: string } {
    const date = today();
    if (event === undefined || event === null) return { date };
    if (typeof event !== "string") return { error: unknownEvent };
    const id = event.trim();
    if (!id) return { date };
    const eventDate = findEventDate(db, id);
    if (!eventDate) return { error: unknownEvent };
    return eventDate === date ? { date } : { error: closedEvent };
  }

  app.get("/health", (_request, response) => response.json({ status: "ok" }));

  app.post("/api/attendance/lookup", (request, response) => {
    const email = normalizedEmail(request.body?.email);
    if (!email) return response.status(400).json({ error: "Enter a valid email address." });

    const visit = openEvent(request.body?.event);
    if ("error" in visit) return response.status(400).json({ error: visit.error });

    const profile = findUserByEmail(db, email);
    if (!profile) {
      return response.status(404).json({ error: "Create a profile to check in.", registrationRequired: true });
    }

    recordAttendance(db, profile.id, visit.date);
    return response.json(summary(profile));
  });

  // Tonight's list for someone already on it, for the site to poll. Unlike lookup, it records no visit.
  // The email only has to match a profile, as it does for lookup, and the list is the open date's alone.
  app.post("/api/attendance/live", (request, response) => {
    const email = normalizedEmail(request.body?.email);
    if (!email) return response.status(400).json({ error: "Enter a valid email address." });

    const profile = findUserByEmail(db, email);
    if (!profile) return response.status(404).json({ error: "Create a profile to check in." });

    return response.json({ visit: visitOn(db, profile, today()) });
  });

  app.post("/api/attendance/register", (request, response) => {
    const registration = profileFields(request.body);
    if ("error" in registration) return response.status(400).json({ error: registration.error });

    const visit = openEvent(request.body?.event);
    if ("error" in visit) return response.status(400).json({ error: visit.error });

    const profile = registerAndAttend(db, registration, visit.date);
    return response.json(summary(profile));
  });

  // Edits a profile. The email picks the profile and is never changed, and no visit is recorded.
  // The site sends every field. An intro or tags key that is missing leaves that one as it is stored.
  app.post("/api/attendance/update", (request, response) => {
    const changes = profileFields(request.body);
    if ("error" in changes) return response.status(400).json({ error: changes.error });

    const profile = updateProfile(db, changes);
    if (!profile) return response.status(404).json({ error: "Check in again to update your profile." });

    return response.json(summary(profile));
  });

  app.post("/api/attendance/redeem", (request, response) => {
    const token = requiredText(request.body?.token);
    if (!token) return response.status(400).json({ error: "A check-in code is required." });

    const profile = findUserByToken(db, "checkIn", token);
    if (!profile) return response.status(401).json({ error: "This check-in code is invalid or expired." });

    recordAttendance(db, profile.id, today());
    return response.json(summary(profile));
  });

  app.post("/api/attendance/profile", (request, response) => {
    const token = requiredText(request.body?.token);
    if (!token) return response.status(400).json({ error: "A profile code is required." });

    const profile = findUserByToken(db, "profile", token);
    if (!profile) return response.status(404).json({ error: "Profile not found." });

    return response.json({
      profile: {
        id: profile.id,
        name: profile.name,
        linkedin: profile.linkedin,
        website: profile.website,
        profession: profile.profession,
        intro: profile.intro,
        tags: profile.tags,
      },
    });
  });

  // The site always reads a JSON body, so a body it cannot parse and an
  // unexpected failure answer in JSON too, not with Express's HTML page.
  const jsonErrors: express.ErrorRequestHandler = (error, _request, response, _next) => {
    const status = Number(error?.status);
    if (status >= 400 && status < 500) {
      return response.status(status).json({ error: "The request could not be read." });
    }
    console.error(error);
    return response.status(500).json({ error: "Something went wrong. Please try again." });
  };
  app.use(jsonErrors);

  return app;
}
