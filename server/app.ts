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
  type AttendanceDatabase,
  type Registration,
} from "./db.ts";

const invalidProfile =
  "Name, a valid email, and LinkedIn URL are required. Website must also be a valid URL when provided.";
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
    return response.json(attendanceSummary(db, profile));
  });

  app.post("/api/attendance/register", (request, response) => {
    const registration = profileFields(request.body);
    if (!registration) return response.status(400).json({ error: invalidProfile });

    const visit = openEvent(request.body?.event);
    if ("error" in visit) return response.status(400).json({ error: visit.error });

    const profile = registerAndAttend(db, registration, visit.date);
    return response.json(attendanceSummary(db, profile));
  });

  // Edits a profile. The email picks the profile and is never changed, and no visit is recorded.
  app.post("/api/attendance/update", (request, response) => {
    const changes = profileFields(request.body);
    if (!changes) return response.status(400).json({ error: invalidProfile });

    const profile = updateProfile(db, changes);
    if (!profile) return response.status(404).json({ error: "Check in again to update your profile." });

    return response.json(attendanceSummary(db, profile));
  });

  app.post("/api/attendance/redeem", (request, response) => {
    const token = requiredText(request.body?.token);
    if (!token) return response.status(400).json({ error: "A check-in code is required." });

    const profile = findUserByToken(db, "checkIn", token);
    if (!profile) return response.status(401).json({ error: "This check-in code is invalid or expired." });

    recordAttendance(db, profile.id, today());
    return response.json(attendanceSummary(db, profile));
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

/** The profile in a register or update body, or null when a required field is missing or a URL is malformed. */
function profileFields(body: unknown): Registration | null {
  const fields = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
  const email = normalizedEmail(fields.email);
  const name = requiredText(fields.name);
  const linkedin = requiredText(fields.linkedin);
  const website = optionalText(fields.website);

  if (!email || !name || !linkedin || !isHttpUrl(linkedin) || (website && !isHttpUrl(website))) return null;
  return { email, name, linkedin, website, profession: optionalText(fields.profession) };
}

function normalizedEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

function optionalText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return value.trim() || null;
}

function requiredText(value: unknown): string | null {
  return optionalText(value);
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}
