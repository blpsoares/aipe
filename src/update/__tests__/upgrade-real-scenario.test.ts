// The v2 acceptance centerpiece: reproduce THIS workspace's real failure and
// prove the upgrade now migrates through it.
//
// The fixture carries the three things that, together, gave 15 blockers today:
//   • repos with an untracked `.claude/` (what rehydrate drops) → dirty repo;
//   • a registered worktree (the QA worktrees that piled up) → moving used to
//     be refused because its gitdir path is absolute;
//   • a legacy dispatch with no task whose worktree is GONE from disk → an
//     unclosable "dispatched" row that blocked every future migration.
//
// Driven through the real apply orchestration (rehydrate → migrate), with the
// two subprocess steps wired to the in-process implementations, so this is the
// actual code path an `aipe upgrade` takes, not a mock of it.
import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stringify } from "yaml";
import type { BrainFile } from "../../context-brain/types";
import { isLegacyLayout } from "../../context-brain/layout";
import { readBrain } from "../../make-workspace/read";
import { run as rehydrateRun } from "../../rehydrate/cli";
import { migrateLayout } from "../../migrate-layout/run";
import { run as gitRun } from "../../worktree/git";
import { applyUpgrade } from "../apply";

async function git(args: string[], cwd?: string) {
  return gitRun(cwd ? ["git", "-C", cwd, ...args] : ["git", ...args]);
}

async function porcelain(repoAbs: string): Promise<string> {
  return (await git(["status", "--porcelain"], repoAbs)).stdout;
}

/** Build the real-scenario workspace, legacy layout, one repo `embark`. */
async function scenario(): Promise<{ dir: string; repoAbs: string; qaWt: string }> {
  const dir = await mkdtemp(join(tmpdir(), "aipe-real-"));
  const originAbs = join(dir, "origin.git");
  const repoAbs = join(dir, "embark");

  await git(["init", "--bare", "-b", "main", originAbs]);
  await mkdir(repoAbs, { recursive: true });
  await git(["init", "-b", "main", repoAbs]);
  await git(["config", "user.email", "pe@example.com"], repoAbs);
  await git(["config", "user.name", "Real PE"], repoAbs);
  await writeFile(join(repoAbs, "README.md"), "# embark\n", "utf8");
  await git(["add", "-A"], repoAbs);
  await git(["commit", "-qm", "init"], repoAbs);
  await git(["remote", "add", "origin", originAbs], repoAbs);
  await git(["push", "-qu", "origin", "main"], repoAbs);

  // (a) untracked `.claude/` — the dirt rehydrate leaves and migrate refuses on.
  await mkdir(join(repoAbs, ".claude", "skills", "operate"), { recursive: true });
  await writeFile(join(repoAbs, ".claude", "skills", "operate", "SKILL.md"), "stale\n", "utf8");

  // (b) a registered QA worktree, clean (a passed verification never writes).
  const qaWt = join(repoAbs, ".worktrees", "j-qa-mike");
  await git(["worktree", "add", "-q", "-b", "aipe/j-qa/mike", qaWt], repoAbs);
  // Mirror createWorktree: keep .worktrees/ out of the repo's own status.
  await writeFile(join(repoAbs, ".git", "info", "exclude"), ".worktrees/\n", "utf8");

  const brain: BrainFile = {
    context: { name: "opvibes", coordinator: "Nicolas" },
    repos: [{ name: "embark", url: originAbs, path: "./embark" }],
  };
  await mkdir(join(dir, ".aipe", "journeys"), { recursive: true });
  await writeFile(join(dir, ".aipe", "brain.yaml"), stringify(brain), "utf8");
  await writeFile(
    join(dir, ".aipe", "personas.yaml"),
    stringify({ personas: [{ name: "Mike", role: "qa", repo: "embark", path: "./embark/.claude/skills/mike" }] }),
    "utf8",
  );
  // (c) two ledgers: a QA `verified` (worktree exists) and a dead legacy
  //     `dispatched` with no task whose worktree is gone.
  await writeFile(
    join(dir, ".aipe", "journeys", "j-qa.yaml"),
    stringify({
      id: "j-qa",
      dispatches: [
        { repo: "embark", specialist: "Mike", branch: "aipe/j-qa/mike", worktree: qaWt, status: "verified", evidence: { by: "qa", commands: ["x"], summary: "ok" } },
      ],
      authorizations: [],
    }),
    "utf8",
  );
  await writeFile(
    join(dir, ".aipe", "journeys", "j-20260825-s2.yaml"),
    stringify({
      id: "j-20260825-s2",
      dispatches: [
        { repo: "embark", specialist: "Ghost", branch: "old", worktree: join(repoAbs, ".worktrees", "gone"), status: "dispatched" },
      ],
      authorizations: [],
    }),
    "utf8",
  );
  return { dir, repoAbs, qaWt };
}

test("the real 15-blocker scenario migrates through a full upgrade — and every repo ends clean (D-I, D-J)", async () => {
  const { dir, repoAbs } = await scenario();
  try {
    // Sanity: before the upgrade, the repo is dirty (untracked .claude) — the
    // very condition that made migrate refuse.
    expect(await porcelain(repoAbs)).not.toBe("");

    const out = await applyUpgrade(
      "aipe",
      { currentWorkspace: dir },
      {
        workspaces: async () => [dir],
        serves: async () => [],
        // rehydrate, in-process: this is what excludes `.claude/` and un-dirties
        // the repo before the migration runs.
        run: async (cmd) => ({ code: await rehydrateRun(["--workspace", cmd[3] as string]), output: "" }),
        // migrate, in-process: the real move + repair.
        migrate: async (_bin, ws) => {
          const r = await migrateLayout(ws, { apply: true, allowDirty: false });
          return { ok: r.ok, repos: r.ok && "plan" in r ? r.plan.moves.length : 0, output: JSON.stringify(r) };
        },
        isLegacy: async (ws) => {
          const b = await readBrain(ws);
          return b.ok && isLegacyLayout(b.brain.repos);
        },
        log: () => {},
      },
    );

    // The upgrade succeeded and DID the migration — no leftover homework.
    expect(out.ok).toBe(true);
    expect(out.migrated).toEqual([{ workspace: dir, repos: 1 }]);
    expect(out.deferredLegacy).toEqual([]);

    // The repo moved under repos/ …
    const movedRepo = join(dir, "repos", "embark");
    expect((await git(["rev-parse", "--is-inside-work-tree"], movedRepo)).stdout).toBe("true");

    // … the QA worktree came along and is usable at its new path …
    const movedWt = join(dir, "repos", "embark", ".worktrees", "j-qa-mike");
    expect((await git(["status", "--porcelain"], movedWt)).code).toBe(0);

    // … and every repo of the workspace ends with a CLEAN git status (D-J):
    // the .claude/ that dirtied it is now locally excluded.
    expect(await porcelain(movedRepo)).toBe("");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
