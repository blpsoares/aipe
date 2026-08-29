import { expect, test } from "bun:test";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse, stringify } from "yaml";
import type { BrainFile } from "../../context-brain/types";
import { run as gitRun } from "../../worktree/git";
import { checkPersonaReadiness } from "../../validate-personas/check";
import { migrateLayout } from "../run";

/** Add a persona's SKILL.md into `repoRelDir` and a personas.yaml row pointing at `recordedPath`. */
async function addPersona(
  dir: string,
  repo: string,
  slug: string,
  name: string,
  repoRelDir: string,
  recordedPath: string,
): Promise<void> {
  const repoAbs = join(dir, repoRelDir);
  const skillDir = join(repoAbs, ".claude", "skills", slug);
  await mkdir(skillDir, { recursive: true });
  await writeFile(join(skillDir, "SKILL.md"), `---\nname: ${slug}\ndescription: dev for ${repo}\n---\n\nYou are ${name}.\n`, "utf8");
  // A persona SKILL.md is committed in the repo normally; commit it so the repo
  // is clean and `migrate-layout` is not blocked on unrelated dirt.
  if (await exists(join(repoAbs, ".git"))) {
    await gitRun(["git", "-C", repoAbs, "add", "-A"]);
    await gitRun(["git", "-C", repoAbs, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "persona"]);
  }
  await writeFile(
    join(dir, ".aipe", "personas.yaml"),
    stringify({
      personas: [
        { name: "Nicolas", role: "coordinator", repo: null, path: null },
        { name, role: "dev-fullstack", repo, path: recordedPath },
      ],
    }),
    "utf8",
  );
}

async function personaPaths(dir: string): Promise<Record<string, string>> {
  const parsed = parse(await readFile(join(dir, ".aipe", "personas.yaml"), "utf8")) as {
    personas: { name: string; path: string | null }[];
  };
  return Object.fromEntries(parsed.personas.map((p) => [p.name, p.path ?? "(none)"]));
}

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

