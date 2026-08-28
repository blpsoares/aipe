// Item 8 — the STATE block injected at SessionStart, alongside the identity and
// laws that already go in. A new coordinator session should know not just HOW to
// work but WHAT is in flight: open journeys, units being worked and by whom, what
// is waiting on the PE, and what is queued. It reuses the ONE derivation of item
// 3 (a `StatusReport`), so nothing is re-computed here.
//
// Two hard limits (both asserted by tests, not eyeballed):
//   • Budget — this goes into EVERY session's context, so it is bounded to
//     `STATE_BLOCK_MAX` chars. If the detail would overflow, the names are
//     dropped but the counts and the "run `aipe status`" pointer always survive,
//     so the coordinator is never told a wrong number and always knows how to get
//     the rest — never the whole ledger dumped in.
//   • It must never break session open — the caller wraps this, but the function
//     itself is pure and total over any report.
import type { StatusReport } from "./types";

export const STATE_BLOCK_MAX = 900;

// A unit still being actively worked or awaiting its QA gate — the "in flight"
// set, derived from ledger status (liveness is intentionally not resolved for the
// hook: it must be fast and must not shell out to agentop, item 8).
function inFlight(report: StatusReport) {
  return report.units.filter((u) => u.status === "dispatched" || u.status === "delivered");
}

function waitingSummary(report: StatusReport): string {
  if (report.waiting.length === 0) return "0 waiting on you";
  const counts = new Map<string, number>();
  for (const w of report.waiting) counts.set(w.kind, (counts.get(w.kind) ?? 0) + 1);
  const parts = [...counts.entries()].map(([k, n]) => `${n} ${k}`).join(", ");
  return `${report.waiting.length} waiting on you (${parts})`;
}

export function renderStateBlock(report: StatusReport): string {
  const openJourneys = report.journeys.filter((j) => j.open > 0).length;
  const flight = inFlight(report);
  // Queued: a journey whose spec is approved but that has dispatched nothing yet.
  const queued = report.journeys.filter((j) => j.total === 0 && j.specApproved).length;

  const names = flight.map((u) => `${u.specialist}·${u.fqid}`);

  // Build richest-first, then fall back if over budget: the names are the first
  // thing to go, the counts and the pointer never are. (The follow-preference is
  // stated separately, from read-state's Fields, so it survives even if this
  // richer block cannot be assembled.)
  const head =
    `CURRENT STATE — ${openJourneys} open journey(s), ${flight.length} unit(s) in flight, ` +
    `${waitingSummary(report)}, ${queued} queued (approved spec, not yet dispatched).`;
  const pointer = ` Run \`aipe status\` for the full table; \`aipe status --json\` for machine detail.`;

  const withNames =
    names.length > 0 ? `${head} In flight: ${names.join(", ")}.${pointer}` : `${head}${pointer}`;
  if (withNames.length <= STATE_BLOCK_MAX) return withNames;

  // Too long with every name — trim the name list to what fits, marking the rest.
  const bare = `${head}${pointer}`;
  let kept = names.length;
  while (kept > 0) {
    const shown = names.slice(0, kept);
    const more = names.length - kept;
    const line = `${head} In flight: ${shown.join(", ")}${more > 0 ? `, +${more} more` : ""}.${pointer}`;
    if (line.length <= STATE_BLOCK_MAX) return line;
    kept--;
  }
  return bare;
}
