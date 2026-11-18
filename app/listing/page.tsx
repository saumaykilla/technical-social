"use client";

/*
 * Technically Social: attendee list page (/listing)
 * Written by Himal Shrestha
 *
 * After checking in, attendees land here and see a contact card for everyone
 * checked in TODAY. Past events are only visible to organizers on /admin.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { FiGlobe, FiLinkedin, FiMapPin, FiUsers } from "react-icons/fi";
import { AttendanceApiError, postAttendance, type Attendee, type AttendanceResult } from "@/lib/attendance-api";
import ThemeDecor from "@/app/theme-decor";

// ==================================================================
// CONTACT CARD
// How one person shows up in the list.
// ==================================================================
// Turns "Himal Shrestha" into "HS", for people who didn't add a photo.
function initials(person: Attendee): string {
  const first = person.first_name ?? person.name.split(" ")[0] ?? "";
  const last = person.last_name ?? person.name.split(" ").slice(1).join(" ");
  return `${first.charAt(0)}${last.charAt(0)}`.toUpperCase();
}

// One contact card: photo (or initials), name, job, and whatever personal
// details they chose to share, plus their links.
function ContactCard({ person }: { person: Attendee }) {
  // Turn the yes/no 18+ answer into a label. null means they skipped it.
  const ageLabel = person.over_18 === true ? "18+" : person.over_18 === false ? "Under 18" : null;
  // Only include the details they actually filled in, then join them with dots.
  // e.g. "18+ · Male" or just "Female" or nothing at all.
  const details = [ageLabel, person.sex].filter(Boolean).join(" · ");

  return (
    <li style={styles.contact}>
      {person.photo_url
        ? <img src={person.photo_url} alt="" style={styles.avatar} />
        : <span style={{ ...styles.avatar, ...styles.initials }}>{initials(person)}</span>}

      <div style={styles.info}>
        <span style={styles.name}>{person.name}</span>
        {person.profession && <span style={styles.profession}>{person.profession}</span>}
        {(details || person.location) && (
          <span style={styles.details}>
            {details}
            {details && person.location && " · "}
            {person.location && <><FiMapPin size={11} style={styles.pin} /> {person.location}</>}
          </span>
        )}
        <span style={styles.links}>
          {/* target="_blank" opens the link in a new tab so they don't lose the list */}
          <a href={person.linkedin} target="_blank" rel="noreferrer" style={styles.link}>
            <FiLinkedin size={13} /> LinkedIn
          </a>
          {person.website && (
            <a href={person.website} target="_blank" rel="noreferrer" style={styles.link}>
              <FiGlobe size={13} /> Website
            </a>
          )}
        </span>
      </div>
    </li>
  );
}

// ==================================================================
// THE PAGE
// Loads today's list from the server and shows a card for each person.
// ==================================================================
export default function ListingPage() {
  const router = useRouter();
  const [result, setResult] = useState<AttendanceResult | null>(null);
  const [error, setError] = useState("");

  // Runs once when the page opens: grab their email from this browser tab and
  // ask the server for today's attendee list. No email? Back to the home page.
  useEffect(() => {
    let cancelled = false;
    const email = sessionStorage.getItem("attendance-email");

    if (!email) {
      router.replace("/");
      return () => {
        cancelled = true;
      };
    }

    postAttendance<AttendanceResult>("/api/attendance/lookup", { email })
      .then((attendance) => {
        if (!cancelled) setResult(attendance);
      })
      .catch((requestError: unknown) => {
        if (cancelled) return;
        if (requestError instanceof AttendanceApiError && requestError.registrationRequired) {
          router.replace(`/register?email=${encodeURIComponent(email)}`);
          return;
        }
        setError(requestError instanceof Error ? requestError.message : "Could not load the attendee list.");
      });

    return () => {
      cancelled = true;
    };
  }, [router]);

  // "Use another email" button: forget who this is and go back to the start.
  function useAnotherEmail() {
    sessionStorage.removeItem("attendance-email");
    router.push("/");
  }

  const firstName = result?.profile.first_name ?? result?.profile.name.split(" ")[0];

  return (
    <main style={styles.page}>
      <section style={styles.card}>
        <ThemeDecor label="Roster" />
        <div style={styles.logo}><FiUsers size={26} /></div>
        <h1 style={styles.title}>{result ? `Welcome, ${firstName}!` : "People attending"}</h1>
        <p style={styles.intro}>
          {result ? "You’re checked in. Here’s who’s here today." : "Loading the attendee list…"}
        </p>
        {error && <p role="alert" style={styles.error}>{error}</p>}
        {result && <div>
          {result.visits.map(({ date, attendees }) => (
            <section key={date} style={styles.visit}>
              {/* Dates are stored like "2026-11-16". Adding T12:00 (noon) stops the
                  date from slipping back a day because of time zones. */}
              <h2 style={styles.date}>{new Date(`${date}T12:00:00`).toLocaleDateString(undefined, {
                weekday: "long", month: "long", day: "numeric", year: "numeric",
              })}</h2>
              <p style={styles.count}>{attendees.length} {attendees.length === 1 ? "person" : "people"} here today</p>
              <ul style={styles.list}>
                {attendees.map((person) => <ContactCard key={person.id} person={person} />)}
              </ul>
            </section>
          ))}
          <button type="button" onClick={useAnotherEmail} style={styles.button}>Use another email</button>
        </div>}
      </section>
    </main>
  );
}

