/*
 * Technically Social: the list of event themes
 * Written by Himal Shrestha
 *
 * One place that lists every theme. The server uses it to check that a theme
 * name is real, and the organizer page uses it to show the theme picker.
 * The actual colors live in app/globals.css.
 */

export const themes = [
  {
    id: "after-hours",
    name: "After hours",
    description: "FiDi skyline at night with warm orange window light.",
    swatch: ["#14121A", "#1C1924", "#E8743B", "#F3EDE6"],
  },
  {
    id: "ticker",
    name: "Ticker",
    description: "Trading terminal: amber on black with a scrolling ticker.",
    swatch: ["#08090B", "#0F1114", "#FF9A3C", "#ECEAE5"],
  },
  {
    id: "secure",
    name: "Secure channel",
    description: "Cybersecurity console: green on black with scanlines.",
    swatch: ["#04070B", "#070C12", "#3DDC97", "#D3F5E6"],
  },
  {
    id: "blueprint",
    name: "Blueprint",
    description: "Engineering schematic: white lines on blue grid paper.",
    swatch: ["#0E2A4A", "#10305A", "#8FB8E3", "#E4EEF9"],
  },
] as const;

export type ThemeId = (typeof themes)[number]["id"];

// The theme used when an organizer hasn't picked one for the event.
export const defaultTheme: ThemeId = "after-hours";

// True if the text is one of the real theme names above.
export function isThemeId(value: unknown): value is ThemeId {
  return themes.some((theme) => theme.id === value);
}

// Saved in the browser so the right theme shows up instantly on the next page.
export const themeStorageKey = "ts-theme";
