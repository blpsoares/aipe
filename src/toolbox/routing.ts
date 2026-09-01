import { resolveKit } from "./registry";
import type { SkillEntry, TaskSize, Toolbox } from "./types";

const SIZE_RANK: Record<TaskSize, number> = { small: 0, medium: 1, large: 2 };

export interface TaskShape {
  taskType?: string;
  size?: TaskSize;
}

// Does ONE skill's structured routing apply to this task? A skill with no
// `routing` always applies (unknown → the coordinator decides from the
// free-text `whenToUse`). Shared by `matchSkills` (the additive list) and
// `routeSdd` (the single SDD decision) so the two can never drift on what
// "applies" means.
export function skillApplies(skill: SkillEntry, task: TaskShape): boolean {
  const r = skill.routing;
  if (!r) return true;
  if (task.taskType && r.skipFor?.some((t) => t.toLowerCase() === task.taskType!.toLowerCase())) return false;
  if (task.taskType && r.taskTypes && !r.taskTypes.some((t) => t.toLowerCase() === task.taskType!.toLowerCase())) {
    return false;
  }
  if (r.minSize && task.size && SIZE_RANK[task.size] < SIZE_RANK[r.minSize]) return false;
  return true;
}

// Deterministically filters the catalog to the skills that apply to a task,
// using the structured `routing` signals.
export function matchSkills(toolbox: Toolbox, task: TaskShape): SkillEntry[] {
  return toolbox.skills.filter((s) => skillApplies(s, task));
}

// The two SDD tiers, floor first. `FULL_SDD_KIT` is the heavy flow whose
// presence + threshold is what makes `--size` route (and the delivery gate in
// journey/ledger.ts bite); `FLOOR_SDD_KIT` is the always-available light floor.
export const FULL_SDD_KIT = "spec-kit";
export const FLOOR_SDD_KIT = "sdd-lite";

export interface SddRoute {
  kit: string | null; // the ONE SDD tier chosen for this task; null ⇒ none installed
  reason: string; // why — names the threshold, so `--size` is never a decorative flag
}

// The single SDD routing DECISION for a task (#118): not an additive list, but
// which one SDD tier this task should follow.
//
// The routing THRESHOLD is the full kit's contract, read from the REGISTRY
// (`resolveKit(FULL_SDD_KIT).routing`), NEVER from the installed toolbox entry.
// A pre-#118 `aipe skill add spec-kit` (v1.16.0) wrote that entry with no
// `routing:` block at all; reading the threshold off the entry then made
// `skillApplies` pass every size, and a `?? "medium"` fallback fabricated a
// number in the REASON that no comparison had used — the exact "signal that
// lies comfortably" this issue exists to kill (`--size small` claiming
// "small ≥ medium"). So the threshold comes from the kit's own definition, and
// every branch's `reason` states the comparison that was ACTUALLY made — if no
// threshold was applied, it says so instead of inventing one.
export function routeSdd(toolbox: Toolbox, task: TaskShape): SddRoute {
  const fullInstalled = toolbox.skills.some((s) => s.name === FULL_SDD_KIT);
  const floorInstalled = toolbox.skills.some((s) => s.name === FLOOR_SDD_KIT);
  const floorOr = (reason: string): SddRoute =>
    floorInstalled ? { kit: FLOOR_SDD_KIT, reason } : { kit: null, reason: `${reason}; and no ${FLOOR_SDD_KIT} floor is installed` };

  if (!fullInstalled) {
    return floorInstalled
      ? { kit: FLOOR_SDD_KIT, reason: `${FULL_SDD_KIT} is NOT installed — only the light ${FLOOR_SDD_KIT} floor is reachable (run \`aipe skill preset\`/\`rehydrate\` to install it)` }
      : { kit: null, reason: "no SDD kit is installed in this workspace — the SDD flow is unreachable" };
  }

  const contract = resolveKit(FULL_SDD_KIT)?.routing;

  // skipFor overrides size — a chore/one-liner is never the full flow.
  if (task.taskType && contract?.skipFor?.some((t) => t.toLowerCase() === task.taskType!.toLowerCase())) {
    return floorOr(`task type "${task.taskType}" is on ${FULL_SDD_KIT}'s skip list → the light ${FLOOR_SDD_KIT} floor`);
  }

  const threshold = contract?.minSize;
  if (!threshold) {
    // The routing kit declares NO size threshold. Do NOT fabricate one and do
    // NOT force the heavy flow on every task — say the threshold is absent.
    return floorOr(`${FULL_SDD_KIT} declares no size threshold — cannot route by difficulty (no size comparison made) → the light ${FLOOR_SDD_KIT} floor`);
  }
  if (!task.size) {
    // A threshold exists but there is no size to compare it against — never
    // claim a comparison that did not run.
    return floorOr(`no --size given — not established at/above the ${threshold} threshold for ${FULL_SDD_KIT} (pass --size to route to it) → the light ${FLOOR_SDD_KIT} floor`);
  }
  if (SIZE_RANK[task.size] >= SIZE_RANK[threshold]) {
    return { kit: FULL_SDD_KIT, reason: `size ${task.size} ≥ the ${threshold} threshold → the full ${FULL_SDD_KIT} flow (specify → plan → tasks → implement)` };
  }
  return floorOr(`size ${task.size} < the ${threshold} threshold for ${FULL_SDD_KIT} → the light ${FLOOR_SDD_KIT} floor`);
}

// The route the DELIVERY GATE uses — same contract as `routeSdd`, with one
// deliberate difference, and it is the whole point of #118.
//
// `routeSdd` answers an ADVISORY question ("what should I reach for?"), so when
// no `--size` was given it refuses to affirm and falls to the floor. Correct
// there: it must not claim a threshold was met when nothing was compared.
//
// The gate answers a DIFFERENT question ("may this delivery land?"), and there
// the same silence means the opposite. A unit whose difficulty nobody ever
// declared is not a unit established as trivial — it is a unit nobody decided
// on, which is exactly how 7 of 7 deliveries on 2026-08-31 carried no spec and
// no plan. Defaulting THAT to the floor is what made the gate inert. So here,
// an undeclared size routes to the FULL kit: rigor is the default, and the
// trivial case is the one that must say so on the record (`--size small`, or
// `--sdd sdd-lite`) — a claim the ledger keeps, instead of silence nobody signed.
export function routeSddForGate(toolbox: Toolbox, task: TaskShape): SddRoute {
  const fullInstalled = toolbox.skills.some((s) => s.name === FULL_SDD_KIT);
  const contract = resolveKit(FULL_SDD_KIT)?.routing;
  const skipped =
    task.taskType && contract?.skipFor?.some((t) => t.toLowerCase() === task.taskType!.toLowerCase());

  if (fullInstalled && !task.size && !skipped && contract?.minSize) {
    return {
      kit: FULL_SDD_KIT,
      reason: `no size was declared for this unit — undeclared is NOT established as trivial, so the full ${FULL_SDD_KIT} flow is the default. If it really is trivial, record it (\`--size small\`, or \`--sdd ${FLOOR_SDD_KIT}\`) and the claim lands on the ledger`,
    };
  }
  return routeSdd(toolbox, task);
}
