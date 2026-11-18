"use client";

/*
 * Technically Social: sign-up page (/register)
 * Written by Himal Shrestha
 *
 * New attendees land here after typing an email that isn't in the database yet.
 * They fill in their profile (name, LinkedIn, optional photo and details),
 * and submitting it creates their profile AND checks them in for today.
 *
 * ("use client" above means this page runs in the visitor's browser, which it
 * needs to do because it reacts to typing and button presses.)
 */

import { ChangeEvent, FormEvent, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FiArrowLeft, FiCamera, FiUser } from "react-icons/fi";
import { postAttendance, type AttendanceResult } from "@/lib/attendance-api";
import ThemeDecor from "@/app/theme-decor";

// ==================================================================
// PHOTO SHRINKER
// Makes phone photos small before uploading them.
// ==================================================================
// Phone photos can be 3-10MB, way too big to send around. This shrinks the
// picture down to a 400x400 square (cropped from the middle) and turns it
// into a JPEG "data URL", which is just the image written out as text so
// it can travel inside a normal form request.
async function shrinkPhoto(file: File): Promise<string> {
  const image = await createImageBitmap(file);
  const size = 400;
  const side = Math.min(image.width, image.height); // biggest square that fits
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Could not process that photo.");
  context.drawImage(
    image,
    (image.width - side) / 2, (image.height - side) / 2, side, side, // part of the original to grab
    0, 0, size, size,                                                // where to draw it on the canvas
  );
  return canvas.toDataURL("image/jpeg", 0.85); // 0.85 = good quality, small file
}

