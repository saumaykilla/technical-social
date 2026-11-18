"use client";

/*
 * Technically Social: theme loader
 * Written by Himal Shrestha
 *
 * Runs on every page. Asks the server "what theme is today's event using?"
 * and puts the answer on <html data-theme="...">, which recolors everything.
 *
 * It also re-checks every 20 seconds, so when an organizer switches the theme
 * on /admin, everyone who already has the page open sees it change live.
 *
 * Preview trick: adding ?theme=ticker (or secure / blueprint / after-hours)
 * to any address forces that theme, handy for testing on a phone.
 */

import { useEffect } from "react";
import { defaultTheme, isThemeId, themeStorageKey, type ThemeId } from "@/lib/themes";

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

// How often to check for a theme change (20 seconds, in milliseconds).
const checkEvery = 20_000;

// Switches the whole site to a theme and remembers it in this browser tab.
export function applyTheme(theme: ThemeId) {
  document.documentElement.dataset.theme = theme;
  try {
    sessionStorage.setItem(themeStorageKey, theme);
  } catch {
    // Private browsing can block storage. The theme still applies, it just isn't remembered.
  }
}

export default function ThemeProvider() {
  useEffect(() => {
    // 1. A ?theme= in the address wins (preview mode).
    const preview = new URLSearchParams(window.location.search).get("theme");
    if (isThemeId(preview)) {
      applyTheme(preview);
      return;
    }

    // 2. Otherwise ask the server what today's event is using.
    //    If the server can't be reached, keep whatever is already showing.
    let cancelled = false;
    function checkTheme() {
      // On /admin the organizer previews themes by clicking them, so don't
      // let the live check snap the page back while they're choosing.
      if (window.location.pathname.startsWith("/admin")) return;
      fetch(`${apiUrl}/api/theme`)
        .then((response) => response.json())
        .then((data: { theme?: unknown }) => {
          if (!cancelled) applyTheme(isThemeId(data.theme) ? data.theme : defaultTheme);
        })
        .catch(() => {});
    }

    checkTheme();                                   // once right away
    const timer = setInterval(checkTheme, checkEvery); // then every 20 seconds
    return () => {
      cancelled = true;
      clearInterval(timer); // stop checking if this component goes away
    };
  }, []);

  // This component doesn't draw anything. It only sets the theme.
  return null;
}
