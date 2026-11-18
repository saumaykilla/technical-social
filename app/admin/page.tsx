"use client";

import { FormEvent, useState } from "react";
import { FiCalendar, FiCheck, FiChevronDown, FiChevronRight, FiDownload, FiLock, FiTrash2, FiUserMinus } from "react-icons/fi";
import { postAttendance, type Attendee } from "@/lib/attendance-api";
import { defaultTheme, themes, type ThemeId } from "@/lib/themes";
import { applyTheme } from "@/app/theme-provider";
import ThemeDecor from "@/app/theme-decor";

/*
 * Technically Social: organizer page (/admin)
 * Written by Himal Shrestha
 *
 * Password-protected page for organizers only. It shows EVERY event and
 * everyone who came (emails included), lets organizers remove someone from an
 * event or delete them entirely, and downloads the lists as spreadsheets
 * (CSV files). Needs the ADMIN_PASSWORD from the .env file.
 */

// ==================================================================
// DATA SHAPES
// What the organizer data looks like.
// ==================================================================
type AdminAttendee = Attendee & { email: string; checked_in_at: string };
type AdminEvent = { date: string; attendees: AdminAttendee[] };
// What the server sends back when the organizer signs in.
type AdminData = { events: AdminEvent[]; themes: { date: string; theme: ThemeId }[]; today: string };
// Which button the organizer pressed, while we wait for them to confirm it.
type PendingAction = { action: "remove" | "delete"; userId: string; date: string; name: string };

// ==================================================================
// HELPERS
// Date formatting and the spreadsheet (CSV) download.
// ==================================================================
// "2026-11-16" -> "Monday, November 16, 2026"
function prettyDate(date: string): string {
  return new Date(`${date}T12:00:00`).toLocaleDateString(undefined, {
    weekday: "long", month: "long", day: "numeric", year: "numeric",
  });
}

