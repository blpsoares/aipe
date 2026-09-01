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
// which one SDD tier this task should follow. The threshold is the FULL kit's
// own `routing` (declared in the registry — `minSize`/`skipFor`), so it is
// ESTABLISHED, not guessed, and the `reason` names it. If the full kit is
// installed and the task meets its routing, route there; otherwise the light
// floor if installed; otherwise nothing (no SDD kit present — the exact state
// that let `--size` look decorative and let 7/7 deliveries skip spec+plan).
export function routeSdd(toolbox: Toolbox, task: TaskShape): SddRoute {
  const full = toolbox.skills.find((s) => s.name === FULL_SDD_KIT);
  const floor = toolbox.skills.find((s) => s.name === FLOOR_SDD_KIT);

  if (full && skillApplies(full, task)) {
    const threshold = full.routing?.minSize ?? "medium";
    return { kit: FULL_SDD_KIT, reason: `size ${task.size ?? "?"} ≥ the ${threshold} threshold → the full ${FULL_SDD_KIT} flow (specify → plan → tasks → implement)` };
  }
  if (floor) {
    const threshold = full?.routing?.minSize;
    const why = full
      ? threshold
        ? `below the ${threshold} threshold for ${FULL_SDD_KIT} → the light ${FLOOR_SDD_KIT} floor`
        : `the light ${FLOOR_SDD_KIT} floor`
      : `${FULL_SDD_KIT} is NOT installed — only the light ${FLOOR_SDD_KIT} floor is reachable`;
    return { kit: FLOOR_SDD_KIT, reason: why };
  }
  return { kit: null, reason: "no SDD kit is installed in this workspace — the SDD flow is unreachable" };
}
