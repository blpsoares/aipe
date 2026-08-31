// Terminal presentation for `aipe serve`, in `agentop`'s register: a two-space
// margin, a bold title, dim uppercase section labels, and aligned label/value
// rows under each, with liveness dots. Quiet by default, legible at a glance.
//
// Every renderer is pure — it takes a `color` boolean and returns string[], so
// the CLI decides once (from the real stdout) whether to colorize and the tests
// can assert both modes. Machine-readable content (the URL, the PID, the port)
// is always present verbatim; color is only ever an SGR wrapper around it.
import { formatElapsed as _fmt } from "./present-time";
import type { ServeEntry } from "../runtime/serve-registry";

export { formatElapsed } from "./present-time";

// agentop's palette (see `agentop status`): orange title, dim scaffolding,
// bright white values, green/amber/red dots.
const C = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  orange: "\x1b[38;5;208m",
  white: "\x1b[97m",
  cyan: "\x1b[96m",
  green: "\x1b[92m",
  amber: "\x1b[93m",
  red: "\x1b[91m",
} as const;

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;]*m/;
export function hasAnsi(s: string): boolean {
  return ANSI_RE.test(s);
}

function paint(s: string, code: string, color: boolean): string {
  return color ? `${code}${s}${C.reset}` : s;
}

/**
 * Whether stdout should carry ANSI color. Off without a TTY (piped, or the
 * detached child whose stdio is ignored), off under NO_COLOR (the de-facto
 * standard) and the legacy `TERM=dumb`.
 */
export function supportsColor(
  stream: { isTTY?: boolean } | undefined,
  env: Record<string, string | undefined>,
): boolean {
  if (env.NO_COLOR !== undefined && env.NO_COLOR !== "") return false;
  if (env.TERM === "dumb") return false;
  return !!stream?.isTTY;
}

type Dot = "up" | "down" | "warn";
function dot(kind: Dot, color: boolean): string {
  if (kind === "down") return paint("○", C.dim, color);
  const glyph = "●";
  const code = kind === "warn" ? C.amber : C.green;
  return paint(glyph, code, color);
}

interface Row {
  k: string;
  v: string;
  dot?: Dot;
  /** Render the value dim rather than white (paths, hints). */
  muted?: boolean;
}

const MARGIN = "  ";
const INDENT = "    ";

function title(text: string, color: boolean): string {
  return `${MARGIN}${paint(text, `${C.bold}${C.orange}`, color)}`;
}

function section(label: string, rows: Row[], color: boolean): string[] {
  const width = rows.reduce((m, r) => Math.max(m, r.k.length), 0);
  const out = [`${MARGIN}${paint(label, C.dim, color)}`];
  for (const r of rows) {
    const key = paint(r.k.padEnd(width), C.dim, color);
    const val = r.v === "" ? "" : paint(r.v, r.muted ? C.dim : C.white, color);
    const lead = r.dot ? `${dot(r.dot, color)} ` : "";
    out.push(`${INDENT}${lead}${key}  ${val}`.replace(/\s+$/, ""));
  }
  return out;
}

// ── Banner (attached start) ────────────────────────────────────────────────

/** One way this console can be reached: an established URL, or a declared non-establishment. */
export interface ReachRow {
  label: string;
  /** The full URL when established; an explanation of why not, otherwise. Never a guess. */
  value: string;
  established: boolean;
}

export interface BannerInfo {
  /** Loopback: one row, always established. Off loopback: one row per address kind (lan, tailscale), each established or not — never `localhost`. */
  reach: ReachRow[];
  workspace: string;
  /** Access notice lines (empty on loopback). */
  notice: string[];
}

export function renderBanner(info: BannerInfo, color: boolean): string[] {
  const out: string[] = ["", title("aipe serve", color), ""];
  out.push(...section("CONSOLE", [
    ...info.reach.map((r): Row => ({ k: r.label, v: r.value, dot: r.established ? "up" : "down", muted: !r.established })),
    { k: "workspace", v: info.workspace, muted: true },
  ], color));
  out.push("");
  if (info.notice.length > 0) {
    out.push(`${MARGIN}${paint("ACCESS", C.dim, color)}`);
    for (const line of info.notice) out.push(`${INDENT}${paint(line, C.amber, color)}`);
    out.push("");
  } else {
    out.push(...section("ACCESS", [
      { k: "reach", v: "local only — nothing leaves this machine", muted: true },
    ], color));
    out.push("");
  }
  return out;
}

/** The single live line the CLI rewrites in place as SSE clients come and go. */
export function liveLine(clients: number, color: boolean): string {
  const kind: Dot = clients > 0 ? "up" : "down";
  const label = clients === 0 ? "waiting for the first client — Ctrl-C to stop" : `${clients} client${clients === 1 ? "" : "s"} connected — Ctrl-C to stop`;
  return `${MARGIN}${dot(kind, color)} ${paint(label, C.dim, color)}`;
}

// ── status ──────────────────────────────────────────────────────────────────

