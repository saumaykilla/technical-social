// Field rules shared by the API and the admin command.
import type { Registration } from "./db.ts";

export const invalidProfile =
  "Name, a valid email, and LinkedIn URL are required. Website must also be a valid URL when provided.";

/** The profile in a set of fields, or null when a required one is missing or a URL is malformed. */
export function profileFields(body: unknown): Registration | null {
  const fields = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
  const email = normalizedEmail(fields.email);
  const name = requiredText(fields.name);
  const linkedin = requiredText(fields.linkedin);
  const website = optionalText(fields.website);

  if (!email || !name || !linkedin || !isHttpUrl(linkedin) || (website && !isHttpUrl(website))) return null;
  return { email, name, linkedin, website, profession: optionalText(fields.profession) };
}

/** The trimmed, lowercased email, or null when the value is not an email address. */
export function normalizedEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

/** The trimmed text, or null when the value is missing, not a string, or blank. */
export function optionalText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return value.trim() || null;
}

export function requiredText(value: unknown): string | null {
  return optionalText(value);
}

export function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}
