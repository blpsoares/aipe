import type { Snapshot, WorkerStatus } from "./snapshot";

const C = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  magenta: "\x1b[35m",
  gray: "\x1b[90m",
};

const STATUS_GLYPH: Record<WorkerStatus, string> = {
  active: "●",
  delivered: "✓",
  escalated: "⚠",
  available: "○",
};
const STATUS_COLOR: Record<WorkerStatus, string> = {
  active: C.cyan,
  delivered: C.green,
  escalated: C.yellow,
  available: C.gray,
};

export interface RenderOpts {
  color?: boolean;
  now?: string; // injected timestamp label (keeps render pure)
}

export function renderDashboard(s: Snapshot, opts: RenderOpts = {}): string {
  const color = opts.color ?? true;
  const paint = (code: string, text: string) => (color ? `${code}${text}${C.reset}` : text);
  const out: string[] = [];

  if (!s.ok) {
    out.push(paint(C.yellow, "AIPe dashboard — not an onboarded workspace"));
    if (s.error) out.push(paint(C.gray, s.error));
    return out.join("\n");
  }

  const title = `AIPe · ${s.context.name}`;
  out.push(paint(C.bold + C.magenta, `╭─ ${title} ${"─".repeat(Math.max(1, 48 - title.length))}╮`));
  out.push(`${paint(C.magenta, "│")} coordinator ${paint(C.bold, s.context.coordinator)}  ·  repos ${s.repos.join(", ")}`);
  if (opts.now) out.push(`${paint(C.magenta, "│")} ${paint(C.gray, opts.now)}`);
  out.push(paint(C.magenta, "╰" + "─".repeat(50) + "╯"));

  // KPI row
  const c = s.counts;
  out.push(
    [
      paint(C.bold, `${c.hired}`) + paint(C.gray, " hired"),
      paint(C.cyan, `${c.active}`) + paint(C.gray, " active"),
      paint(C.gray, `${c.available} available`),
      paint(C.green, `${c.delivered}`) + paint(C.gray, " delivered"),
      paint(C.yellow, `${c.escalated}`) + paint(C.gray, " escalated"),
      paint(C.gray, `· ${s.worktrees} worktrees · ${s.skills} skills · ${s.mcps} mcps`),
    ].join("  "),
  );
  out.push("");

  // Workers by repo
  out.push(paint(C.bold, "WORKERS"));
  const coord = s.workers.find((w) => w.role === "coordinator");
  if (coord) out.push(`  ${paint(C.magenta, "★")} ${paint(C.bold, coord.name)} ${paint(C.gray, "coordinator")}`);
  for (const repo of s.repos) {
    out.push(`  ${paint(C.dim, repo)}`);
    const workers = s.workers.filter((w) => w.repo === repo);
    if (workers.length === 0) {
      out.push(`    ${paint(C.gray, "— no specialists hired —")}`);
      continue;
    }
    for (const w of workers) {
      const glyph = paint(STATUS_COLOR[w.status], STATUS_GLYPH[w.status]);
      const extra = w.status === "delivered" && w.pr ? paint(C.gray, `  ${w.pr}`) : "";
      const jn = w.journey ? paint(C.gray, ` (${w.journey})`) : "";
      out.push(`    ${glyph} ${w.name} ${paint(C.gray, w.role)}${jn}${extra}`);
    }
  }
  out.push("");

  // Pipeline
  out.push(paint(C.bold, "PIPELINE"));
  const activeJourneys = s.journeys.filter((j) => j.dispatches.length > 0);
  if (activeJourneys.length === 0) {
    out.push(`  ${paint(C.gray, "no journeys yet")}`);
  } else {
    for (const j of activeJourneys) {
      out.push(`  ${paint(C.bold, j.id)}`);
      for (const d of j.dispatches) {
        const st = (["active", "delivered", "escalated", "available"] as const).includes(d.status as WorkerStatus)
          ? (d.status as WorkerStatus)
          : d.status === "dispatched" ? "active" : "available";
        const glyph = paint(STATUS_COLOR[st], STATUS_GLYPH[st]);
        const pr = d.pr ? paint(C.gray, `  ${d.pr}`) : "";
        out.push(`    ${glyph} ${paint(C.dim, d.repo)} · ${d.specialist} ${paint(C.gray, d.status)}${pr}`);
      }
    }
  }

  return out.join("\n");
}
