"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { FiUsers } from "react-icons/fi";
import { AttendanceApiError, postAttendance, type AttendanceResult } from "@/lib/attendance-api";

export default function ListingPage() {
  const router = useRouter();
  const [result, setResult] = useState<AttendanceResult | null>(null);
  const [error, setError] = useState("");

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

  function useAnotherEmail() {
    sessionStorage.removeItem("attendance-email");
    router.push("/");
  }

  return (
    <main style={styles.page}>
      <section style={styles.card}>
        <div style={styles.logo}><FiUsers size={26} /></div>
        <h1 style={styles.title}>{result ? `Welcome, ${result.profile.name.split(" ")[0]}!` : "People attending"}</h1>
        <p style={styles.intro}>
          {result ? "You’re checked in. Here are the people attending on your visit dates." : "Loading the attendee list…"}
        </p>
        {error && <p role="alert" style={styles.error}>{error}</p>}
        {result && <div>
          {result.visits.map(({ date, attendees }) => (
            <section key={date} style={styles.visit}>
              <h2 style={styles.date}>{new Date(`${date}T12:00:00`).toLocaleDateString(undefined, {
                weekday: "long", month: "long", day: "numeric", year: "numeric",
              })}</h2>
              <p style={styles.count}>{attendees.length} {attendees.length === 1 ? "person" : "people"} attending</p>
              <ul style={styles.list}>
                {attendees.map((attendee) => (
                  <li key={attendee.id} style={styles.attendee}>
                    <span style={styles.name}>{attendee.name}</span>
                    {attendee.profession && <span style={styles.profession}>{attendee.profession}</span>}
                    <a href={attendee.linkedin} target="_blank" rel="noreferrer" style={styles.link}>LinkedIn</a>
                  </li>
                ))}
              </ul>
            </section>
          ))}
          <button type="button" onClick={useAnotherEmail} style={styles.button}>Use another email</button>
        </div>}
      </section>
    </main>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: { minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, boxSizing: "border-box", fontFamily: "var(--font-geist-sans), sans-serif" },
  card: { width: "100%", maxWidth: 560, background: "#fff", padding: "40px 32px", borderRadius: 20, border: "1px solid #F0EAE7", boxShadow: "0 12px 40px rgba(80,45,30,.06)", boxSizing: "border-box" },
  logo: { width: 52, height: 52, borderRadius: 15, background: "#FBEDE7", color: "#C65A3A", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 24px" },
  title: { fontSize: 28, fontWeight: 700, color: "#191B26", margin: "0 0 10px", letterSpacing: -1, textAlign: "center" },
  intro: { fontSize: 14, lineHeight: 1.6, color: "#686875", margin: "0 0 22px", textAlign: "center" },
  visit: { borderTop: "1px solid #F0EAE7", paddingTop: 20, marginTop: 20 },
  date: { color: "#191B26", fontSize: 17, margin: "0 0 5px" },
  count: { fontSize: 13, color: "#686875", margin: "0 0 12px" },
  list: { display: "grid", gap: 10, listStyle: "none", padding: 0, margin: 0 },
  attendee: { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "12px 14px", background: "#FFFCFA", borderRadius: 10 },
  name: { color: "#191B26", fontWeight: 600 },
  profession: { color: "#686875", fontSize: 13 },
  link: { color: "#C65A3A", fontSize: 13, marginLeft: "auto" },
  button: { width: "100%", height: 48, border: "1px solid #E8E5E7", borderRadius: 12, background: "white", color: "#686875", fontSize: 14, cursor: "pointer", marginTop: 24 },
  error: { color: "#A33E2D", fontSize: 14, textAlign: "center" },
};
