import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stringify } from "yaml";
import type { BrainFile } from "../../context-brain/types";
import { run as gitRun } from "../../worktree/git";
import { run } from "../cli";

let logs: string[] = [];
const realLog = console.log;
beforeEach(() => {
  logs = [];
  console.log = (...a: unknown[]) => logs.push(a.join(" "));
});
afterEach(() => {
  console.log = realLog;
});

// D10: run outside a workspace (the PE was in $HOME). The old message pointed at
// `/context-brain`, which would seed a workspace in the wrong place. It must name
// what happened and end on the fix — never send them to create a context.
test("outside a workspace, names the problem and does not suggest /context-brain (D10)", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-mig-cli-"));
  try {
    const code = await run(["migrate-layout", "--workspace", dir]);
    expect(code).toBe(1);
    const out = logs.join("\n");
    expect(out).toContain("no AIPe workspace");
    expect(out).toContain("--workspace");
    expect(out).not.toContain("context-brain");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// D10: a blocker must end on the action that clears it.
test("a dirty-repo blocker ends on the unblocking action (D10)", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-mig-cli-"));
  try {
    const brain: BrainFile = {
      context: { name: "opvibes", coordinator: "Nicolas" },
      repos: [{ name: "embark", url: "u", path: "./embark" }],
    };
    await mkdir(join(dir, ".aipe"), { recursive: true });
    await writeFile(join(dir, ".aipe", "brain.yaml"), stringify(brain), "utf8");
    const repo = join(dir, "embark");
    await mkdir(repo, { recursive: true });
    await gitRun(["git", "-C", repo, "init", "-q", "-b", "main"]);
    await writeFile(join(repo, "README.md"), "# embark\n", "utf8");
    await gitRun(["git", "-C", repo, "add", "-A"]);
    await gitRun(["git", "-C", repo, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init"]);
    await writeFile(join(repo, "wip.ts"), "// uncommitted\n", "utf8");

    const code = await run(["migrate-layout", "--apply", "--workspace", dir]);
    expect(code).toBe(1);
    const blocker = logs.find((l) => l.startsWith("BLOCKED") && l.includes("dirty"));
    expect(blocker).toBeDefined();
    expect(blocker).toContain("--allow-dirty");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
