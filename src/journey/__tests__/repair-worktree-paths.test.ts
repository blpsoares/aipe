import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse, stringify } from "yaml";
import { recordDispatchGuarded, repairWorktreePaths } from "../ledger";
import type { JourneyDispatch } from "../types";

async function workspace(dispatches: unknown[]): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "aipe-rwp-"));
  await mkdir(join(dir, ".aipe", "journeys"), { recursive: true });
  await writeFile(join(dir, ".aipe", "journeys", "j-1.yaml"), stringify({ id: "j-1", dispatches, authorizations: [] }), "utf8");
  return dir;
}

async function dispatchesOf(dir: string): Promise<Record<string, { worktree: string; status: string }>> {
  const parsed = parse(await readFile(join(dir, ".aipe", "journeys", "j-1.yaml"), "utf8")) as {
    dispatches: { specialist: string; worktree: string; status: string }[];
  };
  return Object.fromEntries(parsed.dispatches.map((d) => [d.specialist, { worktree: d.worktree, status: d.status }]));
}

const OLD = "/ws/embark";
const NEW = "/ws/repos/embark";

test("repairs the worktree path of a live dispatch, leaves a merged one intact", async () => {
  const dir = await workspace([
    { repo: "embark", specialist: "Live", branch: "b1", worktree: `${OLD}/.worktrees/live`, status: "delivered", evidence: { by: "dev", commands: ["x"], summary: "y" } },
    { repo: "embark", specialist: "Merged", branch: "b2", worktree: `${OLD}/.worktrees/merged`, status: "merged" },
  ]);
  try {
    const rewrites = await repairWorktreePaths(dir, [{ from: OLD, to: NEW }]);
    expect(rewrites).toEqual([{ journey: "j-1", specialist: "Live", from: `${OLD}/.worktrees/live`, to: `${NEW}/.worktrees/live` }]);

    const after = await dispatchesOf(dir);
    expect(after.Live?.worktree).toBe(`${NEW}/.worktrees/live`);
    // The merged unit is immutable — its (now-stale) path is left exactly as it was.
    expect(after.Merged?.worktree).toBe(`${OLD}/.worktrees/merged`);
    expect(after.Merged?.status).toBe("merged");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a path outside every move prefix is left untouched", async () => {
  const dir = await workspace([
    { repo: "other", specialist: "Elsewhere", branch: "b", worktree: "/ws/other/.worktrees/x", status: "dispatched" },
  ]);
  try {
    const rewrites = await repairWorktreePaths(dir, [{ from: OLD, to: NEW }]);
    expect(rewrites).toEqual([]);
    expect((await dispatchesOf(dir)).Elsewhere?.worktree).toBe("/ws/other/.worktrees/x");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// [N]: nothing here weakens the merged-unit immutability guard — re-recording a
// merged unit is still refused. Path repair (above) writes the ledger directly
// for a mechanical, non-status field; the status lifecycle guard is untouched.
test("merged-unit immutability still holds — the guard refuses a re-record", async () => {
  const dir = await workspace([
    { repo: "embark", specialist: "Merged", branch: "b2", worktree: `${OLD}/.worktrees/merged`, status: "merged" },
  ]);
  try {
    await repairWorktreePaths(dir, [{ from: OLD, to: NEW }]); // path repair runs…
    const redispatch: JourneyDispatch = { repo: "embark", specialist: "Merged", branch: "b2", worktree: `${NEW}/.worktrees/merged`, status: "dispatched" };
    const result = await recordDispatchGuarded(dir, "j-1", redispatch, { reason: "try to reopen" });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("guard should have refused");
    expect(result.code).toBe("unit-immutable");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
