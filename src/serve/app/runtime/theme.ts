// The single source of truth for the color theme — one setter that BOTH the
// Topbar toggle and the Settings "Appearance → Theme" segment go through, so the
// two controls can never disagree, and every change is persisted to
// localStorage["aipe-theme"] so the choice survives a reload (language already
// did; theme did not — the interface-sweep finding). "" means auto (follow the
// OS via prefers-color-scheme); "light"/"dark" pin an explicit theme.
import { signal, type Signal } from "@preact/signals";

export type Theme = "" | "light" | "dark";
export const THEME_KEY = "aipe-theme";

/** The stored choice, or null when the PE never picked one (true auto default). */
export function readStoredTheme(): Theme | null {
  try {
    if (typeof localStorage === "undefined") return null;
    const v = localStorage.getItem(THEME_KEY);
    if (v === null) return null;
    return v === "light" || v === "dark" ? v : "";
  } catch {
    return null;
  }
}

/** Pure attribute writer — safe to call before hydration (and from an inline boot script). */
export function applyTheme(v: Theme): void {
  if (typeof document === "undefined") return;
  const html = document.documentElement;
  if (v) html.setAttribute("data-theme", v);
  else html.removeAttribute("data-theme");
}

export const theme: Signal<Theme> = signal(readStoredTheme() ?? "");

/** The one mutation both controls use: persist, apply, and update the shared signal. */
export function setTheme(v: Theme): void {
  theme.value = v;
  try {
    localStorage.setItem(THEME_KEY, v);
  } catch {
    // localStorage unavailable (private mode) — the attribute still applies this session
  }
  applyTheme(v);
}

// auto → dark → light → auto (the monolith's cycle order, now persisted).
const NEXT: Record<Theme, Theme> = { "": "dark", dark: "light", light: "" };

export function cycleTheme(): void {
  setTheme(NEXT[theme.value]);
}

// Apply the stored choice at import time (before first paint of the app tree).
applyTheme(theme.value);
