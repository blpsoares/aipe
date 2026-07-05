import type { SkillEntry, TaskSize, Toolbox } from "./types";

const SIZE_RANK: Record<TaskSize, number> = { small: 0, medium: 1, large: 2 };

export interface TaskShape {
  taskType?: string;
  size?: TaskSize;
}

// Deterministically filters the catalog to the skills that apply to a task,
// using the structured `routing` signals. A skill with no `routing` always
// matches (unknown → the coordinator decides from the free-text `whenToUse`).
export function matchSkills(toolbox: Toolbox, task: TaskShape): SkillEntry[] {
  return toolbox.skills.filter((s) => {
    const r = s.routing;
    if (!r) return true;
    if (task.taskType && r.skipFor?.some((t) => t.toLowerCase() === task.taskType!.toLowerCase())) return false;
    if (task.taskType && r.taskTypes && !r.taskTypes.some((t) => t.toLowerCase() === task.taskType!.toLowerCase())) {
      return false;
    }
    if (r.minSize && task.size && SIZE_RANK[task.size] < SIZE_RANK[r.minSize]) return false;
    return true;
  });
}
