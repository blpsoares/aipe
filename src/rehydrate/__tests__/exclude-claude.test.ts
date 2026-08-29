import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stringify } from "yaml";
import { run as git } from "../../worktree/git";
import type { BrainFile } from "../../context-brain/types";
import { ensureReposExcludeClaude } from "../exclude";

async function porcelain(repoAbs: string): Promise<string> {
  return (await git(["git", "-C", repoAbs, "status", "--porcelain"])).stdout;
}

// A workspace whose single repo is a real git checkout with an untracked
// `.claude/` — exactly what `rehydrate` leaves behind and what dirties the repo.
async function workspaceWithDirtyRepo(): Promise<{ dir: string; repoAbs: string }> {
  const dir = await mkdtemp(join(tmpdir(), "aipe-excl-"));
  const brain: BrainFile = {
    context: { name: "opvibes", coordinator: "Nicolas" },
    repos: [{ name: "embark", url: "u", path: "./embark" }],
  };
  await mkdir(join(dir, ".aipe"), { recursive: true });
  await writeFile(join(dir, ".aipe", "brain.yaml"), stringify(brain), "utf8");

  const repoAbs = join(dir, "embark");
  await mkdir(repoAbs, { recursive: true });
  await git(["git", "-C", repoAbs, "init", "-q"]);
  await git(["git", "-C", repoAbs, "config", "user.email", "t@t"]);
  await git(["git", "-C", repoAbs, "config", "user.name", "t"]);
  await writeFile(join(repoAbs, "README.md"), "hi\n", "utf8");
  await git(["git", "-C", repoAbs, "add", "-A"]);
  await git(["git", "-C", repoAbs, "commit", "-q", "-m", "init"]);

  // The artifact rehydrate would drop in — untracked, so it dirties the repo.
  await mkdir(join(repoAbs, ".claude", "skills", "operate"), { recursive: true });
  await writeFile(join(repoAbs, ".claude", "skills", "operate", "SKILL.md"), "x\n", "utf8");
  return { dir, repoAbs };
}

test("untracked .claude/ dirties the repo before excluding", async () => {
  const { dir, repoAbs } = await workspaceWithDirtyRepo();
  try {
    expect(await porcelain(repoAbs)).not.toBe(""); // RED baseline: .claude shows as dirty
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("ensureReposExcludeClaude leaves every repo's git status clean", async () => {
  const { dir, repoAbs } = await workspaceWithDirtyRepo();
  try {
    const excluded = await ensureReposExcludeClaude(dir);
    expect(excluded).toContain(repoAbs);
    expect(await porcelain(repoAbs)).toBe("");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("is idempotent and skips repos that are not git checkouts", async () => {
  const { dir, repoAbs } = await workspaceWithDirtyRepo();
  try {
    await ensureReposExcludeClaude(dir);
    // Second run must not duplicate the exclude entry nor throw.
    await ensureReposExcludeClaude(dir);
    const excludeBody = await Bun.file(join(repoAbs, ".git", "info", "exclude")).text();
    const hits = excludeBody.split("\n").filter((l) => l.trim() === ".claude/").length;
    expect(hits).toBe(1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
