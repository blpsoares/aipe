// The real git-backed resolver: only COMMITTED specs/**/spec.md + plan.md count.
import { expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveSddArtifactsGit } from "../sdd-artifacts";

async function git(cwd: string, ...args: string[]): Promise<void> {
  const p = Bun.spawn(["git", "-C", cwd, ...args], { stdout: "pipe", stderr: "pipe" });
  await p.exited;
}

async function repo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "aipe-sddart-"));
  await git(dir, "init", "-q");
  await git(dir, "config", "user.email", "t@t");
  await git(dir, "config", "user.name", "t");
  return dir;
}

test("a worktree with no commits has no artifacts", async () => {
  const dir = await repo();
  try {
    expect(await resolveSddArtifactsGit(dir)).toEqual({ spec: false, plan: false });
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("an UNCOMMITTED spec on disk does not count — only committed artifacts do", async () => {
  const dir = await repo();
  try {
    await mkdir(join(dir, "specs", "1-x"), { recursive: true });
    await writeFile(join(dir, "specs", "1-x", "spec.md"), "# spec", "utf8");
    // present on disk, NOT committed → still missing
    expect((await resolveSddArtifactsGit(dir)).spec).toBe(false);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("committed spec + plan under specs/<feature>/ are both detected", async () => {
  const dir = await repo();
  try {
    await mkdir(join(dir, "specs", "118-x"), { recursive: true });
    await writeFile(join(dir, "specs", "118-x", "spec.md"), "# spec", "utf8");
    await writeFile(join(dir, "specs", "118-x", "plan.md"), "# plan", "utf8");
    await git(dir, "add", "-A");
    await git(dir, "commit", "-qm", "add sdd artifacts");
    expect(await resolveSddArtifactsGit(dir)).toEqual({ spec: true, plan: true });
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("removing the plan (git rm + commit) makes the gate see it missing again — the mutation the gate keys on", async () => {
  const dir = await repo();
  try {
    await mkdir(join(dir, "specs", "118-x"), { recursive: true });
    await writeFile(join(dir, "specs", "118-x", "spec.md"), "# spec", "utf8");
    await writeFile(join(dir, "specs", "118-x", "plan.md"), "# plan", "utf8");
    await git(dir, "add", "-A");
    await git(dir, "commit", "-qm", "add");
    await git(dir, "rm", "-q", "specs/118-x/plan.md");
    await git(dir, "commit", "-qm", "drop plan");
    expect(await resolveSddArtifactsGit(dir)).toEqual({ spec: true, plan: false });
  } finally { await rm(dir, { recursive: true, force: true }); }
});
