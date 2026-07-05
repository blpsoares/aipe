import { expect, test } from "bun:test";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stringify } from "yaml";
import { createWorktree, listWorktrees, removeWorktree } from "../run";
import type { BrainFile } from "../types";

async function sh(cmd: string[], cwd?: string): Promise<{ code: number; stdout: string }> {
  const proc = Bun.spawn(cmd, { cwd, stdout: "pipe", stderr: "pipe" });
  const stdout = await new Response(proc.stdout).text();
  return { code: await proc.exited, stdout: stdout.trim() };
}

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

// Build a workspace with one repo `embark` that is a real git repo with a
// pushed `main` (bare origin), so unpushed-detection has a meaningful baseline.
async function makeWorkspace(): Promise<{ dir: string; repoAbs: string }> {
  const dir = await mkdtemp(join(tmpdir(), "aipe-wt-"));
  const repoAbs = join(dir, "embark");
  const originAbs = join(dir, "origin.git");

  await sh(["git", "init", "--bare", "-b", "main", originAbs]);
  await mkdir(repoAbs, { recursive: true });
  await sh(["git", "init", "-b", "main", repoAbs]);
  await sh(["git", "-C", repoAbs, "config", "user.email", "pe@example.com"], repoAbs);
  await sh(["git", "-C", repoAbs, "config", "user.name", "Real PE"], repoAbs);
  await writeFile(join(repoAbs, "README.md"), "# embark\n", "utf8");
  await sh(["git", "-C", repoAbs, "add", "-A"]);
  await sh(["git", "-C", repoAbs, "commit", "-m", "init"]);
  await sh(["git", "-C", repoAbs, "remote", "add", "origin", originAbs]);
  await sh(["git", "-C", repoAbs, "push", "-u", "origin", "main"]);

  const brain: BrainFile = {
    context: { name: "opvibes", coordinator: "Nicolas" },
    repos: [{ name: "embark", url: originAbs, path: "./embark" }],
  };
  await mkdir(join(dir, ".aipe"), { recursive: true });
  await writeFile(join(dir, ".aipe", "brain.yaml"), stringify(brain), "utf8");
  return { dir, repoAbs };
}

test("createWorktree makes the worktree on the aipe branch with per-worktree identity", async () => {
  const { dir, repoAbs } = await makeWorkspace();
  try {
    const result = await createWorktree(dir, { repo: "embark", specialist: "Joaquim", journey: "j1" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.created).toBe(true);
    expect(result.branch).toBe("aipe/j1/joaquim");
    expect(await exists(join(repoAbs, ".worktrees", "j1-joaquim"))).toBe(true);

    // per-worktree user.name is the namespaced persona; email stays inherited
    const name = await sh(["git", "-C", result.path, "config", "--worktree", "--get", "user.name"]);
    expect(name.stdout).toBe("aipe/Joaquim");
    const emailAtWorktreeScope = await sh(["git", "-C", result.path, "config", "--worktree", "--get", "user.email"]);
    expect(emailAtWorktreeScope.code).not.toBe(0); // not set at worktree scope → inherited
    const effectiveEmail = await sh(["git", "-C", result.path, "config", "--get", "user.email"]);
    expect(effectiveEmail.stdout).toBe("pe@example.com");

    // .worktrees/ is excluded locally, not via a tracked .gitignore
    const exclude = await readFile(join(repoAbs, ".git", "info", "exclude"), "utf8");
    expect(exclude).toContain(".worktrees/");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("createWorktree is idempotent for the same (repo, journey, specialist)", async () => {
  const { dir } = await makeWorkspace();
  try {
    await createWorktree(dir, { repo: "embark", specialist: "Joaquim", journey: "j1" });
    const again = await createWorktree(dir, { repo: "embark", specialist: "Joaquim", journey: "j1" });
    expect(again.ok).toBe(true);
    if (again.ok) expect(again.created).toBe(false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("listWorktrees returns a row per AIPe worktree, filterable by journey", async () => {
  const { dir } = await makeWorkspace();
  try {
    await createWorktree(dir, { repo: "embark", specialist: "Joaquim", journey: "j1" });
    await createWorktree(dir, { repo: "embark", specialist: "Marina", journey: "j2" });
    const all = await listWorktrees(dir);
    expect(all.map((r) => r.slug).sort()).toEqual(["joaquim", "marina"]);
    const j1 = await listWorktrees(dir, "j1");
    expect(j1).toHaveLength(1);
    expect(j1[0]?.journey).toBe("j1");
    expect(j1[0]?.repo).toBe("embark");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("removeWorktree succeeds on a clean, fully-pushed worktree", async () => {
  const { dir } = await makeWorkspace();
  try {
    await createWorktree(dir, { repo: "embark", specialist: "Joaquim", journey: "j1" });
    const removed = await removeWorktree(dir, { repo: "embark", specialist: "Joaquim", journey: "j1" });
    expect(removed.ok).toBe(true);
    expect(await listWorktrees(dir)).toHaveLength(0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("removeWorktree blocks on uncommitted work, --force overrides", async () => {
  const { dir } = await makeWorkspace();
  try {
    const created = await createWorktree(dir, { repo: "embark", specialist: "Joaquim", journey: "j1" });
    if (!created.ok) throw new Error("setup failed");
    await writeFile(join(created.path, "scratch.txt"), "wip", "utf8");

    const blocked = await removeWorktree(dir, { repo: "embark", specialist: "Joaquim", journey: "j1" });
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.blocked).toBe(true);
    expect(await exists(created.path)).toBe(true);

    const forced = await removeWorktree(dir, { repo: "embark", specialist: "Joaquim", journey: "j1", force: true });
    expect(forced.ok).toBe(true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("createWorktree rejects an unknown repo and an invalid journey id", async () => {
  const { dir } = await makeWorkspace();
  try {
    const unknownRepo = await createWorktree(dir, { repo: "ghost", specialist: "Joaquim", journey: "j1" });
    expect(unknownRepo.ok).toBe(false);
    const badJourney = await createWorktree(dir, { repo: "embark", specialist: "Joaquim", journey: "Bad/Id" });
    expect(badJourney.ok).toBe(false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