// ==================================================================
// STYLES
// Colors, sizes and spacing for this page.
// ==================================================================
const styles: Record<string, React.CSSProperties> = {
  page: { minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, boxSizing: "border-box", fontFamily: "var(--font-geist-sans), sans-serif" },
  card: { width: "100%", maxWidth: 560, background: "var(--ts-card)", padding: "40px 32px", borderRadius: "var(--ts-radius)", border: "1px solid var(--ts-card-border)", boxShadow: "var(--ts-card-shadow)", boxSizing: "border-box" },
  logo: { width: 52, height: 52, borderRadius: "var(--ts-radius-sm)", background: "var(--ts-accent-soft)", color: "var(--ts-accent)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 24px" },
  title: { fontSize: 28, fontWeight: 700, color: "var(--ts-text)", margin: "0 0 10px", letterSpacing: "var(--ts-title-spacing)", fontFamily: "var(--ts-font-display)", textAlign: "center" },
  intro: { fontSize: 14, lineHeight: 1.6, color: "var(--ts-muted)", margin: "0 0 22px", textAlign: "center" },
  visit: { borderTop: "1px solid var(--ts-card-border)", paddingTop: 20, marginTop: 20 },
  date: { color: "var(--ts-text)", fontSize: 17, margin: "0 0 5px" },
  count: { fontSize: 13, color: "var(--ts-muted)", margin: "0 0 12px" },
  list: { display: "grid", gap: 10, listStyle: "none", padding: 0, margin: 0 },
  contact: { display: "flex", alignItems: "flex-start", gap: 14, padding: 14, background: "var(--ts-row-bg)", border: "1px solid var(--ts-row-border)", borderRadius: "var(--ts-radius-sm)" },
  avatar: { width: 56, height: 56, borderRadius: "50%", objectFit: "cover", flexShrink: 0 },
  initials: { background: "var(--ts-accent-soft)", color: "var(--ts-accent)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 18 },
  info: { display: "flex", flexDirection: "column", gap: 3, minWidth: 0 },
  name: { color: "var(--ts-text)", fontWeight: 600, fontSize: 15 },
  profession: { color: "var(--ts-text)", fontSize: 13 },
  details: { color: "var(--ts-muted)", fontSize: 12, display: "flex", alignItems: "center", gap: 3, flexWrap: "wrap" },
  pin: { marginLeft: 1 },
  links: { display: "flex", gap: 14, marginTop: 4 },
  link: { color: "var(--ts-accent)", fontSize: 13, display: "inline-flex", alignItems: "center", gap: 4, textDecoration: "none" },
  button: { width: "100%", height: 48, border: "1px solid var(--ts-input-border)", borderRadius: "var(--ts-radius-sm)", background: "transparent", color: "var(--ts-muted)", fontSize: 14, cursor: "pointer", marginTop: 24 },
  error: { color: "var(--ts-danger)", fontSize: 14, textAlign: "center" },
};
