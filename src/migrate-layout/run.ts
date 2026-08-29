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
import type { BrainFile } from "../context-brain/types";
import { readPersonas } from "../hire-specialists/read-personas";
import {
  reconcilePersonaPaths,
  renderPersonasYaml,
  type PersonaPathChange,
} from "../hire-specialists/registry";
import type { PersonaRegistryEntry } from "../hire-specialists/types";
import { listJourneys, repairWorktreePaths } from "../journey/ledger";
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
  journeys: (
    workspaceDir: string,
  ) => Promise<{ id: string; dispatches: { repo: string; status: DispatchStatus; worktree?: string }[] }[]>;
  /** Registered worktrees of a repo, main one included. */
  worktrees: (repoAbs: string) => Promise<{ path: string }[]>;
  /** `git status --porcelain` output; empty string = clean. */
  dirt: (repoAbs: string) => Promise<string>;
  /**
   * `git worktree repair <newPath>…` — reconnects worktree bookkeeping after the
   * repo (and its nested worktrees) moved. The NEW absolute worktree paths must
   * be passed explicitly: run with no args, git only re-checks the recorded (now
   * stale) locations and fixes nothing.
   */
  repair: (repoAbs: string, worktreePaths: string[]) => Promise<void>;
  /** Repairs absolute `worktree` paths in the ledger after repos move. */
  repairLedger: (
    workspaceDir: string,
    moves: { from: string; to: string }[],
  ) => Promise<{ journey: string; specialist: string; from: string; to: string }[]>;
  exists: (absPath: string) => Promise<boolean>;
  move: (fromAbs: string, toAbs: string) => Promise<void>;
  writeBrain: (workspaceDir: string, brain: BrainFile) => Promise<void>;
  /** The persona registry (.aipe/personas.yaml) — empty when there is none. */
  personas: (workspaceDir: string) => Promise<PersonaRegistryEntry[]>;
  writePersonas: (workspaceDir: string, entries: PersonaRegistryEntry[]) => Promise<void>;
}

