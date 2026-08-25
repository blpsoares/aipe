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
    await scaffoldWorkspace(dir);

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
