import { expect, test } from "bun:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { realInspect } from "../git";

async function git(args: string[], cwd: string): Promise<void> {
  const proc = Bun.spawn(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  const code = await proc.exited;
  if (code !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new Error(`git ${args.join(" ")} failed: ${stderr}`);
  }
}

test("nonexistent path → exists:false, isGitRepo:false", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-git-"));
  try {
    const target = join(dir, "does-not-exist");
    const result = await realInspect(target);
    expect(result).toEqual({ exists: false, isGitRepo: false });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("directory is the root of a git repo with origin → isGitRepo:true, remote read", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-git-"));
  try {
    await git(["init"], dir);
    await git(["remote", "add", "origin", "git@github.com:opvibes/embark.git"], dir);
    const result = await realInspect(dir);
    expect(result.exists).toBe(true);
    expect(result.isGitRepo).toBe(true);
    expect(result.remote).toBe("git@github.com:opvibes/embark.git");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("regression: a plain subdirectory inside an ancestor git repo is not treated as a repo", async () => {
  const parent = await mkdtemp(join(tmpdir(), "aipe-git-"));
  try {
    await git(["init"], parent);
    await git(["remote", "add", "origin", "git@github.com:opvibes/embark.git"], parent);
    const child = join(parent, "empty-subdir");
    await mkdir(child);
    const result = await realInspect(child);
    expect(result.exists).toBe(true);
    expect(result.isGitRepo).toBe(false);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});