export type MigrateResult =
  | { ok: true; plan: MigrationPlan; applied: boolean; personaChanges: PersonaPathChange[] }
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
      dispatches: l.dispatches.map((d) => ({ repo: d.repo, status: d.status, worktree: d.worktree })),
    })),
  worktrees: listPorcelain,
  dirt: async (repoAbs) => (await gitRun(["git", "-C", repoAbs, "status", "--porcelain"])).stdout,
  repair: async (repoAbs, worktreePaths) => {
    await gitRun(["git", "-C", repoAbs, "worktree", "repair", ...worktreePaths]);
  },
  repairLedger: repairWorktreePaths,
  exists: realExists,
  move: async (fromAbs, toAbs) => {
    await mkdir(dirname(toAbs), { recursive: true });
    await rename(fromAbs, toAbs);
  },
  writeBrain: async (workspaceDir, brain) => {
    await Bun.write(join(workspaceDir, ".aipe", "brain.yaml"), stringify(brain));
  },
  personas: readPersonas,
  writePersonas: async (workspaceDir, entries) => {
    await Bun.write(join(workspaceDir, ".aipe", "personas.yaml"), renderPersonasYaml(entries));
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
      // D9 (stale reconciliation, cf. PR #27): a dispatch whose recorded
      // worktree is gone from disk is dead bookkeeping, not work in flight — a
      // legacy row from a journey closed days ago, unclosable because its unit
      // is `merged` and immutable. Dead ⇒ never blocks; a worktree still on disk
      // ⇒ live work, still blocks. A row that recorded no worktree at all can't
      // be proven dead, so it blocks (the conservative default).
      if (dispatch.worktree && !(await d.exists(dispatch.worktree))) continue;
      blockers.push(
        `journey ${ledger.id}: ${dispatch.repo} is ${dispatch.status} — finish it, or close its ledger row, before migrating`,
      );
    }
  }

  for (const move of plan.moves) {
    const toAbs = join(workspaceDir, normalizePath(move.to));

    if (await d.exists(toAbs)) {
      blockers.push(
        `${move.repo}: target ${normalizePath(move.to)} already exists — move or delete it, then re-run`,
      );
    }
    // Registered worktrees no longer block: they live nested inside the repo and
    // move with it, and `git worktree repair` reconnects them at the new path
    // (see the apply path below). A dirty working tree still blocks — that is
    // real uncommitted work the PE has not saved.
    const fromAbs = join(workspaceDir, normalizePath(move.from));
    if (!(await d.exists(fromAbs))) continue; // never cloned: path-only change

    if (!opts.allowDirty) {
      const dirt = await d.dirt(fromAbs);
      if (dirt.trim() !== "") {
        blockers.push(`${move.repo}: working tree is dirty — commit or stash it, or pass --allow-dirty`);
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

  // The brain AFTER migration — repos rewritten to their repos/ paths. The
  // persona registry must agree with THIS, whether the repos move now or already
  // moved in a prior (persona-blind) migration that left the registry pointing
  // at the old location. That second case is drift nobody was warned about:
  // even with zero moves to make, a stale personas.yaml is still work to do.
  const migratedBrain: BrainFile = { ...brain, repos: applyPlanToRepos(brain.repos, plan) };
  const personas = await d.personas(workspaceDir);
  const reconciled = reconcilePersonaPaths(migratedBrain, personas);
  const personaChanges = reconciled.changed;

  if (plan.moves.length === 0 && personaChanges.length === 0) {
    return { ok: true, plan, applied: false, personaChanges };
  }

  const blockers = await collectBlockers(workspaceDir, plan, opts, d);
  if (blockers.length > 0) return { ok: false, blockers, plan };

  if (!opts.apply) return { ok: true, plan, applied: false, personaChanges };

  // Disk first, brain last. Every move that succeeded is remembered so a
  // failure halfway can put the workspace back exactly as it was. The repo's
  // registered worktrees are captured BEFORE the move (their old absolute
  // paths), so repair can be handed their NEW absolute paths afterward.
  const done: { fromAbs: string; toAbs: string; worktrees: string[] }[] = [];
  for (const move of plan.moves) {
    const fromAbs = join(workspaceDir, normalizePath(move.from));
    const toAbs = join(workspaceDir, normalizePath(move.to));
    if (!(await d.exists(fromAbs))) continue; // never cloned: path-only change
    // The main working tree is listed first; only the extra (nested) worktrees
    // need repair, and only the ones that actually moved with the repo.
    const worktrees = (await d.worktrees(fromAbs)).map((w) => w.path).filter((p) => p.startsWith(`${fromAbs}/`));
    try {
      await d.move(fromAbs, toAbs);
      done.push({ fromAbs, toAbs, worktrees });
    } catch (err) {
      for (const undo of done.reverse()) {
        await d.move(undo.toAbs, undo.fromAbs).catch(() => {});
      }
      return { ok: false, blockers: [`${move.repo}: move failed (${err}) — rolled back, nothing changed`], plan };
    }
  }

  // Reconnect the moved worktrees at their NEW absolute paths — this is what
  // lets an in-flight dispatch survive the move instead of blocking it. Passing
  // the paths is required: `git worktree repair` with no args re-checks the
  // recorded (now stale) locations and fixes nothing.
  for (const moved of done) {
    const newWorktrees = moved.worktrees.map((p) => `${moved.toAbs}${p.slice(moved.fromAbs.length)}`);
    await d.repair(moved.toAbs, newWorktrees).catch(() => {});
  }

  await d.writeBrain(workspaceDir, migratedBrain);

  // Repair the absolute `worktree` paths the ledger recorded for still-live
  // dispatches, so `aipe worktree`/`prune`/`status` keep finding them. Merged
  // units are immutable and skipped — their stale path is left as-is.
  await d.repairLedger(
    workspaceDir,
    done.map((m) => ({ from: m.fromAbs, to: m.toAbs })),
  ).catch(() => {});

  // Keep the persona registry truthful to disk, exactly as the brain is: the
  // SKILL.md files moved with their repos, so their recorded paths must move too
  // (this is what stops `validate-personas` reporting every persona broken after
  // a migration). Only written when something actually changed.
  if (personaChanges.length > 0) {
    await d.writePersonas(workspaceDir, reconciled.entries);
  }

  return { ok: true, plan, applied: true, personaChanges };
}
