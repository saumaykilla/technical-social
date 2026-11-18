/*
 * Technically Social: messenger between the pages and the server
 * Written by Himal Shrestha
 *
 * Every page uses postAttendance() to send requests to the backend, instead of
 * each page writing its own. This file also describes the shape of the data
 * the server sends back.
 */

// ==================================================================
// DATA SHAPES
// What the server's answers look like.
// ==================================================================
// What one person on the attendee list looks like. No email on purpose,
// the server strips it out before sending.
export type Attendee = {
  id: string;
  name: string;
  first_name: string | null;
  last_name: string | null;
  linkedin: string;
  website: string | null;
  profession: string | null;
  over_18: boolean | null; // true = 18+, false = under 18, null = didn't say
  sex: string | null;
  location: string | null;
  photo_url: string | null;
};

// What the server sends back after a check-in: your own profile (this one
// does include your email, since it's yours) plus everyone here TODAY.
// (visits only ever has today in it. Older events are organizer-only.)
export type AttendanceResult = {
  profile: Attendee & { email: string };
  visits: { date: string; attendees: Attendee[] }[];
};

// ==================================================================
// ERRORS
// A custom error that carries extra info, like "this person needs to sign up".
// ==================================================================
export class AttendanceApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly registrationRequired = false,
  ) {
    super(message);
    this.name = "AttendanceApiError";
  }
}

// ==================================================================
// SENDING REQUESTS
// Where the server lives, and the one function every page uses to talk to it.
// ==================================================================
const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export async function postAttendance<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${apiUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  // The server should always answer in JSON. If it sends a web page instead
  // (that's the "<!DOCTYPE" error), it usually means the backend doesn't know
  // this request yet, most often because it needs a restart after a code change.
  let result: T & { error?: string; registrationRequired?: boolean };
  try {
    result = await response.json();
  } catch {
    throw new AttendanceApiError(
      "The server gave an unexpected answer. Try restarting the backend (npm run dev:api).",
      response.status,
    );
  }
  if (!response.ok) {
    throw new AttendanceApiError(
      result.error ?? `Request failed (${response.status}).`,
      response.status,
      result.registrationRequired,
    );
  }
  return result;
}
