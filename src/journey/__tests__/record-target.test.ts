import { expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { classifyRecordTarget, findPhantomLedgers } from "../record-target";
import { run as journeyRun } from "../cli";

// A workspace holding one repo, with a worktree under <repo>/.worktrees/. Mirrors
// the real layout: <ws>/.aipe/brain.yaml + <ws>/<repo>/.worktrees/<name>.
async function workspaceWithWorktree(): Promise<{ ws: string; repo: string; worktree: string }> {
  const ws = await mkdtemp(join(tmpdir(), "aipe-rt-"));
  await mkdir(join(ws, ".aipe"), { recursive: true });
  await writeFile(
    join(ws, ".aipe", "brain.yaml"),
    "context:\n  name: demo\n  coordinator: Heisenberg\nrepos:\n  - name: aipe\n    url: git@x\n    path: ./aipe\n",
    "utf8",
  );
  const worktree = join(ws, "aipe", ".worktrees", "j1-jesse");
  await mkdir(worktree, { recursive: true });
  return { ws, repo: "aipe", worktree };
}

test("a real workspace (has .aipe/brain.yaml) is used as-is", async () => {
  const { ws } = await workspaceWithWorktree();
  const t = await classifyRecordTarget(ws);
  expect(t.ok).toBe(true);
  if (t.ok) expect(t.workspace).toBe(ws);
});

test("a worktree under a workspace is retargeted to the real workspace above it", async () => {
  const { ws, worktree } = await workspaceWithWorktree();
  const t = await classifyRecordTarget(worktree);
  expect(t.ok).toBe(true);
  if (t.ok) {
    expect(t.workspace).toBe(ws);
    expect(t.note).toContain(ws);
    expect(t.note).toContain("worktree");
  }
});

test("a worktree with no workspace anywhere above it is refused, naming the correct invocation", async () => {
  // A .worktrees/ path with no brain.yaml in any ancestor.
  const orphan = await mkdtemp(join(tmpdir(), "aipe-rt-orphan-"));
  const worktree = join(orphan, ".worktrees", "j1-jesse");
  await mkdir(worktree, { recursive: true });
  const t = await classifyRecordTarget(worktree);
  expect(t.ok).toBe(false);
  if (!t.ok) {
    expect(t.message).toContain("worktree");
    expect(t.message).toContain("brain.yaml");
  }
});

test("a bare directory (no brain, not under .worktrees) is left untouched — legacy/first-run", async () => {
  const bare = await mkdtemp(join(tmpdir(), "aipe-rt-bare-"));
  const t = await classifyRecordTarget(bare);
  expect(t.ok).toBe(true);
  if (t.ok) expect(t.workspace).toBe(bare);
});

test("aipe journey record --workspace <worktree> retargets to the real ledger and writes NO phantom", async () => {
  const { ws, worktree } = await workspaceWithWorktree();
  const code = await journeyRun([
    "record",
    "--workspace", worktree,
    "--journey", "j1",
    "--repo", "aipe",
    "--specialist", "Jesse",
    "--branch", "aipe/j1/jesse",
    "--worktree", worktree,
    "--status", "dispatched",
  ]);
  expect(code).toBe(0);
  // The real workspace ledger got the write…
  const realLedger = await readdir(join(ws, ".aipe", "journeys"));
  expect(realLedger).toContain("j1.yaml");
  // …and NO phantom .aipe/ was created inside the worktree.
  await expect(readdir(join(worktree, ".aipe"))).rejects.toThrow();
});

test("findPhantomLedgers detects a ledger already sitting inside a worktree", async () => {
  const { ws, worktree } = await workspaceWithWorktree();
  const phantomDir = join(worktree, ".aipe", "journeys");
  await mkdir(phantomDir, { recursive: true });
  await writeFile(join(phantomDir, "j1.yaml"), "id: j1\ndispatches: []\n", "utf8");
  const phantoms = await findPhantomLedgers(ws);
  expect(phantoms).toHaveLength(1);
  expect(phantoms[0]!.path).toBe(join(phantomDir, "j1.yaml"));
  expect(phantoms[0]!.worktree).toBe(worktree);
});

test("findPhantomLedgers is empty for a clean workspace with no worktree ledgers", async () => {
  const { ws } = await workspaceWithWorktree();
  expect(await findPhantomLedgers(ws)).toEqual([]);
});
