// 5.4 — the coordinator AS A WORKER. Derives, from the ledger alone, what the
// coordinator is waiting on and what it will do next — kept strictly separate
// from what the PE must act on (the decision inbox). "The coordinator is
// waiting" and "the PE must act" were collapsed into one surface before; here
// they are two.
//
// 5.5 — one coordinator per context. The console renders a SINGLE coordinator
// identity (the brain's `context.coordinator`), aggregating every journey it
// owns. If several coordinator sessions happen to be open, that is surfaced as a
// fact about SESSIONS, never as multiple coordinators — and this touches only
// presentation: not the identity model, the ledger, dispatch, or persona
// resolution.
import type { Dispatch } from "./store";
import type { JourneyLike } from "./floor";

export interface WaitItem {
  unit: string;
  who: string;
  /** i18n key describing what the coordinator is waiting on. */
  whatKey: string;
}
export interface NextItem {
  unit: string;
  /** i18n key describing the coordinator's next action once unblocked. */
  actionKey: string;
}

export interface CoordinatorView {
  /** What the coordinator itself is waiting on (progress it monitors, not PE actions). */
  waiting: WaitItem[];
  /** What the coordinator will do next once a unit is unblocked. */
  next: NextItem[];
  /** How many things the PE must act on (the decision inbox) — kept separate. */
  needsPE: number;
}

function fqid(d: Dispatch): string {
  return d.package ? `${d.repo}/${d.package}` : String(d.repo);
}

export function coordinatorView(journey: JourneyLike | null, inboxCount: number): CoordinatorView {
  const waiting: WaitItem[] = [];
  const next: NextItem[] = [];
  const ds = journey?.dispatches ?? [];
  for (const d of ds) {
    const unit = fqid(d);
    const who = String(d.specialist ?? "—");
    switch (d.status) {
      case "delivered":
        // Waiting on QA to run the gate.
        waiting.push({ unit, who, whatKey: "co_wait_qa" });
        break;
      case "dispatched":
        // Waiting on the specialist to deliver.
        waiting.push({ unit, who, whatKey: "co_wait_dev" });
        break;
      case "verified":
        // Cleared by QA — the coordinator's move is to merge.
        next.push({ unit, actionKey: "co_next_merge" });
        break;
      case "failed":
        // QA rejected — the coordinator re-dispatches the dev.
        next.push({ unit, actionKey: "co_next_redispatch" });
        break;
      case "redirected":
        // A human redirected it — the coordinator reconciles the spec.
        next.push({ unit, actionKey: "co_next_reconcile" });
        break;
      case "blocked":
        // The specialist is stuck and waiting on the coordinator — the
        // coordinator owes it an answer. NEVER shown as "building it": inferring
        // progress from a stalled unit was defect D7.
        next.push({ unit, actionKey: "co_next_unblock" });
        break;
      // escalated → the PE must act; counted in the inbox, not here.
      default:
        break;
    }
  }
  return { waiting, next, needsPE: inboxCount };
}
