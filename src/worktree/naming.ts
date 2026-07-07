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

// Encodes the package (when present) into the branch/path so two packages of one
// monorepo get distinct worktrees on the same clone. Implicit packages (package
// absent or equal to the repo) keep the pre-package naming exactly:
//   implicit: aipe/<journey>/<persona>            · .worktrees/<journey>-<persona>
//   package:   aipe/<journey>/<package>--<persona>  · .worktrees/<journey>-<package>--<persona>
// The `<package>--<persona>` shape keeps the branch two levels deep so listing
// stays parseable, and slugs never contain `--` (personaSlug collapses runs).
export function deriveSpec(repo: string, journey: string, specialist: string, pkg?: string | null): WorktreeSpec {
  const slug = personaSlug(specialist);
  const moduleSlug = pkg && pkg !== repo ? personaSlug(pkg) : null;
  const combined = moduleSlug ? `${moduleSlug}--${slug}` : slug;
  return {
    repo,
    specialist,
    package: pkg ?? undefined,
    journey,
    slug,
    moduleSlug,
    branch: `aipe/${journey}/${combined}`,
    relPath: join(".worktrees", `${journey}-${combined}`),
  };
}
