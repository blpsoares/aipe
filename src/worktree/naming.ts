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

export function deriveSpec(repo: string, journey: string, specialist: string): WorktreeSpec {
  const slug = personaSlug(specialist);
  return {
    repo,
    specialist,
    journey,
    slug,
    branch: `aipe/${journey}/${slug}`,
    relPath: join(".worktrees", `${journey}-${slug}`),
  };
}
