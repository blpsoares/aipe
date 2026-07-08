import { expect, test } from "bun:test";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stringify } from "yaml";
import { createWorktree, listWorktrees, pruneWorktrees, removeWorktree } from "../run";
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

// Like makeWorkspace but the repo `embark` is a *bare* clone (no working tree,
// core.bare=true) — the layout that broke git add/status and remove path
// resolution.
async function makeBareWorkspace(): Promise<{ dir: string; repoAbs: string }> {
  const dir = await mkdtemp(join(tmpdir(), "aipe-wtb-"));
  const originAbs = join(dir, "origin.git");
  const seedAbs = join(dir, "seed");
  const repoAbs = join(dir, "embark");

  await sh(["git", "init", "--bare", "-b", "main", originAbs]);
  await sh(["git", "init", "-b", "main", seedAbs]);
  await sh(["git", "-C", seedAbs, "config", "user.email", "pe@example.com"]);
  await sh(["git", "-C", seedAbs, "config", "user.name", "Real PE"]);
  await writeFile(join(seedAbs, "README.md"), "# embark\n", "utf8");
  await sh(["git", "-C", seedAbs, "add", "-A"]);
  await sh(["git", "-C", seedAbs, "commit", "-m", "init"]);
  await sh(["git", "-C", seedAbs, "remote", "add", "origin", originAbs]);
  await sh(["git", "-C", seedAbs, "push", "-u", "origin", "main"]);

  await sh(["git", "clone", "--bare", originAbs, repoAbs]);

  const brain: BrainFile = {
    context: { name: "opvibes", coordinator: "Nicolas" },
    repos: [{ name: "embark", url: originAbs, path: "./embark" }],
  };
  await mkdir(join(dir, ".aipe"), { recursive: true });
  await writeFile(join(dir, ".aipe", "brain.yaml"), stringify(brain), "utf8");
  return { dir, repoAbs };
}

async function writeLedger(dir: string, id: string, dispatches: unknown[]): Promise<void> {
  await mkdir(join(dir, ".aipe", "journeys"), { recursive: true });
  await writeFile(
    join(dir, ".aipe", "journeys", `${id}.yaml`),
    stringify({ id, dispatches, authorizations: [] }),
    "utf8",
  );
}

test("createWorktree on a bare repo yields a working tree where git add/status work (A3)", async () => {
  const { dir } = await makeBareWorkspace();
  try {
    const created = await createWorktree(dir, { repo: "embark", specialist: "Joaquim", journey: "j1" });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    // The shared repo must stay bare; only the worktree is non-bare.
    const bareRepo = await sh(["git", "-C", created.path, "rev-parse", "--is-bare-repository"]);
    expect(bareRepo.stdout).toBe("false");

    await writeFile(join(created.path, "work.txt"), "hello", "utf8");
    const add = await sh(["git", "-C", created.path, "add", "-A"]);
    expect(add.code).toBe(0);
    const status = await sh(["git", "-C", created.path, "status", "--porcelain"]);
    expect(status.code).toBe(0);
    expect(status.stdout).toContain("work.txt");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("round-trip create→remove works on a bare repo layout (A2)", async () => {
  const { dir } = await makeBareWorkspace();
  try {
    const created = await createWorktree(dir, { repo: "embark", specialist: "Joaquim", journey: "j1" });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    // create's reported path must match git's ground truth (worktree list).
    const list = await sh(["git", "-C", join(dir, "embark"), "worktree", "list", "--porcelain"]);
    expect(list.stdout).toContain(`worktree ${created.path}`);
    expect(await exists(created.path)).toBe(true);

    const removed = await removeWorktree(dir, { repo: "embark", specialist: "Joaquim", journey: "j1" });
    expect(removed.ok).toBe(true);
    if (removed.ok) expect(removed.path).toBe(created.path);
    expect(await exists(created.path)).toBe(false);
    expect(await listWorktrees(dir, "j1")).toHaveLength(0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("removeWorktree still blocks unpushed commits on a bare repo worktree (A3 guardrail)", async () => {
  const { dir } = await makeBareWorkspace();
  try {
    const created = await createWorktree(dir, { repo: "embark", specialist: "Joaquim", journey: "j1" });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    // Commit locally without pushing: the guardrail must catch this even though
    // a bare/mirror clone has no refs/remotes/* namespace.
    await sh(["git", "-C", created.path, "commit", "--allow-empty", "-m", "wip"]);
    const blocked = await removeWorktree(dir, { repo: "embark", specialist: "Joaquim", journey: "j1" });
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.blocked).toBe(true);
    expect(await exists(created.path)).toBe(true);

    const forced = await removeWorktree(dir, { repo: "embark", specialist: "Joaquim", journey: "j1", force: true });
    expect(forced.ok).toBe(true);
    expect(await exists(created.path)).toBe(false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("pruneWorktrees keeps ACTIVE dispatches, removes only TERMINAL ones (A1)", async () => {
  const { dir } = await makeWorkspace();
  try {
    const active = await createWorktree(dir, { repo: "embark", specialist: "Ativo", journey: "jl" });
    const terminal = await createWorktree(dir, { repo: "embark", specialist: "Terminado", journey: "jl" });
    if (!active.ok || !terminal.ok) throw new Error("setup");

    await writeLedger(dir, "jl", [
      { repo: "embark", specialist: "Ativo", branch: active.branch, worktree: active.path, status: "delivered" },
      { repo: "embark", specialist: "Terminado", branch: terminal.branch, worktree: terminal.path, status: "merged" },
    ]);

    const rows = await pruneWorktrees(dir, "jl");
    const byslug = Object.fromEntries(rows.map((r) => [r.slug, r.status]));
    expect(byslug["ativo"]).toBe("skipped");
    expect(byslug["terminado"]).toBe("removed");

    // active worktree survives; terminal one is gone
    const left = (await listWorktrees(dir, "jl")).map((r) => r.slug);
    expect(left).toEqual(["ativo"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("pruneWorktrees --force removes ACTIVE dispatches too (A1)", async () => {
  const { dir } = await makeWorkspace();
  try {
    const active = await createWorktree(dir, { repo: "embark", specialist: "Ativo", journey: "jf" });
    if (!active.ok) throw new Error("setup");
    await writeLedger(dir, "jf", [
      { repo: "embark", specialist: "Ativo", branch: active.branch, worktree: active.path, status: "dispatched" },
    ]);

    const rows = await pruneWorktrees(dir, "jf", true);
    expect(rows.find((r) => r.slug === "ativo")?.status).toBe("removed");
    expect(await listWorktrees(dir, "jf")).toHaveLength(0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

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

test("pruneWorktrees sweeps a journey's clean worktrees, keeps dirty ones", async () => {
  const { dir, repoAbs } = await makeWorkspace();
  try {
    const clean = await createWorktree(dir, { repo: "embark", specialist: "Joaquim", journey: "jp" });
    await createWorktree(dir, { repo: "embark", specialist: "Marina", journey: "jp" });
    if (!clean.ok) throw new Error("setup");
    // dirty one of them
    await writeFile(join(repoAbs, ".worktrees", "jp-marina", "wip.txt"), "x", "utf8");

    const rows = await pruneWorktrees(dir, "jp");
    const byslug = Object.fromEntries(rows.map((r) => [r.slug, r.status]));
    expect(byslug["joaquim"]).toBe("removed");
    expect(byslug["marina"]).toBe("blocked");
    // only the clean one is gone
    expect((await listWorktrees(dir, "jp")).map((r) => r.slug)).toEqual(["marina"]);
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