// ==================================================================
// THE PAGE
// Everything below is the sign-up page itself.
// ==================================================================
export default function RegisterPage() {
  const router = useRouter();
  const emailInput = useRef<HTMLInputElement>(null);

  // Each "useState" is one box of memory the page keeps track of.
  // When one of these changes, React redraws the page with the new value.
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [linkedin, setLinkedin] = useState("");
  const [website, setWebsite] = useState("");
  const [profession, setProfession] = useState("");
  const [over18, setOver18] = useState(""); // "yes", "no", or "" for skipped
  const [sex, setSex] = useState("");
  const [location, setLocation] = useState("");
  const [photo, setPhoto] = useState(""); // the shrunk photo, or "" for none
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // When the page first loads, fill in the email they typed on the home page
  // (it gets passed along in the web address, like /register?email=...).
  useEffect(() => {
    if (emailInput.current) {
      emailInput.current.value = new URLSearchParams(window.location.search).get("email") ?? "";
    }
  }, []);

  // Runs when someone picks a photo: shrink it and show the preview.
  async function handlePhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setError("");
    try {
      setPhoto(await shrinkPhoto(file));
    } catch {
      setError("That photo couldn't be read. Try a different picture.");
    }
  }

  // Runs when someone presses "Create profile and check in".
  async function handleRegister(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); // stop the browser from reloading the page
    setLoading(true);
    setError("");

    try {
      const form = new FormData(event.currentTarget);
      const email = String(form.get("email") ?? "").trim().toLowerCase();
      await postAttendance<AttendanceResult>("/api/attendance/register", {
        email,
        firstName,
        lastName,
        linkedin,
        website,
        profession,
        over18,
        sex,
        location,
        photo: photo || undefined, // don't send anything if they skipped it
      });
      // Remember their email for this browser tab, so the list page knows who they are.
      sessionStorage.setItem("attendance-email", email);
      router.push("/listing");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not register.");
    } finally {
      setLoading(false);
    }
  }

  // What shows up on screen.
  return (
    <main style={styles.page}>
      <section style={styles.card}>
        <button type="button" onClick={() => router.push("/")} style={styles.back}>
          <FiArrowLeft size={16} /> Back
        </button>
        <div style={{ height: 16 }} />
        <ThemeDecor label="Attendee intake" />

        <h1 style={styles.title}>Create your profile</h1>
        <p style={styles.intro}>Add a few details so other attendees can connect with you.</p>

        <form onSubmit={handleRegister} style={styles.form}>
          {/* Photo picker. The real file input is hidden; the round preview is
              wrapped in a <label>, so tapping the circle opens the camera/photos. */}
          <label style={styles.photoPicker}>
            <span style={styles.photoCircle}>
              {photo
                ? <img src={photo} alt="Your profile photo" style={styles.photoImage} />
                : <FiUser size={34} />}
              <span style={styles.cameraBadge}><FiCamera size={14} /></span>
            </span>
            <span style={styles.photoText}>{photo ? "Change photo" : "Add a photo"} <span style={styles.optional}>Optional</span></span>
            <input type="file" accept="image/*" onChange={handlePhoto} style={{ display: "none" }} />
          </label>

          <div style={styles.row}>
            <label style={styles.label}>
              First name <span style={styles.required}>Required</span>
              <input autoComplete="given-name" required value={firstName} onChange={(event) => setFirstName(event.target.value)} style={styles.input} />
            </label>
            <label style={styles.label}>
              Last name <span style={styles.required}>Required</span>
              <input autoComplete="family-name" required value={lastName} onChange={(event) => setLastName(event.target.value)} style={styles.input} />
            </label>
          </div>
          <label style={styles.label}>
            Email <span style={styles.required}>Required</span>
            <input ref={emailInput} name="email" type="email" autoComplete="email" required style={styles.input} />
          </label>
          <label style={styles.label}>
            LinkedIn URL <span style={styles.required}>Required</span>
            <input type="url" placeholder="https://www.linkedin.com/in/you" required value={linkedin} onChange={(event) => setLinkedin(event.target.value)} style={styles.input} />
          </label>
          <label style={styles.label}>
            Profession <span style={styles.optional}>Optional</span>
            <input placeholder="e.g. Product designer" value={profession} onChange={(event) => setProfession(event.target.value)} style={styles.input} />
          </label>
          <label style={styles.label}>
            Website <span style={styles.optional}>Optional</span>
            <input type="url" placeholder="https://example.com" value={website} onChange={(event) => setWebsite(event.target.value)} style={styles.input} />
          </label>

          {/* Personal details. All optional, and they show on your card if you fill them in. */}
          <p style={styles.note}>These show on your card if you fill them in. Skip any you’d rather not share.</p>
          <div style={styles.row}>
            <label style={styles.label}>
              18 or older? <span style={styles.optional}>Optional</span>
              <select value={over18} onChange={(event) => setOver18(event.target.value)} style={styles.input}>
                <option value="">Prefer not to say</option>
                <option value="yes">Yes, 18+</option>
                <option value="no">No, under 18</option>
              </select>
            </label>
            <label style={styles.label}>
              Sex <span style={styles.optional}>Optional</span>
              <select value={sex} onChange={(event) => setSex(event.target.value)} style={styles.input}>
                <option value="">Prefer not to say</option>
                <option>Female</option>
                <option>Male</option>
                <option>Non-binary</option>
                <option>Other</option>
              </select>
            </label>
          </div>
          <label style={styles.label}>
            Location <span style={styles.optional}>Optional</span>
            <input placeholder="e.g. Queens, NY" autoComplete="address-level2" value={location} onChange={(event) => setLocation(event.target.value)} style={styles.input} />
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

// ==================================================================
// STYLES
// Colors, sizes and spacing for this page.
// ==================================================================
// All the looks for this page live down here, so the layout above stays readable.
const styles: Record<string, React.CSSProperties> = {
  page: { minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, boxSizing: "border-box", fontFamily: "var(--font-geist-sans), sans-serif" },
  card: { width: "100%", maxWidth: 480, background: "var(--ts-card)", padding: 32, borderRadius: "var(--ts-radius)", border: "1px solid var(--ts-card-border)", boxShadow: "var(--ts-card-shadow)", boxSizing: "border-box" },
  back: { display: "inline-flex", alignItems: "center", gap: 7, border: 0, background: "transparent", color: "var(--ts-muted)", padding: 0, cursor: "pointer" },
  title: { fontSize: 28, fontWeight: 700, color: "var(--ts-text)", margin: "0 0 8px", letterSpacing: "var(--ts-title-spacing)", fontFamily: "var(--ts-font-display)", textAlign: "center" },
  intro: { fontSize: 14, lineHeight: 1.55, color: "var(--ts-muted)", margin: "0 0 22px", textAlign: "center" },
  form: { display: "grid", gap: 14 },
  row: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 },
  label: { display: "grid", gridTemplateColumns: "1fr auto", gap: "7px 8px", color: "var(--ts-text)", fontSize: 13, fontWeight: 600, minWidth: 0 },
  required: { color: "var(--ts-accent)", fontSize: 11, fontWeight: 500 },
  optional: { color: "var(--ts-faint)", fontSize: 11, fontWeight: 500 },
  input: { gridColumn: "1 / -1", width: "100%", height: 46, padding: "0 13px", border: "1px solid var(--ts-input-border)", borderRadius: "var(--ts-radius-sm)", background: "var(--ts-input-bg)", color: "var(--ts-text)", font: "inherit", fontWeight: 400, boxSizing: "border-box" },
  note: { fontSize: 12, color: "var(--ts-muted)", margin: "6px 0 -4px", lineHeight: 1.5 },
  photoPicker: { display: "flex", flexDirection: "column", alignItems: "center", gap: 8, cursor: "pointer", marginBottom: 4 },
  photoCircle: { position: "relative", width: 96, height: 96, borderRadius: "50%", background: "var(--ts-accent-soft)", color: "var(--ts-accent)", display: "flex", alignItems: "center", justifyContent: "center" },
  photoImage: { width: "100%", height: "100%", borderRadius: "50%", objectFit: "cover" },
  cameraBadge: { position: "absolute", right: 0, bottom: 2, width: 30, height: 30, borderRadius: "50%", background: "var(--ts-accent)", color: "var(--ts-on-accent)", border: "3px solid var(--ts-card)", display: "flex", alignItems: "center", justifyContent: "center", boxSizing: "border-box" },
  photoText: { fontSize: 13, fontWeight: 600, color: "var(--ts-text)", display: "flex", gap: 6, alignItems: "center" },
  error: { color: "var(--ts-danger)", fontSize: 13, margin: 0 },
  submit: { height: 52, border: 0, borderRadius: "var(--ts-radius-sm)", background: "var(--ts-accent)", color: "var(--ts-on-accent)", fontSize: 15, fontWeight: 600, cursor: "pointer", marginTop: 4 },
};
