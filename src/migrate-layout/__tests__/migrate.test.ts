import { expect, test } from "bun:test";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse, stringify } from "yaml";
import type { BrainFile } from "../../context-brain/types";
import { run as gitRun } from "../../worktree/git";
import { migrateLayout } from "../run";

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

/** A workspace with `names` cloned at the ROOT (the legacy layout), each a real git repo. */
async function legacyWorkspace(names: string[]): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "aipe-mig-"));
  const brain: BrainFile = {
    context: { name: "opvibes", coordinator: "Nicolas" },
    repos: names.map((n) => ({ name: n, url: `git@github.com:opvibes/${n}.git`, path: `./${n}` })),
  };
  await mkdir(join(dir, ".aipe"), { recursive: true });
  await writeFile(join(dir, ".aipe", "brain.yaml"), stringify(brain), "utf8");
  for (const n of names) {
    const repo = join(dir, n);
    await mkdir(repo, { recursive: true });
    await gitRun(["git", "init", "-q", "-b", "main"], repo);
    await writeFile(join(repo, "README.md"), `# ${n}\n`, "utf8");
    await gitRun(["git", "-C", repo, "add", "-A"]);
    await gitRun(["git", "-C", repo, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init"]);
  }
  return dir;
}

async function brainPaths(dir: string): Promise<Record<string, string>> {
  const raw = await readFile(join(dir, ".aipe", "brain.yaml"), "utf8");
  const brain = parse(raw) as BrainFile;
  return Object.fromEntries(brain.repos.map((r) => [r.name, r.path]));
}

test("dry-run reports the moves and changes absolutely nothing", async () => {
  const dir = await legacyWorkspace(["embark", "platform"]);
  try {
    const result = await migrateLayout(dir, { apply: false, allowDirty: false });
    expect(result.ok).toBe(true);
    if (!result.ok || !("plan" in result)) throw new Error("expected a plan");
    expect(result.applied).toBe(false);
    expect(result.plan.moves.map((m) => m.repo).sort()).toEqual(["embark", "platform"]);

    expect(await exists(join(dir, "embark"))).toBe(true);
    expect(await exists(join(dir, "repos", "embark"))).toBe(false);
    expect((await brainPaths(dir)).embark).toBe("./embark");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("--apply moves the repos and rewrites brain.yaml", async () => {
  const dir = await legacyWorkspace(["embark", "platform"]);
  try {
    const result = await migrateLayout(dir, { apply: true, allowDirty: false });
    expect(result.ok).toBe(true);

    expect(await exists(join(dir, "embark"))).toBe(false);
    expect(await exists(join(dir, "repos", "embark", ".git"))).toBe(true);
    expect(await exists(join(dir, "repos", "platform", "README.md"))).toBe(true);
    expect(await brainPaths(dir)).toEqual({
      embark: "./repos/embark",
      platform: "./repos/platform",
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("the moved repo is still a working git repo", async () => {
  const dir = await legacyWorkspace(["embark"]);
  try {
    await migrateLayout(dir, { apply: true, allowDirty: false });
    const log = await gitRun(["git", "-C", join(dir, "repos", "embark"), "log", "--oneline", "-1"]);
    expect(log.code).toBe(0);
    expect(log.stdout).toContain("init");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a registered worktree blocks the migration — its gitdir path is absolute", async () => {
  const dir = await legacyWorkspace(["embark"]);
  try {
    const repo = join(dir, "embark");
    const wt = join(repo, ".worktrees", "j-1-dev");
    const added = await gitRun(["git", "-C", repo, "worktree", "add", "-q", "-b", "j-1", wt]);
    expect(added.code).toBe(0);

    const result = await migrateLayout(dir, { apply: true, allowDirty: false });
    expect(result.ok).toBe(false);
    if (result.ok || !("blockers" in result)) throw new Error("expected blockers");
    expect(result.blockers.join("\n")).toContain("registered worktree");

    // and nothing moved
    expect(await exists(join(dir, "embark"))).toBe(true);
    expect(await exists(join(dir, "repos"))).toBe(false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a dirty repo blocks, and --allow-dirty lets it through with the changes intact", async () => {
  const dir = await legacyWorkspace(["embark"]);
  try {
    await writeFile(join(dir, "embark", "wip.ts"), "// uncommitted\n", "utf8");

    const blocked = await migrateLayout(dir, { apply: true, allowDirty: false });
    expect(blocked.ok).toBe(false);
    if (blocked.ok || !("blockers" in blocked)) throw new Error("expected blockers");
    expect(blocked.blockers.join("\n")).toContain("dirty");
    expect(await exists(join(dir, "embark", "wip.ts"))).toBe(true);

    const forced = await migrateLayout(dir, { apply: true, allowDirty: true });
    expect(forced.ok).toBe(true);
    expect(await readFile(join(dir, "repos", "embark", "wip.ts"), "utf8")).toBe("// uncommitted\n");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a journey with work in flight blocks the migration", async () => {
  const dir = await legacyWorkspace(["embark"]);
  try {
    const result = await migrateLayout(dir, { apply: true, allowDirty: false }, {
      journeys: async () => [
        { id: "j-20260825-a1", dispatches: [{ repo: "embark", status: "dispatched" }] },
      ],
    });
    expect(result.ok).toBe(false);
    if (result.ok || !("blockers" in result)) throw new Error("expected blockers");
    expect(result.blockers.join("\n")).toContain("j-20260825-a1");
    expect(await exists(join(dir, "embark"))).toBe(true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a finished journey does not block", async () => {
  const dir = await legacyWorkspace(["embark"]);
  try {
    const result = await migrateLayout(dir, { apply: true, allowDirty: false }, {
      journeys: async () => [
        { id: "j-1", dispatches: [{ repo: "embark", status: "merged" }] },
      ],
    });
    expect(result.ok).toBe(true);
    expect(await exists(join(dir, "repos", "embark"))).toBe(true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("an occupied target blocks instead of clobbering it", async () => {
  const dir = await legacyWorkspace(["embark"]);
  try {
    await mkdir(join(dir, "repos", "embark"), { recursive: true });
    await writeFile(join(dir, "repos", "embark", "someone-elses.txt"), "keep me\n", "utf8");

    const result = await migrateLayout(dir, { apply: true, allowDirty: false });
    expect(result.ok).toBe(false);
    expect(await readFile(join(dir, "repos", "embark", "someone-elses.txt"), "utf8")).toBe("keep me\n");
    expect(await exists(join(dir, "embark", ".git"))).toBe(true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a failure halfway rolls every completed move back and never writes brain.yaml", async () => {
  const dir = await legacyWorkspace(["aaa", "bbb", "ccc"]);
  try {
    const before = await brainPaths(dir);
    let moves = 0;
    const result = await migrateLayout(dir, { apply: true, allowDirty: false }, {
      move: async (fromAbs, toAbs) => {
        // Let the first repo through, blow up on the second.
        if (moves++ === 1 && !toAbs.includes("/aaa")) throw new Error("disk full");
        await mkdir(join(toAbs, ".."), { recursive: true });
        await gitRun(["mv", fromAbs, toAbs]);
      },
    });

    expect(result.ok).toBe(false);
    if (result.ok || !("blockers" in result)) throw new Error("expected blockers");
    expect(result.blockers.join("\n")).toContain("rolled back");

    // disk is back where it started …
    for (const n of ["aaa", "bbb", "ccc"]) {
      expect(await exists(join(dir, n, ".git"))).toBe(true);
    }
    // … and the brain still describes it
    expect(await brainPaths(dir)).toEqual(before);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a repo that was never cloned changes path only, and does not abort the run", async () => {
  const dir = await legacyWorkspace(["embark"]);
  try {
    const brain = parse(await readFile(join(dir, ".aipe", "brain.yaml"), "utf8")) as BrainFile;
    brain.repos.push({ name: "ghost", url: "git@github.com:opvibes/ghost.git", path: "./ghost" });
    await writeFile(join(dir, ".aipe", "brain.yaml"), stringify(brain), "utf8");

    const result = await migrateLayout(dir, { apply: true, allowDirty: false });
    expect(result.ok).toBe(true);
    expect(await brainPaths(dir)).toEqual({
      embark: "./repos/embark",
      ghost: "./repos/ghost",
    });
    expect(await exists(join(dir, "repos", "ghost"))).toBe(false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("repos already nested are reported as skipped, never moved", async () => {
  const dir = await legacyWorkspace(["embark"]);
  try {
    const brain = parse(await readFile(join(dir, ".aipe", "brain.yaml"), "utf8")) as BrainFile;
    brain.repos = [{ name: "billing", url: "git@x:o/billing.git", path: "./services/billing" }];
    await writeFile(join(dir, ".aipe", "brain.yaml"), stringify(brain), "utf8");

    const result = await migrateLayout(dir, { apply: true, allowDirty: false });
    expect(result.ok).toBe(true);
    if (!result.ok || !("plan" in result)) throw new Error("expected a plan");
    expect(result.plan.moves).toEqual([]);
    expect(result.plan.untouched[0]?.reason).toContain("already nested");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
