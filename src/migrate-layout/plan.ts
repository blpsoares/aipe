// The plan half of `aipe workspace migrate-layout`: pure, so what the dry-run
// prints is by construction the same thing `--apply` executes.
import { defaultRepoPath, isLegacyRepoPath, normalizePath } from "../context-brain/layout";
import type { RepoEntry } from "../context-brain/types";

export interface Move {
  repo: string;
  /** Workspace-relative, `./`-prefixed — the brain.yaml spelling. */
  from: string;
  to: string;
}

export interface MigrationPlan {
  moves: Move[];
  /** Repos left alone, with why — printed so "nothing happened" is never silent. */
  untouched: { repo: string; reason: string }[];
}

/**
 * Pure: what migrating this brain would do.
 *
 * Only single-segment paths move. A repo the PE deliberately placed somewhere
 * nested (`services/x`) is not the old default and is none of our business.
 */
export function planMigration(repos: RepoEntry[]): MigrationPlan {
  const moves: Move[] = [];
  const untouched: { repo: string; reason: string }[] = [];
  const targets = new Map<string, string>();

  for (const repo of repos) {
    if (!isLegacyRepoPath(repo.path)) {
      untouched.push({ repo: repo.name, reason: `already nested (${normalizePath(repo.path)})` });
      continue;
    }
    const to = defaultRepoPath(repo.name);
    const key = normalizePath(to);

    const claimedBy = targets.get(key);
    if (claimedBy !== undefined) {
      untouched.push({ repo: repo.name, reason: `target ${key} already claimed by ${claimedBy}` });
      continue;
    }
    // A repo whose declared path already equals its target has nothing to move.
    if (normalizePath(repo.path) === key) {
      untouched.push({ repo: repo.name, reason: "already at the target path" });
      continue;
    }
    targets.set(key, repo.name);
    moves.push({ repo: repo.name, from: repo.path, to });
  }

  return { moves, untouched };
}

/** Pure: the brain repos rewritten to their post-migration paths. */
export function applyPlanToRepos(repos: RepoEntry[], plan: MigrationPlan): RepoEntry[] {
  const byRepo = new Map(plan.moves.map((m) => [m.repo, m.to]));
  return repos.map((repo) => {
    const to = byRepo.get(repo.name);
    return to === undefined ? repo : { ...repo, path: to };
  });
}

/** One persona whose registry path had to move to follow its repo. */
export interface PersonaPathChangeLine {
  name: string;
  from: string;
  to: string;
}

/** Pure: the human-readable dry-run report. */
export function renderPlan(
  plan: MigrationPlan,
  applied: boolean,
  personaChanges: PersonaPathChangeLine[] = [],
): string[] {
  const lines: string[] = [];
  for (const m of plan.moves) {
    lines.push(`${applied ? "OK moved" : "PLAN move"} ${m.repo}: ${normalizePath(m.from)} → ${normalizePath(m.to)}`);
  }
  for (const u of plan.untouched) {
    lines.push(`SKIP ${u.repo} (${u.reason})`);
  }
  // Persona-registry drift: paths that no longer point at where the repo lives.
  // Surfaced whether or not any repo is moving — a workspace migrated by an
  // older, persona-blind migration is broken today with no other warning.
  for (const c of personaChanges) {
    lines.push(`${applied ? "OK persona" : "PLAN persona"} ${c.name}: ${c.from} → ${c.to}`);
  }
  if (plan.moves.length === 0 && personaChanges.length === 0) {
    lines.push("STATE migrate-layout=nothing-to-do");
  } else if (!applied) {
    lines.push(
      `STATE migrate-layout=dry-run (${plan.moves.length} repo(s), ${personaChanges.length} persona path(s); re-run with --apply)`,
    );
  } else {
    lines.push(`STATE migrate-layout=done (${plan.moves.length} repo(s), ${personaChanges.length} persona path(s))`);
  }
  return lines;
}
