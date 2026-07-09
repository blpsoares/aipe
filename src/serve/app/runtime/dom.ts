// Pure DOM/string helpers ported 1:1 from src/serve/app.html:512-514, 608, 610, 708.
// In JSX components escaping is automatic; `esc` stays available for raw string/SVG cases.

export function esc(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}

export function initials(n: string): string {
  return n.split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
}

export function hue(n: string): number {
  let h = 0;
  for (const c of n) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}

// Dispatch-shaped input for dkey/fqidOf; kept loose (unknown extra fields tolerated,
// repo optional since some call sites — e.g. status-only events — omit it).
interface DkeyInput {
  repo?: string | null;
  package?: string | null;
  specialist?: string | null;
}

export function dkey(d: DkeyInput): string {
  return `${d.repo ?? ""}${d.package ? "/" + d.package : ""}::${(d.specialist || "").toLowerCase()}`;
}

interface FqidOfInput {
  repo?: string | null;
  package?: string | null;
}

export function fqidOf(d: FqidOfInput): string {
  return d.package ? `${d.repo}/${d.package}` : String(d.repo ?? "");
}

interface FqidWorkerInput {
  repo?: string | null;
  package?: string | null;
}

export function fqid(w: FqidWorkerInput): string {
  return w.package ? `${w.repo}/${w.package}` : String(w.repo ?? "");
}
