// Drives light/dark mode app-wide. The actual color values live entirely
// in index.css's token blocks — this context's only job is deciding which
// one applies, by keeping a `data-theme="light"|"dark"` attribute on
// <html> in sync with the user's choice (or the system's, until they make
// one). See index.css's own "Dark mode" comment for how that attribute is
// consumed.
//
// Resolution order, checked once on first load:
//   1. An explicit choice already saved in localStorage from a previous
//      visit — always wins, forever, until the user flips the toggle
//      again.
//   2. No saved choice yet — fall back to the OS/browser's own
//      prefers-color-scheme, so a visitor whose system is set to dark
//      isn't dropped into a bright light page on their very first visit.
// Toggling in the UI (MenuPage's Switch) always writes an explicit choice
// to localStorage from that point on, which is what makes it override the
// system default for every future visit even if the OS setting changes
// later.
import { createContext, useContext, useEffect, useState } from "react";

const ThemeContext = createContext(null);

const STORAGE_KEY = "qx_theme";

function resolveInitialTheme() {
  // Guards against server-side/non-browser execution — not currently a
  // real scenario for this Vite SPA, but cheap insurance against a crash
  // if that ever changes.
  if (typeof window === "undefined") return "light";

  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved === "light" || saved === "dark") return saved;

  const systemPrefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  return systemPrefersDark ? "dark" : "light";
}

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(resolveInitialTheme);

  // Keeps <html data-theme="..."> in sync with React state — index.css's
  // :root[data-theme="dark"] block is what actually applies the palette;
  // this effect is purely the bridge from state to that DOM attribute.
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  function toggleTheme() {
    setTheme((prev) => {
      const next = prev === "dark" ? "light" : "dark";
      // Writing here (not in the effect above) means only an ACTUAL user
      // toggle ever creates a saved preference — the system-preference
      // fallback in resolveInitialTheme() never gets silently written to
      // localStorage just because the page rendered once, which is what
      // keeps that fallback re-checking the OS setting on every visit
      // until the user actually chooses for themselves.
      localStorage.setItem(STORAGE_KEY, next);
      return next;
    });
  }

  return <ThemeContext.Provider value={{ theme, toggleTheme }}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}
