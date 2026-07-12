import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readLedger, recordDispatch, startJourney } from "../ledger";
import { reconcileAll, reconcileJourney } from "../reconcile";
import type { PrState } from "../reconcile";

async function ws(): Promise<string> {
  return mkdtemp(join(tmpdir(), "aipe-rec-"));
}

test("reconcile marks a delivered dispatch merged when gh reports MERGED", async () => {
  const dir = await ws();
  try {
    await startJourney(dir, "j1");
    await recordDispatch(dir, "j1", { repo: "embark", specialist: "A", branch: "b", worktree: "w", pr: "http://pr/1", status: "delivered" });
    await recordDispatch(dir, "j1", { repo: "prontuario", specialist: "B", branch: "b", worktree: "w", pr: "http://pr/2", status: "delivered" });

    const fake = async (url: string): Promise<PrState> => (url === "http://pr/1" ? "MERGED" : "OPEN");
    const res = await reconcileJourney(dir, "j1", fake);

    expect(res.checked).toBe(2);
    expect(res.merged).toEqual(["http://pr/1"]);
    const ledger = await readLedger(dir, "j1");
    expect(ledger?.dispatches.find((d) => d.pr === "http://pr/1")?.status).toBe("merged");
    expect(ledger?.dispatches.find((d) => d.pr === "http://pr/2")?.status).toBe("delivered");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("reconcile marks a VERIFIED dispatch merged too (QA-passed unit whose PR merges)", async () => {
  const dir = await ws();
  try {
    await startJourney(dir, "j1");
    await recordDispatch(dir, "j1", { repo: "embark", specialist: "A", branch: "b", worktree: "w", pr: "http://pr/9", status: "verified", evidence: { by: "qa", commands: ["bun test"], summary: "ok" } });
    const fake = async (): Promise<PrState> => "MERGED";
    const res = await reconcileJourney(dir, "j1", fake);
    expect(res.merged).toEqual(["http://pr/9"]);
    expect((await readLedger(dir, "j1"))?.dispatches[0]?.status).toBe("merged");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("reconcile ignores non-delivered dispatches and PR-less ones", async () => {
  const dir = await ws();
  try {
    await startJourney(dir, "j1");
    await recordDispatch(dir, "j1", { repo: "a", specialist: "A", branch: "b", worktree: "w", status: "dispatched" });
    await recordDispatch(dir, "j1", { repo: "b", specialist: "B", branch: "b", worktree: "w", status: "delivered" }); // no pr
    await recordDispatch(dir, "j1", { repo: "c", specialist: "C", branch: "b", worktree: "w", pr: "http://pr/3", status: "merged" });

    let calls = 0;
    const fake = async (): Promise<PrState> => {
      calls++;
      return "MERGED";
    };
    const res = await reconcileJourney(dir, "j1", fake);
    expect(calls).toBe(0);
    expect(res.checked).toBe(0);
    expect(res.merged).toEqual([]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("null gh state leaves the dispatch untouched", async () => {
  const dir = await ws();
  try {
    await startJourney(dir, "j1");
    await recordDispatch(dir, "j1", { repo: "a", specialist: "A", branch: "b", worktree: "w", pr: "http://pr/1", status: "delivered" });
    const res = await reconcileJourney(dir, "j1", async () => null);
    expect(res.merged).toEqual([]);
    expect((await readLedger(dir, "j1"))?.dispatches[0]?.status).toBe("delivered");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("reconcileAll walks every journey", async () => {
  const dir = await ws();
  try {
    await startJourney(dir, "j1");
    await recordDispatch(dir, "j1", { repo: "a", specialist: "A", branch: "b", worktree: "w", pr: "http://pr/1", status: "delivered" });
    await startJourney(dir, "j2");
    await recordDispatch(dir, "j2", { repo: "b", specialist: "B", branch: "b", worktree: "w", pr: "http://pr/2", status: "delivered" });

    const results = await reconcileAll(dir, async () => "MERGED");
    expect(results).toHaveLength(2);
    expect(results.flatMap((r) => r.merged).sort()).toEqual(["http://pr/1", "http://pr/2"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("reconcile on a missing journey is a no-op", async () => {
  const dir = await ws();
  try {
    const res = await reconcileJourney(dir, "nope", async () => "MERGED");
    expect(res).toEqual({ journey: "nope", checked: 0, merged: [] });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
