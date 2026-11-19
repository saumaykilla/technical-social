import cors from "cors";
import express from "express";
import {
  attendanceSummary,
  DuplicateEmailError,
  findUserByEmail,
  findUserById,
  recordAttendance,
  registerAndAttend,
  type AttendanceDatabase,
} from "./db.ts";

export function createApp(db: AttendanceDatabase, now: () => Date = () => new Date()) {
  const app = express();
  const allowedOrigins = (process.env.API_CORS_ORIGIN ?? "http://localhost:3000")
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);

  app.use(cors({ origin: allowedOrigins }));
  app.use(express.json({ limit: "16kb" }));

  function utcDate() {
    return now().toISOString().slice(0, 10);
  }

  app.get("/health", (_request, response) => response.json({ status: "ok" }));

  app.post("/api/attendance/lookup", (request, response) => {
    const email = normalizedEmail(request.body?.email);
    if (!email) return response.status(400).json({ error: "Enter a valid email address." });

    const profile = findUserByEmail(db, email);
    if (!profile) {
      return response.status(404).json({ registrationRequired: true, error: "That email is not registered." });
    }

    try {
      recordAttendance(db, profile.id, utcDate());
      return response.json(attendanceSummary(db, profile));
    } catch {
      return response.status(500).json({ error: "Could not record your attendance." });
    }
  });

  app.post("/api/attendance/register", (request, response) => {
    const email = normalizedEmail(request.body?.email);
    const name = requiredText(request.body?.name);
    const linkedin = requiredText(request.body?.linkedin);
    const website = optionalText(request.body?.website);

    if (!email || !name || !linkedin || !isHttpUrl(linkedin) || (website && !isHttpUrl(website))) {
      return response.status(400).json({
        error: "Name, a valid email, and LinkedIn URL are required. Website must also be a valid URL when provided.",
      });
    }

    try {
      const userId = registerAndAttend(db, {
        name,
        email,
        linkedin,
        website,
        profession: optionalText(request.body?.profession),
      }, utcDate());
      const profile = findUserById(db, userId);
      if (!profile) {
        return response.status(500).json({ error: "Registration succeeded, but your attendee list could not be loaded." });
      }
      return response.status(201).json(attendanceSummary(db, profile));
    } catch (error) {
      if (error instanceof DuplicateEmailError) {
        return response.status(409).json({ error: "That email is already registered. Return and enter it to check in." });
      }
      return response.status(500).json({ error: "Could not complete registration." });
    }
  });

  return app;
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
