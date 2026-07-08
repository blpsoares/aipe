import { access } from "node:fs/promises";
import { join } from "node:path";
import { readBrain } from "../make-workspace/read";
import { personaSlug } from "../hire-specialists/render";
import { readLedger } from "../journey/ledger";
import type { DispatchStatus, JourneyDispatch } from "../journey/types";
import { deriveSpec, isValidJourneyId } from "./naming";
import {
  defaultBase,
  ensureExcluded,
  isDirtyOrUnpushed,
  listPorcelain,
  setWorktreeIdentity,
  setWorktreeNonBare,
  worktreeAdd,
  worktreePathByBranch,
  worktreeRemove,
} from "./git";
import type { CreateResult, RemoveResult, WorktreeRow } from "./types";

// A dispatch is TERMINAL once its PR has merged or its worktree was already
// removed — only then is it safe for prune to reclaim. Everything else
// (dispatched/delivered/escalated) is live work and must be kept.
const TERMINAL_STATUSES: DispatchStatus[] = ["merged", "removed"];
function isActiveDispatch(status: DispatchStatus): boolean {
  return !TERMINAL_STATUSES.includes(status);
}

// Match a ledger dispatch to a live worktree row. The branch is the primary key
// (both derive from the same (journey, persona, package)); repo+slug is a
// fallback for legacy ledgers whose branch text drifted.
function dispatchForRow(dispatches: JourneyDispatch[], wt: WorktreeRow): JourneyDispatch | undefined {
  const byBranch = dispatches.find((d) => d.branch === wt.branch);
  if (byBranch) return byBranch;
  return dispatches.find((d) => {
    if (d.repo !== wt.repo) return false;
    if (personaSlug(d.specialist) !== wt.slug) return false;
    const dPkg = d.package && d.package !== d.repo ? personaSlug(d.package) : undefined;
    return dPkg === (wt.package ?? undefined);
  });
}

const WORKTREES_DIR = ".worktrees";

async function repoAbsOf(
  workspaceDir: string,
  repoName: string,
): Promise<{ ok: true; abs: string } | { ok: false; error: string }> {
  const brain = await readBrain(workspaceDir);
  if (!brain.ok) return { ok: false, error: brain.error };
  const repo = brain.brain.repos.find((r) => r.name === repoName);
  if (!repo) return { ok: false, error: `unknown-repo ${repoName}` };
  return { ok: true, abs: join(workspaceDir, repo.path) };
}

export async function createWorktree(
  workspaceDir: string,
  opts: { repo: string; specialist: string; journey: string; package?: string; base?: string },
): Promise<CreateResult> {
  if (!isValidJourneyId(opts.journey)) return { ok: false, error: `invalid-journey ${opts.journey}` };
  const resolved = await repoAbsOf(workspaceDir, opts.repo);
  if (!resolved.ok) return { ok: false, error: resolved.error };

  const spec = deriveSpec(opts.repo, opts.journey, opts.specialist, opts.package);
  const wtAbs = join(resolved.abs, spec.relPath);

  await ensureExcluded(resolved.abs, `${WORKTREES_DIR}/`);

  const existing = await listPorcelain(resolved.abs);
  const already = existing.find((w) => w.path === wtAbs || w.branch === spec.branch);
  if (already) {
    return { ok: true, path: already.path, branch: spec.branch, created: false };
  }

  const base = opts.base ?? (await defaultBase(resolved.abs));
  const added = await worktreeAdd(resolved.abs, wtAbs, spec.branch, base);
  if (!added.ok) return { ok: false, error: added.message ?? "worktree add failed" };

  // Reconcile against git's ground truth: a bare repo may materialize the
  // worktree at a nested path. Everything downstream (identity, non-bare,
  // returned path) targets where it actually landed.
  const actual = (await worktreePathByBranch(resolved.abs, spec.branch)) ?? wtAbs;
  await setWorktreeIdentity(resolved.abs, actual, `aipe/${opts.specialist}`);
  await setWorktreeNonBare(resolved.abs, actual);
  return { ok: true, path: actual, branch: spec.branch, created: true };
}

