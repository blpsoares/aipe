// Org-chart filter/color/pan-zoom state and pure helpers — ported from
// app.html:912-920 (orgColor/orgHas/orgWorkerMatch/orgRepoVisible/orgWorkersFor)
// and app.html:1014-1072 (_orgZ + applyOrgTransform/orgZoom's zoom math).
//
// `orgQuery` and `orgTransform` are module-level signals (not component
// state) so they behave like the monolith's `_orgQuery`/`_orgZ` globals: they
// survive the org view unmounting/remounting (e.g. a snapshot-driven
// re-render of the whole app), instead of resetting to defaults every time.
import { signal, type Signal } from "@preact/signals";
import { stateVar } from "./statusMeta";
import type { Worker } from "./store";

export const orgQuery: Signal<string> = signal("");

export interface OrgTransform {
  s: number;
  x: number;
  y: number;
}

export const orgTransform: Signal<OrgTransform> = signal({ s: 1, x: 0, y: 0 });

export interface Size {
  width: number;
  height: number;
}

// The org SVG's natural (unscaled) content size, published by OrgChart on every
// render. Module-level so the toolbar's reset and the ResizeObserver can re-fit
// without reaching into the component — the same reason orgTransform lives here.
export const orgContent: Signal<Size> = signal<Size>({ width: 0, height: 0 });

// State color goes through the single --st-* map (SDD §9) — never a per-callsite
// choice of generic hue. `stateVar` already folds `redirected` to its own token
// (so it can't read as idle) and the delivered/verified/merged trio to distinct
// hues, which the old hand-mapping collapsed to one `--accent`.
export function orgColor(status: string | undefined): string {
  return stateVar(status);
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

// #5 — intentional org ordering. The monolith rendered specialists in the raw
// snapshot order (looked arbitrary). We order by role — dev-fullstack before QA —
// with a stable name tiebreaker. Roles today are "dev-fullstack" | "qa"
// (coordinator is filtered out of `workers` upstream); any unknown role sorts last.
const ROLE_RANK: Record<string, number> = { "dev-fullstack": 0, qa: 1 };
function roleRank(role: string | undefined): number {
  return ROLE_RANK[role ?? ""] ?? 2;
}

export function orgSortByRole(ws: Worker[]): Worker[] {
  return ws.slice().sort((a, b) => roleRank(a.role) - roleRank(b.role) || a.name.localeCompare(b.name));
}

// app.html:920 (+ #5 role ordering). Single point used by both OrgChart and
// OrgTree, so the intentional order propagates to both surfaces.
export function orgWorkersFor(workers: Worker[], name: string): Worker[] {
  const ws = workers.filter((w) => w.repo === name);
  const scoped = !orgNeedle() || orgHas(name) ? ws : ws.filter(orgWorkerMatch); // no filter / repo-name match -> show all
  return orgSortByRole(scoped);
}

const ZOOM_MIN = 0.3;
const ZOOM_MAX = 3;

function clampScale(s: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, s));
}

// The default breathing room, in px, between the org content and the viewport
// edges when fitting. Kept modest so the graph fills the surface but never
// touches the edge.
const FIT_MARGIN = 24;

/**
 * The transform that makes `content` fit inside `viewport` with `margin` px of
 * padding, centred, WITHOUT ever cropping (no scroll H nor V) — the fix for the
 * old fixed `s:1` start that overflowed (runtime/org.ts, j-20260827-jo).
 *
 * The scale is the smaller of the two axis ratios, capped at 1 so a small org
 * stays at natural size rather than being blown up. Degenerate inputs (a zero
 * dimension anywhere — e.g. measuring before layout) collapse to identity, so
 * callers never divide by zero or emit NaN. Scale is clamped to the same
 * [MIN,MAX] band as manual zoom; the wrap's `overflow:hidden` clips the extreme
 * case where even MIN cannot contain a huge graph (never reached at real sizes).
 */
export function fitTransform(content: Size, viewport: Size, margin = FIT_MARGIN): OrgTransform {
  if (content.width <= 0 || content.height <= 0 || viewport.width <= 0 || viewport.height <= 0) {
    return { s: 1, x: 0, y: 0 };
  }
  const availW = Math.max(0, viewport.width - margin * 2);
  const availH = Math.max(0, viewport.height - margin * 2);
  const s = clampScale(Math.min(availW / content.width, availH / content.height, 1));
  // The SVG is rendered as `translate(x,y) scale(s)` with transform-origin 0 0,
  // so content point (px,py) lands at (x+px·s, y+py·s). Centre both axes.
  const x = (viewport.width - content.width * s) / 2;
  const y = (viewport.height - content.height * s) / 2;
  return { s, x, y };
}

/** Re-frame the org to fit `viewport`, reading the published content size. */
export function fitToView(viewport: Size, margin = FIT_MARGIN): void {
  orgTransform.value = fitTransform(orgContent.value, viewport, margin);
}

// app.html:1021-1027 (orgZoom). dir: -1 out, +1 in, 0 reset. Zooms about the
// centre of `size` (the org wrap's bounding rect). Reset (dir 0) RE-FRAMES to
// fit — never a blind return to s:1 — so "reset" means "make it all fit again".
export function zoomBy(dir: number, size: Size = { width: 0, height: 0 }, margin = FIT_MARGIN): void {
  if (dir === 0) {
    fitToView(size, margin);
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
