import { signal, type Signal } from "@preact/signals";
import { routes } from "../routes.generated";
import type { Route } from "../route-types";
import { closeMobile } from "./ui";

// ── Hash router ──────────────────────────────────────────────────────────
// The server (handler.ts) only answers GET / and GET /index.html — every
// other pathname 404s (by design, we do not touch server.ts in this task).
// A reload must therefore always hit "/"; the active view lives in the URL
// *hash* (mirroring app.html's storedView/go, app.html:1159-1184) and in
// localStorage["aipe-view"] as a same-tab fallback when the hash is absent.
//
// `currentPath` is fed as the `url` prop to a freshly-keyed <LocationProvider>
// (main.tsx) on every change — preact-iso's Router/Route then do the actual
// path→component matching for the view area. We deliberately do not drive
// navigation through preact-iso's own history.pushState-based `route()`,
// since that would rewrite the address bar's pathname (e.g. to "/pipeline")
// and break the very reload-safety this hash scheme exists to preserve.

const STORAGE_KEY = "aipe-view";
const appRoutes = routes as Route[];

function isValidPath(p: string | null | undefined): p is string {
  return !!p && appRoutes.some((r) => r.path === p);
}

function pathFromHash(): string | null {
  if (typeof location === "undefined") return null;
  const h = (location.hash || "").replace(/^#\/?/, "");
  return h ? "/" + h : null;
}

function pathFromStorage(): string | null {
  try {
    const v = typeof localStorage !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null;
    return v ? "/" + v.replace(/^\//, "") : null;
  } catch {
    return null;
  }
}

function resolveInitialPath(): string {
  const fromHash = pathFromHash();
  if (isValidPath(fromHash)) return fromHash;
  const fromStorage = pathFromStorage();
  if (isValidPath(fromStorage)) return fromStorage;
  return "/overview";
}

export const currentPath: Signal<string> = signal(resolveInitialPath());

export function navigate(path: string): void {
  const p = isValidPath(path) ? path : "/overview";
  currentPath.value = p;
  const bare = p.replace(/^\//, "");
  try {
    localStorage.setItem(STORAGE_KEY, bare);
  } catch {
    // localStorage unavailable (e.g. private mode) — hash still carries state
  }
  if (typeof location !== "undefined") {
    const hash = "#/" + bare;
    if (location.hash !== hash) location.hash = hash;
  }
  closeMobile();
}

// Browser back/forward and manual hash edits route without re-triggering
// navigate()'s own hash write (app.html:1184's `_routing` guard, simplified:
// navigate() is idempotent when the hash already matches).
if (typeof window !== "undefined") {
  window.addEventListener("hashchange", () => {
    const p = pathFromHash();
    if (isValidPath(p) && p !== currentPath.value) navigate(p);
  });
}