// CSV = a plain-text spreadsheet: one line per row, commas between columns.
// Every value gets wrapped in quotes so commas inside names don't break columns.
// The extra ' in front of values starting with = + - @ stops Excel from
// treating someone's typed text as a formula (a known spreadsheet trick).
function toCsv(events: AdminEvent[]): string {
  const cell = (value: unknown) => {
    let text = value === null || value === undefined ? "" : String(value);
    if (/^[=+\-@]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
  };
  const header = ["Event date", "Checked in at", "First name", "Last name", "Email", "Profession", "LinkedIn", "Website", "18+", "Sex", "Location"];
  const rows = events.flatMap(({ date, attendees }) =>
    attendees.map((person) => [
      date,
      new Date(person.checked_in_at).toLocaleTimeString(),
      person.first_name ?? person.name,
      person.last_name ?? "",
      person.email,
      person.profession,
      person.linkedin,
      person.website,
      person.over_18 === null ? "" : person.over_18 ? "Yes" : "No",
      person.sex,
      person.location,
    ]),
  );
  return [header, ...rows].map((row) => row.map(cell).join(",")).join("\r\n");
}

// Makes the browser download a file without needing a server for it.
function downloadCsv(events: AdminEvent[], fileName: string) {
  const blob = new Blob([toCsv(events)], { type: "text/csv;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(link.href);
}

// ==================================================================
// THE PAGE
// Sign-in screen first, then the list of all events.
// ==================================================================
export default function AdminPage() {
  const [password, setPassword] = useState("");
  const [events, setEvents] = useState<AdminEvent[] | null>(null);
  const [open, setOpen] = useState<string | null>(null); // which event is expanded
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [pending, setPending] = useState<PendingAction | null>(null); // waiting on "Yes, remove"
  const [working, setWorking] = useState(false);
  const [notice, setNotice] = useState(""); // little message after a remove/delete
  // Event theme picker
  const [eventThemes, setEventThemes] = useState<Record<string, ThemeId>>({}); // date -> theme
  const [themeDate, setThemeDate] = useState("");                               // which event we're styling
  const [themeChoice, setThemeChoice] = useState<ThemeId>(defaultTheme);        // the highlighted option
  const [savingTheme, setSavingTheme] = useState(false);

  // Runs when the organizer presses "Sign in": send the password, get every event back.
  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const result = await postAttendance<AdminData>("/api/admin/events", { password });
      setEvents(result.events);
      // Load the saved themes and start the picker on today's event.
      const saved = Object.fromEntries(result.themes.map(({ date, theme }) => [date, theme])) as Record<string, ThemeId>;
      setEventThemes(saved);
      setThemeDate(result.today);
      setThemeChoice(saved[result.today] ?? defaultTheme);
      applyTheme(saved[result.today] ?? defaultTheme); // show the page in today's theme
      setOpen(result.events[0]?.date ?? null); // auto-open the newest event
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not sign in.");
    } finally {
      setLoading(false);
    }
  }

  // Runs after the organizer confirms. Asks the server to do it, then updates
  // the list on screen right away so we don't have to reload everything.
  async function confirmAction() {
    if (!pending) return;
    setWorking(true);
    setNotice("");
    try {
      if (pending.action === "remove") {
        await postAttendance("/api/admin/remove-checkin", { password, userId: pending.userId, date: pending.date });
        // Take them out of just that one event.
        setEvents((current) => current && current
          .map((item) => item.date === pending.date
            ? { ...item, attendees: item.attendees.filter((person) => person.id !== pending.userId) }
            : item)
          .filter((item) => item.attendees.length > 0)); // hide events that are now empty
        setNotice(`Removed ${pending.name} from ${prettyDate(pending.date)}.`);
      } else {
        await postAttendance("/api/admin/delete-person", { password, userId: pending.userId });
        // Take them out of EVERY event.
        setEvents((current) => current && current
          .map((item) => ({ ...item, attendees: item.attendees.filter((person) => person.id !== pending.userId) }))
          .filter((item) => item.attendees.length > 0));
        setNotice(`Deleted ${pending.name} and all their check-ins.`);
      }
      setPending(null);
    } catch (requestError) {
      setNotice(requestError instanceof Error ? requestError.message : "Something went wrong.");
    } finally {
      setWorking(false);
    }
  }

  // ---- Theme picker actions ----

  // Picking a different date shows the theme already saved for it (or the default).
  function changeThemeDate(date: string) {
    setThemeDate(date);
    const saved = eventThemes[date] ?? defaultTheme;
    setThemeChoice(saved);
    applyTheme(saved);
  }

  // Clicking a theme previews it on this page right away (nothing is saved yet).
  function previewTheme(theme: ThemeId) {
    setThemeChoice(theme);
    applyTheme(theme);
  }

  // "Save" stores the theme for that date, so attendees see it at that event.
  async function saveTheme() {
    if (!themeDate) return;
    setSavingTheme(true);
    setNotice("");
    try {
      await postAttendance("/api/admin/theme", { password, date: themeDate, theme: themeChoice });
      setEventThemes((current) => ({ ...current, [themeDate]: themeChoice }));
      const name = themes.find((theme) => theme.id === themeChoice)?.name;
      setNotice(`${prettyDate(themeDate)} will use the ${name} theme.`);
    } catch (requestError) {
      setNotice(requestError instanceof Error ? requestError.message : "Could not save the theme.");
    } finally {
      setSavingTheme(false);
    }
  }

  // Not signed in yet: show the password box.
  if (!events) {
    return (
      <main style={styles.page}>
        <section style={{ ...styles.card, maxWidth: 420 }}>
          <ThemeDecor label="Organizer" />
          <div style={styles.logo}><FiLock size={24} /></div>
          <h1 style={styles.title}>Organizer access</h1>
          <p style={styles.intro}>See every event and everyone who checked in.</p>
          <form onSubmit={handleLogin} style={{ display: "grid", gap: 12 }}>
            <input type="password" aria-label="Organizer password" placeholder="Organizer password" required
              value={password} onChange={(event) => setPassword(event.target.value)} style={styles.input} />
            {error && <p role="alert" style={styles.error}>{error}</p>}
            <button type="submit" disabled={loading} style={styles.primary}>{loading ? "Checking…" : "Sign in"}</button>
          </form>
        </section>
      </main>
    );
  }

  const totalCheckIns = events.reduce((sum, { attendees }) => sum + attendees.length, 0);

  // Signed in: show every event.
  return (
    <main style={styles.page}>
      <section style={{ ...styles.card, maxWidth: 1200 }}>
        <ThemeDecor label="Organizer" />
        <div style={styles.headerRow}>
          <div>
            <h1 style={{ ...styles.title, textAlign: "left" }}>All events</h1>
            <p style={{ ...styles.intro, textAlign: "left", margin: 0 }}>
              {events.length} {events.length === 1 ? "event" : "events"} · {totalCheckIns} check-ins
            </p>
          </div>
          {events.length > 0 && (
            <button type="button" onClick={() => downloadCsv(events, "technically-social-all-events.csv")} style={styles.secondary}>
              <FiDownload size={15} /> Download all
            </button>
          )}
        </div>

        {/* ---- Event theme picker ----
            Pick a date (today or upcoming), click a theme to preview it on this
            page, then save it. Everyone checking in on that date sees it. */}
        <section style={styles.themePanel}>
          <div style={styles.themeHeader}>
            <span style={styles.themeTitle}>Event theme</span>
            <label style={styles.themeDateLabel}>
              Event date
              <input type="date" value={themeDate} onChange={(event) => changeThemeDate(event.target.value)} style={styles.dateInput} />
            </label>
          </div>
          <div style={styles.themeGrid}>
            {themes.map((theme) => {
              const selected = theme.id === themeChoice;
              return (
                <button key={theme.id} type="button" onClick={() => previewTheme(theme.id)}
                  style={{ ...styles.themeOption, borderColor: selected ? "var(--ts-accent)" : "var(--ts-input-border)" }}>
                  {/* The four little color blocks are a sneak peek of that theme. */}
                  <span style={styles.swatches}>
                    {theme.swatch.map((color) => <span key={color} style={{ ...styles.swatch, background: color }} />)}
                  </span>
                  <span style={styles.themeName}>
                    {theme.name}
                    {selected && <FiCheck size={14} style={{ color: "var(--ts-accent)" }} />}
                  </span>
                  <span style={styles.themeDescription}>{theme.description}</span>
                </button>
              );
            })}
          </div>
          <button type="button" onClick={saveTheme} disabled={savingTheme || !themeDate} style={{ ...styles.primary, height: 42, padding: "0 18px", marginTop: 12 }}>
            {savingTheme ? "Saving…" : themeDate ? `Save for ${prettyDate(themeDate)}` : "Pick a date"}
          </button>
        </section>

        {notice && <p role="status" style={styles.notice}>{notice}</p>}
        {events.length === 0 && <p style={styles.intro}>No check-ins yet.</p>}

        {events.map((item) => {
          const isOpen = open === item.date;
          return (
            <section key={item.date} style={styles.event}>
              {/* Clicking the header opens/closes that event's list */}
              <button type="button" onClick={() => setOpen(isOpen ? null : item.date)} style={styles.eventHeader}>
                {isOpen ? <FiChevronDown size={18} /> : <FiChevronRight size={18} />}
                <FiCalendar size={16} style={{ color: "var(--ts-accent)" }} />
                <span style={styles.eventDate}>{prettyDate(item.date)}</span>
                {/* Which theme this event used */}
                <span style={styles.themeTag}>
                  {themes.find((theme) => theme.id === (eventThemes[item.date] ?? defaultTheme))?.name}
                </span>
                <span style={styles.badge}>{item.attendees.length}</span>
              </button>

              {isOpen && (
                <div style={{ overflowX: "auto" }}>
                  <table style={styles.table}>
                    <thead>
                      <tr>{/* Two columns have no title (photo + buttons), so the position number is used as the key. */}
                        {["", "Name", "Email", "Profession", "Details", "Links", "Checked in", ""].map((h, i) => <th key={i} style={styles.th}>{h}</th>)}</tr>
                    </thead>
                    <tbody>
                      {item.attendees.map((person) => (
                        <tr key={person.id}>
                          <td style={styles.td}>
                            {person.photo_url
                              ? <img src={person.photo_url} alt="" style={styles.avatar} />
                              : <span style={{ ...styles.avatar, ...styles.initials }}>{person.name.charAt(0)}</span>}
                          </td>
                          <td style={{ ...styles.td, fontWeight: 600, color: "var(--ts-text)" }}>{person.name}</td>
                          <td style={styles.td}>{person.email}</td>
                          <td style={styles.td}>{person.profession ?? "—"}</td>
                          <td style={styles.td}>
                            {[person.over_18 === null ? null : person.over_18 ? "18+" : "Under 18", person.sex, person.location]
                              .filter(Boolean).join(" · ") || "—"}
                          </td>
                          <td style={styles.td}>
                            <a href={person.linkedin} target="_blank" rel="noreferrer" style={styles.link}>LinkedIn</a>
                            {person.website && <> · <a href={person.website} target="_blank" rel="noreferrer" style={styles.link}>Website</a></>}
                          </td>
                          <td style={styles.td}>{new Date(person.checked_in_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</td>
                          <td style={{ ...styles.td, whiteSpace: "normal", minWidth: 190 }}>
                            {/* If this row's button was just pressed, ask "are you sure?" right here.
                                Otherwise show the two normal buttons. */}
                            {pending && pending.userId === person.id && pending.date === item.date ? (
                              <span style={styles.confirm}>
                                {pending.action === "remove" ? "Remove from this event?" : "Delete everywhere? Can’t undo."}
                                <button type="button" disabled={working} onClick={confirmAction} style={styles.danger}>
                                  {working ? "…" : "Yes"}
                                </button>
                                <button type="button" disabled={working} onClick={() => setPending(null)} style={styles.small}>Cancel</button>
                              </span>
                            ) : (
                              <span style={styles.actions}>
                                <button type="button" title="Remove from this event only"
                                  onClick={() => setPending({ action: "remove", userId: person.id, date: item.date, name: person.name })}
                                  style={styles.small}>
                                  <FiUserMinus size={13} /> Remove
                                </button>
                                <button type="button" title="Delete this person and all their check-ins"
                                  onClick={() => setPending({ action: "delete", userId: person.id, date: item.date, name: person.name })}
                                  style={{ ...styles.small, color: "var(--ts-danger)" }}>
                                  <FiTrash2 size={13} /> Delete
                                </button>
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {isOpen && (
                <button type="button" onClick={() => downloadCsv([item], `technically-social-${item.date}.csv`)} style={{ ...styles.secondary, marginTop: 12 }}>
                  <FiDownload size={15} /> Download this event
                </button>
              )}
            </section>
          );
        })}
      </section>
    </main>
  );
}

// ==================================================================
// STYLES
// Colors, sizes and spacing for this page.
// ==================================================================
const styles: Record<string, React.CSSProperties> = {
  page: { minHeight: "100vh", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: 24, boxSizing: "border-box", fontFamily: "var(--font-geist-sans), sans-serif" },
  card: { width: "100%", background: "var(--ts-card)", padding: 32, borderRadius: "var(--ts-radius)", border: "1px solid var(--ts-card-border)", boxShadow: "var(--ts-card-shadow)", boxSizing: "border-box", marginTop: 40 },
  logo: { width: 52, height: 52, borderRadius: "var(--ts-radius-sm)", background: "var(--ts-accent-soft)", color: "var(--ts-accent)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 20px" },
  title: { fontSize: 26, fontWeight: 700, color: "var(--ts-text)", margin: "0 0 8px", letterSpacing: "var(--ts-title-spacing)", fontFamily: "var(--ts-font-display)", textAlign: "center" },
  intro: { fontSize: 14, lineHeight: 1.55, color: "var(--ts-muted)", margin: "0 0 22px", textAlign: "center" },
  input: { width: "100%", height: 48, padding: "0 14px", border: "1px solid var(--ts-input-border)", borderRadius: "var(--ts-radius-sm)", background: "var(--ts-input-bg)", color: "var(--ts-text)", font: "inherit", boxSizing: "border-box" },
  primary: { height: 50, border: 0, borderRadius: "var(--ts-radius-sm)", background: "var(--ts-accent)", color: "var(--ts-on-accent)", fontSize: 15, fontWeight: 600, cursor: "pointer" },
  secondary: { display: "inline-flex", alignItems: "center", gap: 7, height: 40, padding: "0 14px", border: "1px solid var(--ts-input-border)", borderRadius: "var(--ts-radius-sm)", background: "transparent", color: "var(--ts-text)", fontSize: 13, fontWeight: 600, cursor: "pointer" },
  error: { color: "var(--ts-danger)", fontSize: 13, margin: 0 },
  headerRow: { display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 16, flexWrap: "wrap", marginBottom: 20 },
  event: { borderTop: "1px solid var(--ts-card-border)", padding: "14px 0" },
  eventHeader: { display: "flex", alignItems: "center", gap: 10, width: "100%", border: 0, background: "transparent", padding: "4px 0", cursor: "pointer", color: "var(--ts-text)", font: "inherit" },
  eventDate: { fontWeight: 600, fontSize: 15, color: "var(--ts-text)" },
  badge: { marginLeft: "auto", background: "var(--ts-accent-soft)", color: "var(--ts-accent)", borderRadius: 999, padding: "2px 10px", fontSize: 12, fontWeight: 700 },
  table: { width: "100%", borderCollapse: "collapse", marginTop: 12, fontSize: 13 },
  th: { textAlign: "left", color: "var(--ts-faint)", fontWeight: 600, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5, padding: "8px 10px", borderBottom: "1px solid var(--ts-card-border)" },
  td: { padding: "10px", borderBottom: "1px solid var(--ts-row-border)", color: "var(--ts-text)", verticalAlign: "middle", whiteSpace: "nowrap" },
  avatar: { width: 34, height: 34, borderRadius: "50%", objectFit: "cover", display: "block" },
  initials: { background: "var(--ts-accent-soft)", color: "var(--ts-accent)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700 },
  link: { color: "var(--ts-accent)", textDecoration: "none" },
  actions: { display: "inline-flex", gap: 6 },
  confirm: { display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", color: "var(--ts-danger)", fontWeight: 600 },
  small: { display: "inline-flex", alignItems: "center", gap: 4, height: 30, padding: "0 10px", border: "1px solid var(--ts-input-border)", borderRadius: "var(--ts-radius-sm)", background: "transparent", color: "var(--ts-text)", fontSize: 12, cursor: "pointer" },
  danger: { height: 30, padding: "0 12px", border: 0, borderRadius: "var(--ts-radius-sm)", background: "var(--ts-danger)", color: "var(--ts-on-accent)", fontSize: 12, fontWeight: 600, cursor: "pointer" },
  themePanel: { border: "1px solid var(--ts-card-border)", borderRadius: "var(--ts-radius-sm)", padding: 16, marginBottom: 20, background: "var(--ts-row-bg)" },
  themeHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 12 },
  themeTitle: { fontWeight: 600, fontSize: 15, color: "var(--ts-text)", fontFamily: "var(--ts-font-display)" },
  themeDateLabel: { display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--ts-muted)" },
  dateInput: { height: 36, padding: "0 10px", border: "1px solid var(--ts-input-border)", borderRadius: "var(--ts-radius-sm)", background: "var(--ts-input-bg)", color: "var(--ts-text)", font: "inherit", colorScheme: "dark" },
  themeGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 10 },
  themeOption: { display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 6, padding: 12, border: "1.5px solid", borderRadius: "var(--ts-radius-sm)", background: "var(--ts-card)", color: "var(--ts-text)", cursor: "pointer", textAlign: "left", font: "inherit" },
  swatches: { display: "flex", gap: 3 },
  swatch: { width: 22, height: 14, borderRadius: 2, border: "1px solid rgba(255,255,255,0.12)" },
  themeName: { display: "flex", alignItems: "center", gap: 6, fontWeight: 600, fontSize: 14 },
  themeDescription: { fontSize: 12, color: "var(--ts-muted)", lineHeight: 1.4 },
  themeTag: { fontSize: 11, color: "var(--ts-muted)", border: "1px solid var(--ts-input-border)", borderRadius: 999, padding: "2px 8px", marginLeft: 6 },
  notice: { background: "var(--ts-accent-soft)", border: "1px solid var(--ts-card-border)", color: "var(--ts-text)", borderRadius: "var(--ts-radius-sm)", padding: "10px 14px", fontSize: 13, margin: "0 0 12px" },
};
