"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FiArrowLeft, FiUsers } from "react-icons/fi";
import { postAttendance, type AttendanceResult } from "@/lib/attendance-api";

export default function RegisterPage() {
  const router = useRouter();
  const emailInput = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [linkedin, setLinkedin] = useState("");
  const [website, setWebsite] = useState("");
  const [profession, setProfession] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (emailInput.current) {
      emailInput.current.value = new URLSearchParams(window.location.search).get("email") ?? "";
    }
  }, []);

  async function handleRegister(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");

    try {
      const form = new FormData(event.currentTarget);
      const email = String(form.get("email") ?? "").trim().toLowerCase();
      await postAttendance<AttendanceResult>("/api/attendance/register", {
        email,
        name,
        linkedin,
        website,
        profession,
      });
      sessionStorage.setItem("attendance-email", email);
      router.push("/listing");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not register.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={styles.page}>
      <section style={styles.card}>
        <button type="button" onClick={() => router.push("/")} style={styles.back}>
          <FiArrowLeft size={16} /> Back
        </button>
        <div style={styles.logo}><FiUsers size={26} /></div>
        <h1 style={styles.title}>Create your profile</h1>
        <p style={styles.intro}>Add a few details so other attendees can connect with you.</p>
        <form onSubmit={handleRegister} style={styles.form}>
          <label style={styles.label}>
            Name <span style={styles.required}>Required</span>
            <input autoComplete="name" required value={name} onChange={(event) => setName(event.target.value)} style={styles.input} />
          </label>
          <label style={styles.label}>
            Email <span style={styles.required}>Required</span>
            <input ref={emailInput} name="email" type="email" autoComplete="email" required style={styles.input} />
          </label>
          <label style={styles.label}>
            LinkedIn URL <span style={styles.required}>Required</span>
            <input type="url" placeholder="https://www.linkedin.com/in/you" required value={linkedin} onChange={(event) => setLinkedin(event.target.value)} style={styles.input} />
          </label>
          <label style={styles.label}>
            Website <span style={styles.optional}>Optional</span>
            <input type="url" placeholder="https://example.com" value={website} onChange={(event) => setWebsite(event.target.value)} style={styles.input} />
          </label>
          <label style={styles.label}>
            Profession <span style={styles.optional}>Optional</span>
            <input placeholder="e.g. Product designer" value={profession} onChange={(event) => setProfession(event.target.value)} style={styles.input} />
          </label>
          {error && <p role="alert" style={styles.error}>{error}</p>}
          <button type="submit" disabled={loading} style={styles.submit}>
            {loading ? "Creating profile…" : "Create profile and check in"}
          </button>
        </form>
      </section>
    </main>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: { minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, boxSizing: "border-box", fontFamily: "var(--font-geist-sans), sans-serif" },
  card: { width: "100%", maxWidth: 480, background: "#fff", padding: 32, borderRadius: 20, border: "1px solid #F0EAE7", boxShadow: "0 12px 40px rgba(80,45,30,.06)", boxSizing: "border-box" },
  back: { display: "inline-flex", alignItems: "center", gap: 7, border: 0, background: "transparent", color: "#686875", padding: 0, cursor: "pointer" },
  logo: { width: 52, height: 52, borderRadius: 15, background: "#FBEDE7", color: "#C65A3A", display: "flex", alignItems: "center", justifyContent: "center", margin: "20px auto" },
  title: { fontSize: 28, fontWeight: 700, color: "#191B26", margin: "0 0 8px", letterSpacing: -1, textAlign: "center" },
  intro: { fontSize: 14, lineHeight: 1.55, color: "#686875", margin: "0 0 22px", textAlign: "center" },
  form: { display: "grid", gap: 14 },
  label: { display: "grid", gridTemplateColumns: "1fr auto", gap: "7px 8px", color: "#34343E", fontSize: 13, fontWeight: 600 },
  required: { color: "#C65A3A", fontSize: 11, fontWeight: 500 },
  optional: { color: "#92919A", fontSize: 11, fontWeight: 500 },
  input: { gridColumn: "1 / -1", width: "100%", height: 46, padding: "0 13px", border: "1px solid #E8E5E7", borderRadius: 10, background: "#fff", color: "#191B26", font: "inherit", boxSizing: "border-box" },
  error: { color: "#A33E2D", fontSize: 13, margin: 0 },
  submit: { height: 52, border: 0, borderRadius: 12, background: "#C65A3A", color: "#fff", fontSize: 15, fontWeight: 600, cursor: "pointer", marginTop: 4 },
};
