import { access } from "node:fs/promises";
import { join } from "node:path";
import { readBrain } from "../make-workspace/read";
import { deriveSpec, isValidJourneyId } from "./naming";
import {
  defaultBase,
  ensureExcluded,
  isDirtyOrUnpushed,
  listPorcelain,
  setWorktreeIdentity,
  worktreeAdd,
  worktreeRemove,
} from "./git";
import type { CreateResult, RemoveResult, WorktreeRow } from "./types";

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
  opts: { repo: string; specialist: string; journey: string; base?: string },
): Promise<CreateResult> {
  if (!isValidJourneyId(opts.journey)) return { ok: false, error: `invalid-journey ${opts.journey}` };
  const resolved = await repoAbsOf(workspaceDir, opts.repo);
  if (!resolved.ok) return { ok: false, error: resolved.error };

  const spec = deriveSpec(opts.repo, opts.journey, opts.specialist);
  const wtAbs = join(resolved.abs, spec.relPath);

  await ensureExcluded(resolved.abs, `${WORKTREES_DIR}/`);

  const existing = await listPorcelain(resolved.abs);
  if (existing.some((w) => w.path === wtAbs || w.branch === spec.branch)) {
    return { ok: true, path: wtAbs, branch: spec.branch, created: false };
  }

  const base = opts.base ?? (await defaultBase(resolved.abs));
  const added = await worktreeAdd(resolved.abs, wtAbs, spec.branch, base);
  if (!added.ok) return { ok: false, error: added.message ?? "worktree add failed" };

  await setWorktreeIdentity(resolved.abs, wtAbs, `aipe/${opts.specialist}`);
  return { ok: true, path: wtAbs, branch: spec.branch, created: true };
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
      const slug = m[2] as string;
      if (journey && j !== journey) continue;
      rows.push({ repo: repo.name, slug, journey: j, branch: w.branch, path: w.path });
    }
  }
  return rows;
}

export interface PruneRow {
  repo: string;
  slug: string;
  status: "removed" | "blocked" | "error";
  detail?: string;
}

// Sweeps every worktree of a journey, removing those whose work is safely in git
// (clean + pushed) and reporting the rest — a batch teardown after a journey's
// PRs merge. Guardrail-protected per worktree unless `force`.
export async function pruneWorktrees(
  workspaceDir: string,
  journey: string,
  force = false,
): Promise<PruneRow[]> {
  if (!isValidJourneyId(journey)) return [];
  const rows: PruneRow[] = [];
  for (const wt of await listWorktrees(workspaceDir, journey)) {
    const result = await removeWorktree(workspaceDir, { repo: wt.repo, specialist: wt.slug, journey, force });
    if (result.ok) rows.push({ repo: wt.repo, slug: wt.slug, status: "removed" });
    else rows.push({ repo: wt.repo, slug: wt.slug, status: result.blocked ? "blocked" : "error", detail: result.error });
  }
  return rows;
}

export async function removeWorktree(
  workspaceDir: string,
  opts: { repo: string; specialist: string; journey: string; force?: boolean },
): Promise<RemoveResult> {
  if (!isValidJourneyId(opts.journey)) return { ok: false, blocked: false, error: `invalid-journey ${opts.journey}` };
  const resolved = await repoAbsOf(workspaceDir, opts.repo);
  if (!resolved.ok) return { ok: false, blocked: false, error: resolved.error };

  const spec = deriveSpec(opts.repo, opts.journey, opts.specialist);
  const wtAbs = join(resolved.abs, spec.relPath);
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
