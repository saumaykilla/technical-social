"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { FiArrowRight, FiMail, FiUsers } from "react-icons/fi";
import { AttendanceApiError, postAttendance, type AttendanceResult } from "@/lib/attendance-api";

export default function HomePage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [focused, setFocused] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleContinue(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");

    try {
      await postAttendance<AttendanceResult>("/api/attendance/lookup", { email });
      sessionStorage.setItem("attendance-email", email.trim().toLowerCase());
      router.push("/listing");
    } catch (requestError) {
      if (requestError instanceof AttendanceApiError && requestError.registrationRequired) {
        router.push(`/register?email=${encodeURIComponent(email.trim().toLowerCase())}`);
      } else if (requestError instanceof Error && requestError.message.toLowerCase().includes("fetch")) {
        setError("Could not reach the attendance service. Check that the API server is running.");
      } else {
        setError(requestError instanceof Error ? requestError.message : "Could not check in.");
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={styles.page}>
      <section style={styles.card}>
        <div style={styles.logo}><FiUsers size={26} /></div>
        <h1 style={styles.title}>Welcome!</h1>
        <p style={styles.intro}>Connect with people attending the event. Enter your email to get started.</p>
        <form onSubmit={handleContinue}>
          <div style={styles.inputWrap}>
            <FiMail size={20} style={styles.mailIcon} />
            <input
              aria-label="Email address"
              type="email"
              autoComplete="email"
              placeholder="Enter your email address"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              required
              style={{ ...styles.input, borderColor: focused ? "#C65A3A" : "#E8E5E7" }}
            />
          </div>
          {error && <p role="alert" style={styles.error}>{error}</p>}
          <button type="submit" disabled={loading} style={styles.button}>
            {loading ? "Checking in…" : "Continue"}<FiArrowRight size={18} />
          </button>
        </form>
        <p style={styles.footer}>Your email helps us find your attendee profile.</p>
      </section>
    </main>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: { minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, boxSizing: "border-box", fontFamily: "var(--font-geist-sans), sans-serif" },
  card: { width: "100%", maxWidth: 440, background: "#fff", padding: "48px 36px", borderRadius: 20, border: "1px solid #F0EAE7", boxShadow: "0 12px 40px rgba(80,45,30,.06)", boxSizing: "border-box", textAlign: "center" },
  logo: { width: 52, height: 52, borderRadius: 15, background: "#FBEDE7", color: "#C65A3A", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 28px" },
  title: { fontSize: 30, fontWeight: 700, color: "#191B26", margin: "0 0 12px", letterSpacing: -1 },
  intro: { fontSize: 15, lineHeight: 1.6, color: "#686875", margin: "0 0 32px" },
  inputWrap: { position: "relative", marginBottom: 18 },
  mailIcon: { position: "absolute", left: 18, top: "50%", transform: "translateY(-50%)", color: "#92919A" },
  input: { width: "100%", height: 58, padding: "0 18px 0 52px", background: "#fff", border: "1.5px solid #E8E5E7", borderRadius: 12, fontSize: 15, color: "#191B26", outline: "none", boxSizing: "border-box" },
  button: { width: "100%", height: 56, border: 0, borderRadius: 12, background: "#C65A3A", color: "#fff", fontSize: 16, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 10 },
  error: { color: "#A33E2D", fontSize: 14, margin: "0 0 14px", textAlign: "left" },
  footer: { margin: "28px 0 0", fontSize: 12, color: "#92919A" },
};
