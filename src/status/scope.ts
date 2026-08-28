// Which journeys the report shows (item 4). The default must stay short enough to
// paste into a chat — today's raw list ran past a hundred rows and was useless —
// so it shows only journeys with open work plus a few recently-closed ones, and
// says out loud how many it hid. `--all` is the escape hatch to the full history.
import type { JourneyLedger } from "../journey/types";
import { OPEN_STATUSES } from "./constants";
import type { Elision, StatusScope } from "./types";

export const DEFAULT_RECENT_CLOSED = 3;

function hasOpenWork(l: JourneyLedger): boolean {
  return l.dispatches.some((d) => OPEN_STATUSES.has(d.status));
}

// Newest first: ids are date-prefixed (`j-YYYYMMDD-xx`), so a descending string
// sort is chronological, and the most recent work is what the PE just asked about.
function byIdDesc(a: JourneyLedger, b: JourneyLedger): number {
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

export interface Selection {
  selected: JourneyLedger[];
  elision: Elision | null;
  scope: StatusScope;
}

export function selectJourneys(
  all: JourneyLedger[],
  opts: { scope: StatusScope; journeyId?: string; recentClosed?: number },
): Selection {
  const sorted = [...all].sort(byIdDesc);

  if (opts.scope === "journey") {
    const one = sorted.filter((l) => l.id === opts.journeyId);
    return { selected: one, elision: null, scope: "journey" };
  }

  if (opts.scope === "all") {
    return { selected: sorted, elision: null, scope: "all" };
  }

  // default: open-work journeys + the N most recent closed ones. A journey with
  // zero dispatches is neither active nor "recently closed work" — it holds no
  // slot, so the recent-closed budget surfaces actually-finished journeys rather
  // than empty shells the coordinator just scaffolded.
  const limit = opts.recentClosed ?? DEFAULT_RECENT_CLOSED;
  const active = sorted.filter(hasOpenWork);
  const closed = sorted.filter((l) => !hasOpenWork(l) && l.dispatches.length > 0);
  const recentClosed = closed.slice(0, limit);
  const selected = [...active, ...recentClosed].sort(byIdDesc);
  const hidden = sorted.length - selected.length;
  const elision: Elision | null =
    hidden > 0
      ? {
          shownJourneys: selected.length,
          totalJourneys: sorted.length,
          hiddenJourneys: hidden,
          reason: `showing journeys with open work plus the ${recentClosed.length} most recently closed; run \`aipe status --all\` for the full history`,
        }
      : null;
  return { selected, elision, scope: "default" };
}
