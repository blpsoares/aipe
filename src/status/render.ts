// Terminal + JSON presentation for `aipe status`, in agentop's register (a
// two-space margin, dim scaffolding, aligned columns). Every renderer is pure and
// takes an explicit `color` boolean, so the CLI decides once (from the real
// stdout) whether to colorize and tests assert both modes. The JSON is the same
// data structured, so the coordinator pastes a markdown table into chat without
// re-deriving anything (item 3), and the delta (item 9) reuses the same
// projection so the three surfaces never drift.
import type { PublishState } from "../release/types";
import type { UnitPhase } from "../session/types";
import type { StatusFormat, StatusReport, UnitRow } from "./types";

const C = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  orange: "\x1b[38;5;208m",
  white: "\x1b[97m",
  green: "\x1b[92m",
  amber: "\x1b[93m",
  red: "\x1b[91m",
} as const;

function paint(s: string, code: string, color: boolean): string {
  return color ? `${code}${s}${C.reset}` : s;
}

// Off without a TTY (piped or read by a machine), off under NO_COLOR and the
// legacy TERM=dumb — the de-facto standard, matching `serve`'s presenter.
export function supportsColor(stream: { isTTY?: boolean } | undefined, env: Record<string, string | undefined>): boolean {
  if (env.NO_COLOR !== undefined && env.NO_COLOR !== "") return false;
  if (env.TERM === "dumb") return false;
  return !!stream?.isTTY;
}

const MARGIN = "  ";

