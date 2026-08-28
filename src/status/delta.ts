// Item 9 — after `aipe session dispatch` and after each `aipe journey record`
// that changes state, log the delta table (what just changed) plus the frame
// around it (what is in flight, what is waiting on the PE). It is presentation,
// never the operation: it is wrapped so a failure here can NEVER lose a dispatch
// or a ledger record.
//
// Three gates, all of which must be open for the table to print:
//   1. not explicitly silenced (`--no-status`, or AIPE_STATUS_DELTA=off);
//   2. stdout is a TTY — it is AUTOMATICALLY silent off a terminal or when read
//      by a machine, so a piped/parsed consumer never gets a table mid-stream
//      (read-state and the SessionStart hook never call this at all, but this is
//      the belt-and-braces for anyone piping dispatch/record);
//   3. the follow-preference is `auto:true` — item 10 makes (10) the switch for
//      (9). With `auto:false` the push is silent; the PULL (`aipe status`, and
//      the voice triggers) still works, always.
//
// It loads ONE report (`--all`) and renders only the small subsets (the changed
// units, the in-flight units, the waiting ones), so the same single derivation
// as item 3 feeds it and the printed tables stay short.
import { realRunner } from "../session/runner";
import type { AgentopRunner } from "../session/types";
import { loadReport } from "./load";
import { renderDelta, supportsColor } from "./render";
import type { UnitRow } from "./types";

export function deltaSilenced(argv: string[], env: Record<string, string | undefined>): boolean {
  if (argv.includes("--no-status")) return true;
  const v = (env.AIPE_STATUS_DELTA ?? "").toLowerCase();
  return v === "off" || v === "0" || v === "false" || v === "no";
}

export interface DeltaContext {
  workspace: string;
  journeyId: string;
  // Which units the change touched — the "delta" the PE is watching.
  changed: (u: UnitRow) => boolean;
  argv: string[];
  runner?: AgentopRunner;
  stdout?: { isTTY?: boolean };
  env?: Record<string, string | undefined>;
  log?: (line: string) => void;
}

// Returns the lines it printed (for tests); prints nothing and returns [] when
// any gate is closed or anything at all goes wrong.
export async function logStatusDelta(ctx: DeltaContext): Promise<string[]> {
  try {
    const env = ctx.env ?? process.env;
    const stdout = ctx.stdout ?? process.stdout;
    if (deltaSilenced(ctx.argv, env)) return [];
    if (!stdout.isTTY) return []; // auto-silent off a TTY / when read by a machine
    const report = await loadReport(ctx.workspace, {
      scope: "all",
      journeyId: ctx.journeyId,
      runner: ctx.runner ?? realRunner,
    });
    if (!report.pref.auto) return []; // (10) is the switch for (9)
    const color = supportsColor(stdout, env);
    const changed = report.units.filter(ctx.changed);
    const lines = renderDelta(report, changed, report.pref.format, color);
    const emit = ctx.log ?? console.log;
    for (const line of lines) emit(line);
    return lines;
  } catch {
    // presentation only — the dispatch and the ledger record already stand.
    return [];
  }
}
