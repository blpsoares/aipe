// D8 — a ledger write must never land in a phantom file inside a worktree.
//
// `aipe journey record --workspace <dir>` writes `<dir>/.aipe/journeys/<id>.yaml`.
// Handed a worktree (the specialist's cwd, or a hand-typed `--workspace .`), the
// old behaviour silently created a phantom ledger there and the real workspace
// ledger never saw the delivery — the single most serious failure in a framework
// whose first pillar is "evidence or it did not happen".
//
// A workspace is marked by `.aipe/brain.yaml`; a worktree is not, and it sits
// under a `.worktrees/` path segment. Both signals together identify the trap,
// so the guard is narrow: it refuses a misdirected worktree write without
// refusing a legitimate bare directory (first-run, or a test fixture).
import { access, readdir } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { readBrain } from "../make-workspace/read";

const BRAIN_REL = join(".aipe", "brain.yaml");
const WORKTREES_DIR = ".worktrees";

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function hasWorktreesSegment(absPath: string): boolean {
  return absPath.split(sep).includes(WORKTREES_DIR);
}

// Walks from `start` up to the filesystem root, returning the first ancestor
// (exclusive of `start` itself) that carries `.aipe/brain.yaml` — the real
// workspace a worktree hangs under. Returns null if none is found.
async function nearestWorkspaceAbove(start: string): Promise<string | null> {
  let dir = dirname(start);
  let prev = "";
  while (dir !== prev) {
    if (await exists(join(dir, BRAIN_REL))) return dir;
    prev = dir;
    dir = dirname(dir);
  }
  return null;
}

export type RecordTarget =
  | { ok: true; workspace: string; note?: string }
  | { ok: false; message: string };

// Decides where an `aipe journey record --workspace <arg>` write should land, or
// refuses it. Three outcomes:
//   • a real workspace (has .aipe/brain.yaml) → use it.
//   • a worktree (no brain, under a .worktrees/ segment) → resolve the real
//     workspace above it and use THAT (with a note), or REJECT naming the correct
//     invocation when none can be found. Never writes .aipe/ inside the worktree.
//   • anything else (no brain, not under .worktrees) → left untouched: first-run
//     workspaces and bare-dir test fixtures still work exactly as before.
export async function classifyRecordTarget(arg: string): Promise<RecordTarget> {
  const abs = resolve(arg);

  if (await exists(join(abs, BRAIN_REL))) {
    return { ok: true, workspace: abs };
  }

  if (hasWorktreesSegment(abs)) {
    const real = await nearestWorkspaceAbove(abs);
    const phantom = (await exists(join(abs, ".aipe", "journeys")))
      ? ` A phantom ledger already exists at ${join(abs, ".aipe", "journeys")} — reconcile and remove it.`
      : "";
    if (real) {
      return {
        ok: true,
        workspace: real,
        note: `record: --workspace pointed at a worktree (${abs}); resolved the real workspace ${real} above it and recorded there.${phantom}`,
      };
    }
    return {
      ok: false,
      message:
        `--workspace ${arg} is a worktree, not a workspace (no ${BRAIN_REL}, under a ${WORKTREES_DIR}/ path). ` +
        `Recording here would create a phantom ledger the real workspace never sees. ` +
        `Re-run with --workspace <the workspace root that holds ${BRAIN_REL}>.${phantom}`,
    };
  }

  return { ok: true, workspace: abs };
}

export interface PhantomLedger {
  path: string; // absolute path to the phantom <id>.yaml
  worktree: string; // the worktree it was mistakenly written under
}

// Scans every repo's `.worktrees/*/.aipe/journeys/*.yaml` for phantom ledgers
// already on disk. Detect-and-report only — never deletes (destructive, and the
// coordinator must reconcile whatever a phantom recorded first). Returns [] when
// the workspace has no brain, no worktrees, or no phantoms.
export async function findPhantomLedgers(workspaceDir: string): Promise<PhantomLedger[]> {
  const brain = await readBrain(workspaceDir);
  if (!brain.ok) return [];
  const found: PhantomLedger[] = [];
  for (const repo of brain.brain.repos) {
    const worktreesDir = resolve(workspaceDir, repo.path, WORKTREES_DIR);
    let names: string[];
    try {
      names = await readdir(worktreesDir);
    } catch {
      continue; // no worktrees for this repo
    }
    for (const name of names) {
      const journeysDir = join(worktreesDir, name, ".aipe", "journeys");
      let entries: string[];
      try {
        entries = await readdir(journeysDir);
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (entry.endsWith(".yaml")) {
          found.push({ path: join(journeysDir, entry), worktree: join(worktreesDir, name) });
        }
      }
    }
  }
  return found.sort((a, b) => a.path.localeCompare(b.path));
}