export function renderStatus(matched: ServeEntry[], workspace: string, nowMs: number, color: boolean): string[] {
  const out: string[] = ["", title("aipe serve status", color), ""];
  if (matched.length === 0) {
    out.push(...section("STATE", [{ k: "console", v: "not running for this workspace", dot: "down", muted: true }], color));
    out.push(...section("WORKSPACE", [{ k: "path", v: workspace, muted: true }], color));
    out.push("");
    return out;
  }
  for (const e of matched) {
    out.push(...section("CONSOLE", [
      { k: "state", v: "running", dot: "up" },
      { k: "pid", v: String(e.pid) },
      { k: "port", v: String(e.port) },
      { k: "host", v: e.host, muted: true },
      { k: "workspace", v: e.workspace, muted: true },
      { k: "version", v: e.version || "?", muted: true },
      { k: "uptime", v: _fmt(Math.max(0, nowMs - e.startedAt)), muted: true },
    ], color));
    out.push("");
  }
  return out;
}

// ── stop ──────────────────────────────────────────────────────────────────

export function renderStop(stopped: number[], workspace: string, color: boolean): string[] {
  const out: string[] = ["", title("aipe serve stop", color), ""];
  if (stopped.length === 0) {
    out.push(...section("STATE", [{ k: "console", v: "nothing to stop — no console running for this workspace", dot: "down", muted: true }], color));
    out.push(...section("WORKSPACE", [{ k: "path", v: workspace, muted: true }], color));
  } else {
    out.push(...section("STOPPED", stopped.map((pid) => ({ k: "pid", v: String(pid), dot: "warn" as Dot })), color));
    out.push(...section("WORKSPACE", [{ k: "path", v: workspace, muted: true }], color));
  }
  out.push("");
  return out;
}

// ── tailscale ─────────────────────────────────────────────────────────────

export interface TailscaleReport {
  /** no-console: nothing running for this workspace to point Serve at. failed: the CLI call itself errored. ready: Serve confirmed forwarding to our port. unverified: the config call succeeded but Serve doesn't show it forwarding yet. */
  state: "no-console" | "failed" | "ready" | "unverified";
  workspace: string;
  reason?: string;
  host?: string | null;
  token?: string;
}

export function renderTailscale(info: TailscaleReport, color: boolean): string[] {
  const out: string[] = ["", title("aipe serve tailscale", color), ""];
  if (info.state === "no-console") {
    out.push(...section("STATE", [
      { k: "console", v: "not running for this workspace — start one first with `aipe serve`", dot: "down", muted: true },
    ], color));
    out.push(...section("WORKSPACE", [{ k: "path", v: info.workspace, muted: true }], color));
  } else if (info.state === "failed") {
    out.push(...section("STATE", [{ k: "tailscale serve", v: info.reason ?? "failed", dot: "down" }], color));
  } else {
    const established = info.state === "ready";
    const url = info.host ? `https://${info.host}${info.token ? `/?token=${info.token}` : ""}` : "not established";
    out.push(...section("STATE", [{ k: "tailscale", v: url, dot: established ? "up" : "warn" }], color));
    if (!established) {
      out.push(...section("NOTE", [
        { k: "", v: "config applied, but `tailscale serve status` doesn't show it forwarding yet — check again in a moment", muted: true },
      ], color));
    }
  }
  out.push("");
  return out;
}

// ── help ──────────────────────────────────────────────────────────────────

export function renderHelp(color: boolean): string[] {
  const cmd = (name: string, desc: string): string => `${INDENT}${paint(name.padEnd(22), C.cyan, color)}${paint(desc, C.dim, color)}`;
  const opt = (name: string, desc: string): string => `${INDENT}${paint(name.padEnd(22), C.white, color)}${paint(desc, C.dim, color)}`;
  return [
    "",
    title("aipe serve", color),
    `${MARGIN}${paint("The AIPe Web Console — the whole context, live over SSE, in your browser.", C.dim, color)}`,
    "",
    `${MARGIN}${paint("Usage", C.dim, color)}`,
    `${INDENT}${paint("aipe serve", C.white, color)} ${paint("[--port <n>] [--host <addr>] [--workspace <dir>] [--background] [--insecure]", C.dim, color)}`,
    `${INDENT}${paint("aipe serve status", C.white, color)}   ${paint("— is a console running for this workspace?", C.dim, color)}`,
    `${INDENT}${paint("aipe serve stop", C.white, color)}     ${paint("— stop the background console for this workspace", C.dim, color)}`,
    `${INDENT}${paint("aipe serve tailscale", C.white, color)} ${paint("— point Tailscale Serve's HTTPS/443 at this workspace's console", C.dim, color)}`,
    "",
    `${MARGIN}${paint("Commands", C.dim, color)}`,
    cmd("status", "Report the running console (port, PID, workspace, uptime); exit 3 if none"),
    cmd("stop", "Stop the detached console for this workspace (idempotent)"),
    cmd("tailscale", "Set up Tailscale Serve so the console is reachable at a stable https://…ts.net URL"),
    "",
    `${MARGIN}${paint("Options", C.dim, color)}`,
    opt("--port <n>", "Port to bind (default 4317)"),
    opt("--host <addr>", "Bind address (default 127.0.0.1; off loopback a token is required)"),
    opt("--workspace <dir>", "Workspace to serve (default: current directory)"),
    opt("--background, -d", "Detach and run in the background; prints the PID"),
    opt("--insecure", "Serve off loopback without a token (deliberate; warns)"),
    opt("--help, -h", "Show this help and exit without binding the port"),
    "",
  ];
}
