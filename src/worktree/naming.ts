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

// Encodes the module (when present) into the branch/path so two modules of one
// monorepo get distinct worktrees on the same clone. Implicit modules (module
// absent or equal to the repo) keep the pre-module naming exactly:
//   implicit: aipe/<journey>/<persona>            · .worktrees/<journey>-<persona>
//   module:   aipe/<journey>/<module>--<persona>  · .worktrees/<journey>-<module>--<persona>
// The `<module>--<persona>` shape keeps the branch two levels deep so listing
// stays parseable, and slugs never contain `--` (personaSlug collapses runs).
export function deriveSpec(repo: string, journey: string, specialist: string, module?: string | null): WorktreeSpec {
  const slug = personaSlug(specialist);
  const moduleSlug = module && module !== repo ? personaSlug(module) : null;
  const combined = moduleSlug ? `${moduleSlug}--${slug}` : slug;
  return {
    repo,
    specialist,
    module: module ?? undefined,
    journey,
    slug,
    moduleSlug,
    branch: `aipe/${journey}/${combined}`,
    relPath: join(".worktrees", `${journey}-${combined}`),
  };
}
