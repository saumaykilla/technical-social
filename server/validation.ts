// Field rules shared by the API and the admin command.
import type { Registration } from "./db.ts";

/** The topic ids a profile can carry, in the order the site lists them. */
export const tagIds = ["ml", "llms", "web", "data", "hiring", "job-hunting"] as const;

export type Tag = (typeof tagIds)[number];

/** The longest intro, in the UTF-16 units the site's `maxLength` counts. */
export const introLimit = 140;

const invalidProfile =
  "Name, a valid email, and LinkedIn URL are required. Website must also be a valid URL when provided.";
const invalidIntro = `Keep your intro to ${introLimit} characters or fewer.`;
const invalidTags = "Choose your topics from the list.";

/**
 * The profile in a set of fields, or the message for the first rule they break.
 * `intro` and `tags` are left out of the result when the fields do not mention them.
 */
export function profileFields(body: unknown): Registration | { error: string } {
  const fields = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
  const email = normalizedEmail(fields.email);
  const name = requiredText(fields.name);
  const linkedin = requiredText(fields.linkedin);
  const website = optionalText(fields.website);

  if (!email || !name || !linkedin || !isHttpUrl(linkedin) || (website && !isHttpUrl(website))) {
    return { error: invalidProfile };
  }
  const profile: Registration = { email, name, linkedin, website, profession: optionalText(fields.profession) };

  if (fields.intro !== undefined) {
    if (fields.intro !== null && typeof fields.intro !== "string") return { error: invalidIntro };
    profile.intro = optionalText(fields.intro);
    if (profile.intro && profile.intro.length > introLimit) return { error: invalidIntro };
  }

  if (fields.tags !== undefined) {
    const given = fields.tags;
    if (!Array.isArray(given) || !given.every((id) => (tagIds as readonly unknown[]).includes(id))) {
      return { error: invalidTags };
    }
    profile.tags = tagIds.filter((id) => given.includes(id));
  }

  return profile;
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