// Mirror what the real createWorktree does: keep the nested `.worktrees/` out of
// the parent repo's git status, so a registered worktree does not itself dirty
// the repo. Without this the raw `git worktree add` used in tests would make the
// dirt guard fire instead of exercising the worktree path.
async function excludeWorktrees(repoAbs: string): Promise<void> {
  const p = join(repoAbs, ".git", "info", "exclude");
  const prev = (await readFile(p, "utf8").catch(() => "")) as string;
  await writeFile(p, `${prev}${prev.endsWith("\n") || prev === "" ? "" : "\n"}.worktrees/\n`, "utf8");
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

// The whole thesis of the journey (scope item 2): a registered worktree no
// longer REFUSES the migration — the repo is moved and `git worktree repair`
// reconnects the worktree at its new nested path, so an in-flight dispatch
// survives the move instead of blocking it.
test("a registered worktree is migrated and stays usable — moved and repaired", async () => {
  const dir = await legacyWorkspace(["embark"]);
  try {
    const repo = join(dir, "embark");
    const wt = join(repo, ".worktrees", "j-1-dev");
    const added = await gitRun(["git", "-C", repo, "worktree", "add", "-q", "-b", "j-1", wt]);
    expect(added.code).toBe(0);
    await excludeWorktrees(repo);

    const result = await migrateLayout(dir, { apply: true, allowDirty: false });
    expect(result.ok).toBe(true);

    // The repo moved …
    expect(await exists(join(dir, "embark"))).toBe(false);
    const newWt = join(dir, "repos", "embark", ".worktrees", "j-1-dev");
    expect(await exists(newWt)).toBe(true);

    // … and the worktree is usable at its new path: git operations succeed and
    // git's own bookkeeping points at the NEW location, not the old one.
    const status = await gitRun(["git", "-C", newWt, "status", "--porcelain"]);
    expect(status.code).toBe(0);
    const list = await gitRun(["git", "-C", join(dir, "repos", "embark"), "worktree", "list"]);
    expect(list.stdout).toContain(newWt);
    expect(list.stdout).not.toContain(join(dir, "embark", ".worktrees"));
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

// D9: a legacy dispatch from a journey finished days ago, whose worktree is
// gone from disk, is dead bookkeeping — not work in flight. It must not pin the
// migration forever (the merged-unit immutability makes it unclosable). Mirrors
// PR #27's stale reconciliation: no live worktree ⇒ no live work.
test("a dispatch whose recorded worktree no longer exists does not block (D9)", async () => {
  const dir = await legacyWorkspace(["embark"]);
  try {
    const result = await migrateLayout(dir, { apply: true, allowDirty: false }, {
      journeys: async () => [
        {
          id: "j-20260825-s2",
          dispatches: [{ repo: "embark", status: "dispatched", worktree: join(dir, "embark", ".worktrees", "ghost-gone") }],
        },
      ],
    });
    expect(result.ok).toBe(true);
    expect(await exists(join(dir, "repos", "embark"))).toBe(true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// The other direction: a dispatch whose worktree is still on disk is live work
// and MUST keep blocking. RED→GREEN both ways.
test("a dispatch whose recorded worktree still exists keeps blocking (D9)", async () => {
  const dir = await legacyWorkspace(["embark"]);
  try {
    const liveWt = join(dir, "embark", ".worktrees", "j-live");
    await mkdir(liveWt, { recursive: true });
    const result = await migrateLayout(dir, { apply: true, allowDirty: true }, {
      journeys: async () => [
        { id: "j-20260828-live", dispatches: [{ repo: "embark", status: "dispatched", worktree: liveWt }] },
      ],
    });
    expect(result.ok).toBe(false);
    if (result.ok || !("blockers" in result)) throw new Error("expected blockers");
    expect(result.blockers.join("\n")).toContain("j-20260828-live");
    expect(await exists(join(dir, "embark"))).toBe(true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// Scope item 2: the absolute `worktree` path recorded in the ledger is repaired
// after the move, so an in-flight dispatch's row points at the live worktree.
// A merged unit is immutable — its (now-stale) path is left exactly as it was.
test("migrating repairs the ledger worktree path for live dispatches, never for merged (item 2)", async () => {
  const dir = await legacyWorkspace(["embark"]);
  try {
    const repo = join(dir, "embark");
    const wtAbs = join(repo, ".worktrees", "j-eh-dev");
    await gitRun(["git", "-C", repo, "worktree", "add", "-q", "-b", "j-eh-dev", wtAbs]);
    await excludeWorktrees(repo);
    await mkdir(join(dir, ".aipe", "journeys"), { recursive: true });
    await writeFile(
      join(dir, ".aipe", "journeys", "j-eh.yaml"),
      stringify({
        id: "j-eh",
        dispatches: [
          { repo: "embark", specialist: "Jesse", branch: "j-eh-dev", worktree: wtAbs, status: "delivered", evidence: { by: "dev", commands: ["x"], summary: "y" } },
          { repo: "embark", specialist: "Old", branch: "old", worktree: join(repo, ".worktrees", "old"), status: "merged" },
        ],
        authorizations: [],
      }),
      "utf8",
    );

    const result = await migrateLayout(dir, { apply: true, allowDirty: false });
    expect(result.ok).toBe(true);

    const ledger = parse(await readFile(join(dir, ".aipe", "journeys", "j-eh.yaml"), "utf8")) as {
      dispatches: { specialist: string; worktree: string; status: string }[];
    };
    const dev = ledger.dispatches.find((d) => d.specialist === "Jesse");
    const old = ledger.dispatches.find((d) => d.specialist === "Old");
    expect(dev?.worktree).toBe(join(dir, "repos", "embark", ".worktrees", "j-eh-dev"));
    expect(old?.worktree).toBe(join(dir, "embark", ".worktrees", "old"));
    expect(old?.status).toBe("merged");
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

test("--apply rewrites personas.yaml with the repo, so validate-personas is green afterward", async () => {
  const dir = await legacyWorkspace(["embark"]);
  try {
    // The persona lives inside the repo at the root layout, recorded there too.
    await addPersona(dir, "embark", "joaquim", "Joaquim", "embark", "./embark/.claude/skills/joaquim");

    // Before: the persona is ready at the root layout.
    expect((await checkPersonaReadiness(dir)).ready).toBe(1);

    const result = await migrateLayout(dir, { apply: true, allowDirty: false });
    expect(result.ok).toBe(true);
    if (!result.ok || !("personaChanges" in result)) throw new Error("expected personaChanges");
    expect(result.personaChanges).toEqual([
      { name: "Joaquim", from: "./embark/.claude/skills/joaquim", to: "./repos/embark/.claude/skills/joaquim" },
    ]);

    // The registry now points where the SKILL.md actually is, and readiness holds.
    expect((await personaPaths(dir)).Joaquim).toBe("./repos/embark/.claude/skills/joaquim");
    const readiness = await checkPersonaReadiness(dir);
    expect(readiness.ready).toBe(readiness.total);
    expect(readiness.ready).toBe(1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("preexisting drift: an already-migrated brain with a stale personas.yaml is detected and repaired, even with zero moves", async () => {
  const dir = await legacyWorkspace(["embark"]);
  try {
    // Simulate a workspace migrated by an older, persona-blind migration: the
    // brain and the repo are already under repos/, but personas.yaml still points
    // at the root. planMigration sees nothing to move.
    const brain: BrainFile = {
      context: { name: "opvibes", coordinator: "Nicolas" },
      repos: [{ name: "embark", url: "u", path: "./repos/embark" }],
    };
    await writeFile(join(dir, ".aipe", "brain.yaml"), stringify(brain), "utf8");
    await addPersona(dir, "embark", "joaquim", "Joaquim", join("repos", "embark"), "./embark/.claude/skills/joaquim");

    // The drift is real: validate-personas cannot find the SKILL.md at the stale path.
    expect((await checkPersonaReadiness(dir)).ready).toBe(0);

    // Dry-run detects it (no repo moves, one persona path).
    const dry = await migrateLayout(dir, { apply: false, allowDirty: false });
    expect(dry.ok).toBe(true);
    if (!dry.ok || !("personaChanges" in dry)) throw new Error("expected personaChanges");
    expect(dry.plan.moves).toEqual([]);
    expect(dry.personaChanges).toHaveLength(1);
    // Dry-run changed nothing on disk.
    expect((await personaPaths(dir)).Joaquim).toBe("./embark/.claude/skills/joaquim");

    // Apply repairs it and validate-personas goes green.
    const applied = await migrateLayout(dir, { apply: true, allowDirty: false });
    expect(applied.ok).toBe(true);
    expect((await personaPaths(dir)).Joaquim).toBe("./repos/embark/.claude/skills/joaquim");
    expect((await checkPersonaReadiness(dir)).ready).toBe(1);
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
