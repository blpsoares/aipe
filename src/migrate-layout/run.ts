// `aipe workspace migrate-layout` — move a legacy workspace's repos from the
// root into `repos/`.
//
// This is the one AIPe command that moves the PE's own source checkouts, which
// is why it is a command and not a step of anything automatic. `aipe rehydrate`
// (and the SessionStart auto-rehydrate, and `applyUpgrade` after a self-update)
// must never call it: those run unattended, fan out over every known workspace,
// and discard their output — a silent `mv` there is unrecoverable. They detect
// and report; only this command, run deliberately, moves.
//
// Safety model:
//   - dry-run by default; `--apply` is the only thing that touches disk;
//   - refuses while any repo has a registered git worktree (a worktree records
//     an ABSOLUTE path in .git/worktrees/<n>/gitdir, so moving the repo breaks
//     every in-flight dispatch);
//   - refuses while a journey has work in flight, or a repo is dirty
//     (`--allow-dirty` overrides only the last one);
//   - brain.yaml is written only after every move succeeded, so a failure
//     rolls the moves back and leaves disk and brain agreeing with each other.
import { mkdir, rename, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { stringify } from "yaml";
import { normalizePath } from "../context-brain/layout";
import type { BrainFile, RepoEntry } from "../context-brain/types";
import { listJourneys } from "../journey/ledger";
import type { DispatchStatus } from "../journey/types";
import { readBrain } from "../make-workspace/read";
import { listPorcelain, run as gitRun } from "../worktree/git";
import { applyPlanToRepos, planMigration, type MigrationPlan } from "./plan";

/** Statuses that mean a specialist may be working in a worktree right now. */
export const IN_FLIGHT_STATUSES: DispatchStatus[] = ["dispatched", "redirected"];

export interface MigrateOpts {
  apply: boolean;
  allowDirty: boolean;
}

export interface MigrateDeps {
  brain: (workspaceDir: string) => Promise<{ ok: true; brain: BrainFile } | { ok: false; error: string }>;
  journeys: (workspaceDir: string) => Promise<{ id: string; dispatches: { repo: string; status: DispatchStatus }[] }[]>;
  /** Registered worktrees of a repo, main one included. */
  worktrees: (repoAbs: string) => Promise<{ path: string }[]>;
  /** `git status --porcelain` output; empty string = clean. */
  dirt: (repoAbs: string) => Promise<string>;
  /** `git worktree repair` — fixes gitdir pointers after the move. */
  repair: (repoAbs: string) => Promise<void>;
  exists: (absPath: string) => Promise<boolean>;
  move: (fromAbs: string, toAbs: string) => Promise<void>;
  writeBrain: (workspaceDir: string, brain: BrainFile) => Promise<void>;
}

export type MigrateResult =
  | { ok: true; plan: MigrationPlan; applied: boolean }
  | { ok: false; blockers: string[]; plan?: MigrationPlan }
  | { ok: false; error: string };

async function realExists(absPath: string): Promise<boolean> {
  try {
    await stat(absPath);
    return true;
  } catch {
    return false;
  }
}

export const defaultDeps: MigrateDeps = {
  brain: readBrain,
  journeys: async (workspaceDir) =>
    (await listJourneys(workspaceDir)).map((l) => ({
      id: l.id,
      dispatches: l.dispatches.map((d) => ({ repo: d.repo, status: d.status })),
    })),
  worktrees: listPorcelain,
  dirt: async (repoAbs) => (await gitRun(["git", "-C", repoAbs, "status", "--porcelain"])).stdout,
  repair: async (repoAbs) => {
    await gitRun(["git", "-C", repoAbs, "worktree", "repair"]);
  },
  exists: realExists,
  move: async (fromAbs, toAbs) => {
    await mkdir(dirname(toAbs), { recursive: true });
    await rename(fromAbs, toAbs);
  },
  writeBrain: async (workspaceDir, brain) => {
    await Bun.write(join(workspaceDir, ".aipe", "brain.yaml"), stringify(brain));
  },
};

/**
 * Everything that must be true before a single directory moves. Collected in
 * full rather than short-circuited: a PE fixing blockers wants the whole list,
 * not one per run.
 */
async function collectBlockers(
  workspaceDir: string,
  plan: MigrationPlan,
  opts: MigrateOpts,
  d: MigrateDeps,
): Promise<string[]> {
  const blockers: string[] = [];
  const moving = new Set(plan.moves.map((m) => m.repo));

  for (const ledger of await d.journeys(workspaceDir)) {
    for (const dispatch of ledger.dispatches) {
      if (!moving.has(dispatch.repo)) continue;
      if (!IN_FLIGHT_STATUSES.includes(dispatch.status)) continue;
      blockers.push(
        `journey ${ledger.id}: ${dispatch.repo} is ${dispatch.status} — finish or close it before migrating`,
      );
    }
  }

  for (const move of plan.moves) {
    const fromAbs = join(workspaceDir, normalizePath(move.from));
    const toAbs = join(workspaceDir, normalizePath(move.to));

    if (await d.exists(toAbs)) {
      blockers.push(`${move.repo}: target ${normalizePath(move.to)} already exists`);
    }
    // A repo that was never cloned needs no move — only the brain path changes.
    if (!(await d.exists(fromAbs))) continue;

    const worktrees = await d.worktrees(fromAbs);
    if (worktrees.length > 1) {
      const extra = worktrees.slice(1).map((w) => w.path).join(", ");
      blockers.push(
        `${move.repo}: ${worktrees.length - 1} registered worktree(s) — remove them first (${extra})`,
      );
    }

    if (!opts.allowDirty) {
      const dirt = await d.dirt(fromAbs);
      if (dirt.trim() !== "") {
        blockers.push(`${move.repo}: working tree is dirty — commit/stash it, or pass --allow-dirty`);
      }
    }
  }

  return blockers;
}

export async function migrateLayout(
  workspaceDir: string,
  opts: MigrateOpts,
  overrides: Partial<MigrateDeps> = {},
): Promise<MigrateResult> {
  const d = { ...defaultDeps, ...overrides };

  const brainResult = await d.brain(workspaceDir);
  if (!brainResult.ok) return { ok: false, error: brainResult.error };
  const brain = brainResult.brain;

  const plan = planMigration(brain.repos);
  if (plan.moves.length === 0) return { ok: true, plan, applied: false };

  const blockers = await collectBlockers(workspaceDir, plan, opts, d);
  if (blockers.length > 0) return { ok: false, blockers, plan };

  if (!opts.apply) return { ok: true, plan, applied: false };

  // Disk first, brain last. Every move that succeeded is remembered so a
  // failure halfway can put the workspace back exactly as it was.
  const done: { fromAbs: string; toAbs: string }[] = [];
  for (const move of plan.moves) {
    const fromAbs = join(workspaceDir, normalizePath(move.from));
    const toAbs = join(workspaceDir, normalizePath(move.to));
    if (!(await d.exists(fromAbs))) continue; // never cloned: path-only change
    try {
      await d.move(fromAbs, toAbs);
      done.push({ fromAbs, toAbs });
    } catch (err) {
      for (const undo of done.reverse()) {
        await d.move(undo.toAbs, undo.fromAbs).catch(() => {});
      }
      return { ok: false, blockers: [`${move.repo}: move failed (${err}) — rolled back, nothing changed`], plan };
    }
  }

  // A moved repo's own gitdir is self-contained, but any worktree pointer that
  // survived (or was created out from under us) records an absolute path.
  for (const moved of done) {
    await d.repair(moved.toAbs).catch(() => {});
  }

  const migrated: RepoEntry[] = applyPlanToRepos(brain.repos, plan);
  await d.writeBrain(workspaceDir, { ...brain, repos: migrated });

  return { ok: true, plan, applied: true };
}
