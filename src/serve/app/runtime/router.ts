import { signal, type Signal } from "@preact/signals";
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

// Known route paths, duplicated (manually kept in sync) from each
// views/*.view.tsx route.path rather than imported from routes.generated.ts.
// That generated module transitively imports every view; a view that itself
// imports navigate()/currentPath from this module (as views legitimately do,
// for their nav CTAs) would create a cycle — view -> router ->
// routes.generated -> (back to) the same view — that throws a
// "Cannot access '<binding>' before initialization" ReferenceError while the
// modules are still resolving. Since the 8 views are fixed (routes.generated.ts
// only ever globs views/*.view.tsx, and no new view files are added mid-task),
// this list is stable; update it if a views/*.view.tsx path ever changes.
// Redesign (j-20260827-s9): the primary screens + 2 footer utilities.
// j-20260829-dp added "/activity" (Atividade) as the fourth primary screen.
const KNOWN_PATHS = ["/", "/team", "/history", "/guide", "/settings"];

function isValidPath(p: string | null | undefined): p is string {
  return !!p && KNOWN_PATHS.includes(p);
}

function pathFromHash(): string | null {
  if (typeof location === "undefined") return null;
  const h = (location.hash || "").replace(/^#\/?/, "");
  return h ? "/" + h : null;
}

// The target path for a hashchange EVENT (distinct from resolveInitialPath's
// first-load resolution, which falls back to storage on an absent hash). On a
// change, an empty or bare "#/" hash is an explicit navigation to the Floor —
// map it to "/" rather than null, so browser back/forward from another view
// back to the Floor re-syncs currentPath (and with it the topbar + active nav)
// instead of stranding it on the previous view. Returns null for an unknown
// path so a bogus manual hash is ignored.
export function hashTarget(rawHash: string): string | null {
  const stripped = (rawHash || "").replace(/^#\/?/, "");
  const p = stripped ? "/" + stripped : "/";
  return isValidPath(p) ? p : null;
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
  return "/"; // The Floor is the landing route.
}

export const currentPath: Signal<string> = signal(resolveInitialPath());

// An in-view anchor to scroll to after navigation (e.g. a status chip opening the
// status guide at its own card). Consumed and cleared by the target view.
export const focusAnchor: Signal<string | null> = signal(null);

export function navigate(path: string): void {
  const p = isValidPath(path) ? path : "/"; // Agora is the landing route
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
    const p = hashTarget(location.hash || "");
    if (p && p !== currentPath.value) navigate(p);
  });
}