export async function listWorktrees(workspaceDir: string, journey?: string): Promise<WorktreeRow[]> {
  const brain = await readBrain(workspaceDir);
  if (!brain.ok) return [];
  const rows: WorktreeRow[] = [];
  for (const repo of brain.brain.repos) {
    const repoAbs = join(workspaceDir, repo.path);
    for (const w of await listPorcelain(repoAbs)) {
      const m = /^aipe\/([^/]+)\/(.+)$/.exec(w.branch);
      if (!m) continue;
      const j = m[1] as string;
      const combined = m[2] as string;
      if (journey && j !== journey) continue;
      // combined is "<package>--<persona>" for a real package, else just "<persona>"
      const sep = combined.indexOf("--");
      const pkg = sep >= 0 ? combined.slice(0, sep) : undefined;
      const slug = sep >= 0 ? combined.slice(sep + 2) : combined;
      rows.push({ repo: repo.name, slug, package: pkg, journey: j, branch: w.branch, path: w.path });
    }
  }
  return rows;
}

export interface PruneRow {
  repo: string;
  slug: string;
  status: "removed" | "skipped" | "blocked" | "error";
  detail?: string;
}

// Sweeps a journey's worktrees, reclaiming only those safe to remove — a batch
// teardown after the journey's PRs merge. Safety gate: the journey ledger is the
// source of truth for which dispatches are still LIVE. A worktree whose dispatch
// is active (dispatched/delivered/escalated) is SKIPPED unless `force`; only
// TERMINAL dispatches (merged/removed) — or worktrees with no ledger entry —
// proceed to removeWorktree, which still applies its own clean+pushed guardrail.
export async function pruneWorktrees(
  workspaceDir: string,
  journey: string,
  force = false,
): Promise<PruneRow[]> {
  if (!isValidJourneyId(journey)) return [];
  const ledger = await readLedger(workspaceDir, journey);
  const dispatches = ledger?.dispatches ?? [];
  const rows: PruneRow[] = [];
  for (const wt of await listWorktrees(workspaceDir, journey)) {
    const dispatch = dispatchForRow(dispatches, wt);
    if (!force && dispatch && isActiveDispatch(dispatch.status)) {
      rows.push({ repo: wt.repo, slug: wt.slug, status: "skipped", detail: `active:${dispatch.status}` });
      continue;
    }
    const result = await removeWorktree(workspaceDir, { repo: wt.repo, specialist: wt.slug, package: wt.package, journey, force });
    if (result.ok) rows.push({ repo: wt.repo, slug: wt.slug, status: "removed" });
    else rows.push({ repo: wt.repo, slug: wt.slug, status: result.blocked ? "blocked" : "error", detail: result.error });
  }
  return rows;
}

export async function removeWorktree(
  workspaceDir: string,
  opts: { repo: string; specialist: string; journey: string; package?: string; force?: boolean },
): Promise<RemoveResult> {
  if (!isValidJourneyId(opts.journey)) return { ok: false, blocked: false, error: `invalid-journey ${opts.journey}` };
  const resolved = await repoAbsOf(workspaceDir, opts.repo);
  if (!resolved.ok) return { ok: false, blocked: false, error: resolved.error };

  const spec = deriveSpec(opts.repo, opts.journey, opts.specialist, opts.package);
  // Locate the worktree where git actually has it (single source of truth),
  // not where deriveSpec guesses — bare repos nest it elsewhere.
  const wtAbs = (await worktreePathByBranch(resolved.abs, spec.branch)) ?? join(resolved.abs, spec.relPath);
  try {
    await access(wtAbs);
  } catch {
    return { ok: false, blocked: false, error: `not-found ${wtAbs}` };
  }

  if (!opts.force && (await isDirtyOrUnpushed(wtAbs))) {
    return { ok: false, blocked: true, error: "uncommitted or unpushed work — pass --force to discard" };
  }

  const removed = await worktreeRemove(resolved.abs, wtAbs, opts.force ?? false);
  if (!removed.ok) return { ok: false, blocked: false, error: removed.message ?? "worktree remove failed" };
  return { ok: true, path: wtAbs };
}
