export type Attendee = {
  id: string;
  name: string;
  linkedin: string;
  website: string | null;
  profession: string | null;
};

export type AttendanceResult = {
  profile: {
    id: string;
    name: string;
    email: string;
    linkedin: string;
    website: string | null;
    profession: string | null;
  };
  visits: { date: string; attendees: Attendee[] }[];
};

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

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export async function postAttendance<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${apiUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const result = (await response.json()) as T & {
    error?: string;
    registrationRequired?: boolean;
  };
  if (!response.ok) {
    throw new AttendanceApiError(
      result.error ?? `Request failed (${response.status}).`,
      response.status,
      result.registrationRequired,
    );
  }
  return result;
}
