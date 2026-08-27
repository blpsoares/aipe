import { join } from "node:path";
import { personaSlug } from "../hire-specialists/render";
import type { WorktreeSpec } from "./types";

// A journey id must be slug-safe: lowercase alphanumerics and hyphens, not
// leading with a hyphen. It becomes part of a branch name and a directory
// name, so no slashes/spaces/uppercase. The coordinator mints it; the CLI only
// validates (never invents it in the worktree hot path).
export function isValidJourneyId(id: string): boolean {
  return /^[a-z0-9][a-z0-9-]*$/.test(id);
}

// A task id shares the journey-id shape: slug-safe (lowercase alnum + hyphen, no
// leading hyphen), because it too becomes part of a branch and a directory name.
// The coordinator mints it; the CLI only validates it (never invents it).
export function isValidTaskId(id: string): boolean {
  return /^[a-z0-9][a-z0-9-]*$/.test(id);
}

// Encodes the package (when present) into the branch/path so two packages of one
// monorepo get distinct worktrees on the same clone. Implicit packages (package
// absent or equal to the repo) keep the pre-package naming exactly:
//   implicit: aipe/<journey>/<persona>            · .worktrees/<journey>-<persona>
//   package:   aipe/<journey>/<package>--<persona>  · .worktrees/<journey>-<package>--<persona>
// The `<package>--<persona>` shape keeps the branch two levels deep so listing
// stays parseable, and slugs never contain `--` (personaSlug collapses runs).
//
// Identity-per-task (j-20260826-uv): a task, when present, is appended with a
// `__` delimiter — `<combined>__<task>` — so two concurrent dispatches of one
// persona get distinct worktrees/branches. `__` is chosen because personaSlug
// emits only [a-z0-9-]: it can never collide with the package `--` or a persona
// segment, it is legal in a git ref, and it keeps the branch a single level (a
// nested `…/task` risks a git directory/file ref conflict with a task-less branch
// of the same persona). Task absent ⇒ byte-for-byte the pre-task naming.
export function deriveSpec(repo: string, journey: string, specialist: string, pkg?: string | null, task?: string | null): WorktreeSpec {
  const slug = personaSlug(specialist);
  const moduleSlug = pkg && pkg !== repo ? personaSlug(pkg) : null;
  const unit = moduleSlug ? `${moduleSlug}--${slug}` : slug;
  const taskSlug = task ? personaSlug(task) : null;
  const combined = taskSlug ? `${unit}__${taskSlug}` : unit;
  return {
    repo,
    specialist,
    package: pkg ?? undefined,
    ...(task ? { task } : {}),
    journey,
    slug,
    moduleSlug,
    branch: `aipe/${journey}/${combined}`,
    relPath: join(".worktrees", `${journey}-${combined}`),
  };
}