// Visible width ignoring SGR escapes — alignment must count glyphs, not bytes.
const ANSI_G = /\x1b\[[0-9;]*m/g;
function visLen(s: string): number {
  return s.replace(ANSI_G, "").length;
}

function padCell(s: string, width: number): string {
  const pad = width - visLen(s);
  return pad > 0 ? s + " ".repeat(pad) : s;
}

// Keep a free-text cell (a redirect reason, a blocked reason) from blowing the
// grid past a pasteable width. A recorded reason can run to a full paragraph;
// the table shows the head and says "…", the full text stays in `--json`.
const DETAIL_MAX = 60;
export function clip(s: string, max = DETAIL_MAX): string {
  const flat = s.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

// A generic aligned grid: a dim header row, then rows. Columns are sized to their
// widest visible cell. Empty `rows` renders just a muted "(none)" under the head.
export function grid(headers: string[], rows: string[][], color: boolean): string[] {
  const widths = headers.map((h, i) =>
    Math.max(visLen(h), ...rows.map((r) => visLen(r[i] ?? ""))),
  );
  const last = headers.length - 1;
  // The final column is never padded, so no line carries trailing whitespace —
  // in either color mode, and clean to paste into a chat. Header is dim; data
  // cells are left as-is (some already carry their own SGR, e.g. the liveness
  // colour), only padded for alignment.
  const pad = (s: string, i: number): string => (i === last ? s : padCell(s, widths[i]!));
  const out = [MARGIN + headers.map((h, i) => paint(pad(h, i), C.dim, color)).join("  ")];
  if (rows.length === 0) {
    out.push(MARGIN + paint("(none)", C.dim, color));
    return out;
  }
  for (const r of rows) {
    out.push(MARGIN + r.map((c, i) => pad(c ?? "", i)).join("  "));
  }
  return out;
}

function title(text: string, color: boolean): string {
  return MARGIN + paint(text, `${C.bold}${C.orange}`, color);
}

function label(text: string, color: boolean): string {
  return MARGIN + paint(text, C.dim, color);
}

// PR url → `#NN` when it is a forge pull-request url; otherwise the raw value.
// A status table pasted into chat wants the number, not a 60-char url.
export function shortPr(pr: string | null): string {
  if (!pr) return "-";
  const m = pr.match(/\/pull\/(\d+)/);
  return m ? `#${m[1]}` : pr;
}

// The branch tail after the last "/", since the journey is already its own
// column — `aipe/j-…/jesse__status-cli` → `jesse__status-cli`.
function branchTail(branch: string): string {
  const i = branch.lastIndexOf("/");
  return i >= 0 ? branch.slice(i + 1) : branch;
}

const LIVE_LABEL: Record<UnitPhase, string> = {
  running: "alive",
  waiting: "blocked",
  unknown: "unknown",
  "dead-silent": "silent",
  landed: "landed",
  redirected: "redirect",
};

function liveCell(phase: UnitPhase | null, color: boolean): string {
  if (phase === null) return paint("-", C.dim, color);
  const text = LIVE_LABEL[phase];
  const code =
    phase === "running" ? C.green : phase === "unknown" ? C.amber : phase === "dead-silent" ? C.red : C.dim;
  return paint(text, code, color);
}

function who(u: UnitRow): string {
  return u.role ? `${u.specialist}·${u.role}` : u.specialist;
}

// A merged unit's status, annotated with its publication position so a
// merged-in-dev unit reads differently from a published one at a glance
// (j-20260830-zd). Only the non-published cases are decorated — a plain "merged"
// already means "merged AND published"; the noise is spent only where it warns.
const PUBLISH_SUFFIX: Record<PublishState, string> = {
  published: "",
  "merged-unpublished": "·unpublished",
  unknown: "·publish?",
};
function statusCell(u: UnitRow, color: boolean): string {
  if (u.status !== "merged" || u.publishState === null) return u.status;
  const suffix = PUBLISH_SUFFIX[u.publishState];
  if (!suffix) return u.status;
  const code = u.publishState === "merged-unpublished" ? C.amber : C.dim;
  return u.status + paint(suffix, code, color);
}

// ── unit projections (shared by the full table and the delta) ────────────────

const UNIT_HEADERS_DETAILED = ["JOURNEY", "WHO", "TASK", "FQID", "BRANCH", "PR", "STATUS", "LIVE"];
const UNIT_HEADERS_COMPACT = ["WHO", "FQID", "STATUS", "LIVE"];

function unitCells(u: UnitRow, format: StatusFormat, color: boolean): string[] {
  if (format === "compact") {
    return [who(u), u.fqid, statusCell(u, color), liveCell(u.liveness, color)];
  }
  return [
    u.journey,
    who(u),
    u.task ?? "-",
    u.fqid,
    branchTail(u.branch),
    shortPr(u.pr),
    statusCell(u, color),
    liveCell(u.liveness, color),
  ];
}

// The represado section (item 2): repos whose merged work is not yet published,
// shown in the same visibility class as WAITING ON YOU. `unknown` is listed too —
// the house rule is to say "could not establish", not to hide it. A published
// repo is silent. Reuses the generic grid, so it degrades to "(none)" when clear.
function represadoRows(report: StatusReport): string[][] {
  return report.releases
    .filter((r) => r.state !== "published")
    .map((r) => [r.repo, r.flow, r.state, clip(r.reason)]);
}

function unitHeaders(format: StatusFormat): string[] {
  return format === "compact" ? UNIT_HEADERS_COMPACT : UNIT_HEADERS_DETAILED;
}

// ── the full report table (item 3) ───────────────────────────────────────────

export function renderTable(report: StatusReport, format: StatusFormat, color: boolean): string[] {
  const out: string[] = ["", title(`aipe status — ${report.contextName || "workspace"}`, color)];
  const auto = report.pref.auto ? `on (${report.pref.format})` : "off";
  out.push(label(`scope ${report.scope} · auto-updates ${auto}`, color), "");

  // Journeys.
  out.push(label("JOURNEYS", color));
  out.push(
    ...grid(
      ["JOURNEY", "SPEC", "OPEN", "DONE", "TOTAL"],
      report.journeys.map((j) => [
        j.id,
        j.specVersion === null ? "none" : `v${j.specVersion} ${j.specApproved ? "approved" : "draft"}`,
        String(j.open),
        String(j.done),
        String(j.total),
      ]),
      color,
    ),
  );
  out.push("");

  // Units.
  out.push(label("UNITS", color));
  out.push(...grid(unitHeaders(format), report.units.map((u) => unitCells(u, format, color)), color));
  out.push("");

  // Waiting on the PE.
  out.push(label("WAITING ON YOU", color));
  out.push(
    ...grid(
      ["KIND", "JOURNEY", "FQID", "WHO", "DETAIL"],
      report.waiting.map((w) => [w.kind, w.journey, w.fqid, w.specialist, clip(w.detail)]),
      color,
    ),
  );
  out.push("");

  // Represado — merged work not yet published (item 2).
  out.push(label("REPRESADO — merged, not yet published", color));
  out.push(...grid(["REPO", "FLOW", "STATE", "DETAIL"], represadoRows(report), color));
  out.push("");

  // Liveness + elision honesty.
  out.push(label("NOTES", color));
  out.push(MARGIN + paint("liveness  ", C.dim, color) + report.liveness.note);
  if (report.elision) {
    out.push(
      MARGIN +
        paint("elided    ", C.dim, color) +
        `${report.elision.hiddenJourneys} journey(s) hidden — ${report.elision.reason}`,
    );
  }
  out.push("");
  return out;
}

// ── the post-change delta (item 9) ───────────────────────────────────────────
// Focused on what just changed, plus the frame around it (in-flight + waiting),
// broken into more than one table so nothing is squeezed into a grid too wide for
// the terminal. Reuses the same unit projection as the full table.

const IN_FLIGHT: Set<UnitPhase> = new Set(["running", "unknown", "waiting"]);

export function renderDelta(
  report: StatusReport,
  changed: UnitRow[],
  format: StatusFormat,
  color: boolean,
): string[] {
  const headers = unitHeaders(format);
  const out: string[] = ["", title("aipe · status update", color), ""];

  out.push(label("CHANGED", color));
  out.push(...grid(headers, changed.map((u) => unitCells(u, format, color)), color));
  out.push("");

  const inFlight = report.units.filter((u) => u.liveness !== null && IN_FLIGHT.has(u.liveness));
  out.push(label("IN FLIGHT", color));
  out.push(...grid(headers, inFlight.map((u) => unitCells(u, format, color)), color));
  out.push("");

  if (report.waiting.length > 0) {
    out.push(label("WAITING ON YOU", color));
    out.push(
      ...grid(
        ["KIND", "JOURNEY", "FQID", "WHO", "DETAIL"],
        report.waiting.map((w) => [w.kind, w.journey, w.fqid, w.specialist, clip(w.detail)]),
        color,
      ),
    );
    out.push("");
  }

  const represado = represadoRows(report);
  if (represado.length > 0) {
    out.push(label("REPRESADO — merged, not yet published", color));
    out.push(...grid(["REPO", "FLOW", "STATE", "DETAIL"], represado, color));
    out.push("");
  }
  return out;
}

// ── JSON (item 3) ─────────────────────────────────────────────────────────────
// The report as-is: the assembled shape IS the contract. Kept as an explicit
// function so the CLI never hand-rolls the serialization and the shape is one
// grep away.
export function renderJson(report: StatusReport): string {
  return JSON.stringify(report, null, 2);
}
