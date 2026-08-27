// The workspace .gitignore is an ALLOWLIST, and this test is what keeps it one.
//
// The PE commits the assembled workspace by hand (`git add -A` in a folder that
// also holds the team's checked-out code). With `/*` denying everything at the
// top level, a file nobody planned for cannot ride along. Replacing that with a
// list of things to IGNORE — e.g. just `/repos/` — inverts the default and
// publishes whatever happens to be lying in the workspace root.
import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { claudeCodeAdapter } from "../../harness/claude-code";
import { geminiAdapter } from "../../harness/gemini";
import { scaffoldWorkspace } from "../scaffold";
import { run as gitRun } from "../../worktree/git";

async function staged(dir: string): Promise<string[]> {
  await gitRun(["git", "-C", dir, "add", "-A"]);
  const out = await gitRun(["git", "-C", dir, "diff", "--cached", "--name-only"]);
  return out.stdout.split("\n").filter(Boolean).sort();
}

test("git add -A on an assembled workspace stages the brain and nothing else", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-gi-"));
  try {
    // The adapter decides which paths the allowlist re-admits — `aipe start`
    // always has one, and a hardcoded `.claude/` would leave every other
    // harness's integration out of the published workspace.
    await scaffoldWorkspace(dir, claudeCodeAdapter);

    // the brain
    await mkdir(join(dir, ".aipe"), { recursive: true });
    await mkdir(join(dir, ".claude"), { recursive: true });
    await writeFile(join(dir, ".aipe", "brain.yaml"), "context: {}\n", "utf8");
    await writeFile(join(dir, ".claude", "hook.sh"), "#!/bin/sh\n", "utf8");

    // the team's code, in both layouts
    await mkdir(join(dir, "repos", "platform"), { recursive: true });
    await writeFile(join(dir, "repos", "platform", "main.ts"), "export {}\n", "utf8");
    await mkdir(join(dir, "legacy-repo"), { recursive: true });
    await writeFile(join(dir, "legacy-repo", "main.ts"), "export {}\n", "utf8");

    // and the things that just show up in a working folder
    await writeFile(join(dir, ".env"), "TOKEN=secret\n", "utf8");
    await writeFile(join(dir, "notes.md"), "scratch\n", "utf8");
    await mkdir(join(dir, ".vscode"), { recursive: true });
    await writeFile(join(dir, ".vscode", "settings.json"), "{}\n", "utf8");

    expect(await staged(dir)).toEqual([
      ".aipe/brain.yaml",
      ".claude/hook.sh",
      ".gitignore",
      "README.md",
    ]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("per-machine .aipe artifacts never ride along — toolchain.yaml, .rehydrate.lock, and dispatch locks stay local", async () => {
  // .aipe/ is allowlisted (!/.aipe/), so anything inside it publishes unless
  // explicitly re-ignored. The dispatch claim locks are per-machine mutual
  // exclusion keyed by local pids — publishing them would wedge a fresh clone.
  const dir = await mkdtemp(join(tmpdir(), "aipe-gi-locks-"));
  try {
    await scaffoldWorkspace(dir, claudeCodeAdapter);

    await mkdir(join(dir, ".aipe", "locks"), { recursive: true });
    await writeFile(join(dir, ".aipe", "brain.yaml"), "context: {}\n", "utf8");
    await writeFile(join(dir, ".aipe", "toolchain.yaml"), "version: 1\n", "utf8");
    await writeFile(join(dir, ".aipe", ".rehydrate.lock"), "", "utf8");
    await writeFile(join(dir, ".aipe", "locks", "embark.lock"), "repo: embark\npid: 4321\n", "utf8");
    await writeFile(join(dir, ".aipe", "locks", "platform__core.lock"), "repo: platform\npid: 4322\n", "utf8");

    const s = await staged(dir);
    // the brain publishes...
    expect(s).toContain(".aipe/brain.yaml");
    // ...the per-machine artifacts do not
    expect(s).not.toContain(".aipe/toolchain.yaml");
    expect(s).not.toContain(".aipe/.rehydrate.lock");
    expect(s.some((p) => p.startsWith(".aipe/locks/"))).toBe(false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("the allowlist follows the harness — a Gemini workspace publishes .gemini/ and .agents/", async () => {
  // Same guarantee, different harness: what must never happen is the
  // integration being ignored (published workspace rehydrates into nothing)
  // or the working folder's noise riding along.
  const dir = await mkdtemp(join(tmpdir(), "aipe-gi-gemini-"));
  try {
    await scaffoldWorkspace(dir, geminiAdapter);

    await mkdir(join(dir, ".aipe"), { recursive: true });
    await mkdir(join(dir, ".gemini"), { recursive: true });
    await mkdir(join(dir, ".agents", "skills"), { recursive: true });
    await writeFile(join(dir, ".aipe", "brain.yaml"), "context: {}\n", "utf8");
    await writeFile(join(dir, ".gemini", "settings.json"), "{}\n", "utf8");
    await writeFile(join(dir, ".agents", "skills", "operate.md"), "flow\n", "utf8");

    // a Claude folder left over from a previous harness must NOT ride along
    await mkdir(join(dir, ".claude"), { recursive: true });
    await writeFile(join(dir, ".claude", "hook.sh"), "#!/bin/sh\n", "utf8");

    await writeFile(join(dir, ".env"), "TOKEN=secret\n", "utf8");
    await mkdir(join(dir, "repos", "platform"), { recursive: true });
    await writeFile(join(dir, "repos", "platform", "main.ts"), "export {}\n", "utf8");

    expect(await staged(dir)).toEqual([
      ".agents/skills/operate.md",
      ".aipe/brain.yaml",
      ".gemini/settings.json",
      ".gitignore",
      "README.md",
    ]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
