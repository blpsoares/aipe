// Org-chart filter/color/pan-zoom state and pure helpers — ported from
// app.html:912-920 (orgColor/orgHas/orgWorkerMatch/orgRepoVisible/orgWorkersFor)
// and app.html:1014-1072 (_orgZ + applyOrgTransform/orgZoom's zoom math).
//
// `orgQuery` and `orgTransform` are module-level signals (not component
// state) so they behave like the monolith's `_orgQuery`/`_orgZ` globals: they
// survive the org view unmounting/remounting (e.g. a snapshot-driven
// re-render of the whole app), instead of resetting to defaults every time.
import { signal, type Signal } from "@preact/signals";
import type { Worker } from "./store";

export const orgQuery: Signal<string> = signal("");

export interface OrgTransform {
  s: number;
  x: number;
  y: number;
}

export const orgTransform: Signal<OrgTransform> = signal({ s: 1, x: 0, y: 0 });

// app.html:912
export function orgColor(status: string | undefined): string {
  return status === "active" ? "var(--sky)" : status === "delivered" ? "var(--accent)" : status === "escalated" ? "var(--amber)" : "var(--slate)";
}

// app.html:918. `orgQuery` holds the RAW typed value (so the search input can
// display the user's case/whitespace without the caret jumping); the needle is
// trimmed + lowercased here at comparison time, matching the monolith which
// lowercased `_orgQuery` only for internal matching.
export function orgHas(txt: unknown): boolean {
  return String(txt ?? "")
    .toLowerCase()
    .includes(orgNeedle());
}

// The active filter needle: the raw typed query trimmed + lowercased. Empty
// string ("" — also the case for a whitespace-only query) means "no filter".
export function orgNeedle(): string {
  return orgQuery.value.trim().toLowerCase();
}

// app.html:918
export function orgWorkerMatch(w: Pick<Worker, "name" | "role" | "package" | "repo">): boolean {
  return orgHas(w.name) || orgHas(w.role) || orgHas(w.package) || orgHas(w.repo);
}

// app.html:919
export function orgRepoVisible(workers: Worker[], name: string): boolean {
  if (!orgNeedle()) return true;
  if (orgHas(name)) return true;
  return workers.some((w) => w.repo === name && orgWorkerMatch(w));
}

// app.html:920
export function orgWorkersFor(workers: Worker[], name: string): Worker[] {
  const ws = workers.filter((w) => w.repo === name);
  if (!orgNeedle() || orgHas(name)) return ws; // no filter, or repo name itself matches -> show all
  return ws.filter(orgWorkerMatch);
}

interface Size {
  width: number;
  height: number;
}

const ZOOM_MIN = 0.3;
const ZOOM_MAX = 3;

function clampScale(s: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, s));
}

// app.html:1021-1027 (orgZoom). dir: -1 out, +1 in, 0 reset. Zooms about the
// centre of `size` (the org wrap's bounding rect).
export function zoomBy(dir: number, size: Size = { width: 0, height: 0 }): void {
  if (dir === 0) {
    orgTransform.value = { s: 1, x: 0, y: 0 };
    return;
  }
  const cur = orgTransform.value;
  const mx = size.width / 2;
  const my = size.height / 2;
  const ns = clampScale(cur.s * (dir > 0 ? 1.2 : 1 / 1.2));
  const k = ns / cur.s;
  orgTransform.value = { s: ns, x: mx - (mx - cur.x) * k, y: my - (my - cur.y) * k };
}

// app.html:1050-1052 (wrap.onwheel). Zooms toward the cursor position
// (mx, my — coordinates relative to the wrap element).
export function zoomAtPoint(mx: number, my: number, deltaY: number): void {
  const cur = orgTransform.value;
  const ns = clampScale(cur.s * Math.exp(-deltaY * 0.0015));
  const k = ns / cur.s;
  orgTransform.value = { s: ns, x: mx - (mx - cur.x) * k, y: my - (my - cur.y) * k };
}

// app.html:1067-1071 (orgFullscreen). Toggles fullscreen on `el`, with the
// same webkit-prefixed fallbacks as the monolith.
export function toggleFullscreen(el: HTMLElement | null): void {
  if (!el) return;
  type FsDoc = Document & { webkitFullscreenElement?: Element; webkitExitFullscreen?: () => void };
  type FsEl = HTMLElement & { webkitRequestFullscreen?: () => void };
  const doc = document as FsDoc;
  const fsEl = document.fullscreenElement || doc.webkitFullscreenElement;
  if (fsEl) {
    (document.exitFullscreen || doc.webkitExitFullscreen || (() => {})).call(document);
  } else {
    const target = el as FsEl;
    (target.requestFullscreen || target.webkitRequestFullscreen || (() => {})).call(target);
  }
}
