import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stringify } from "yaml";
import { renderRows, run } from "../cli";
import type { BrainFile, WorktreeRow } from "../types";

test("renderRows formats each worktree as a WT line", () => {
  const rows: WorktreeRow[] = [
    { repo: "embark", slug: "joaquim", journey: "j1", branch: "aipe/j1/joaquim", path: "/w/embark/.worktrees/j1-joaquim" },
  ];
  expect(renderRows(rows)).toEqual([
    "WT embark joaquim j1 aipe/j1/joaquim /w/embark/.worktrees/j1-joaquim",
  ]);
});

async function makeWorkspace(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "aipe-wtcli-"));
  const repoAbs = join(dir, "embark");
  const originAbs = join(dir, "origin.git");
  const g = async (cmd: string[], cwd?: string) => {
    const proc = Bun.spawn(cmd, { cwd, stdout: "pipe", stderr: "pipe" });
    await proc.exited;
  };
  await g(["git", "init", "--bare", "-b", "main", originAbs]);
  await mkdir(repoAbs, { recursive: true });
  await g(["git", "init", "-b", "main", repoAbs]);
  await g(["git", "-C", repoAbs, "config", "user.email", "pe@example.com"]);
  await g(["git", "-C", repoAbs, "config", "user.name", "Real PE"]);
  await writeFile(join(repoAbs, "README.md"), "# embark\n", "utf8");
  await g(["git", "-C", repoAbs, "add", "-A"]);
  await g(["git", "-C", repoAbs, "commit", "-m", "init"]);
  await g(["git", "-C", repoAbs, "remote", "add", "origin", originAbs]);
  await g(["git", "-C", repoAbs, "push", "-u", "origin", "main"]);
  const brain: BrainFile = {
    context: { name: "opvibes", coordinator: "Nicolas" },
    repos: [{ name: "embark", url: originAbs, path: "./embark" }],
  };
  await mkdir(join(dir, ".aipe"), { recursive: true });
  await writeFile(join(dir, ".aipe", "brain.yaml"), stringify(brain), "utf8");
  return dir;
}

test("run create prints OK and exits 0; unknown command exits 1", async () => {
  const dir = await makeWorkspace();
  try {
    const code = await run(["create", "--repo", "embark", "--specialist", "Joaquim", "--journey", "j1", "--workspace", dir]);
    expect(code).toBe(0);
    const bad = await run(["frobnicate"]);
    expect(bad).toBe(1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("run create rejects a bad journey id with exit 1", async () => {
  const dir = await makeWorkspace();
  try {
    const code = await run(["create", "--repo", "embark", "--specialist", "Joaquim", "--journey", "BAD", "--workspace", dir]);
    expect(code).toBe(1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
