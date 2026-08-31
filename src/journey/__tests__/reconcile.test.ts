import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readLedger, recordDispatch, startJourney, writeLedger } from "../ledger";
import { reconcileAll, reconcileJourney } from "../reconcile";
import type { PrState } from "../reconcile";
import type { PersonaRegistryEntry } from "../../hire-specialists/types";

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

// ── #97: mesclar fecha a UNIDADE, não só a linha do dev ──────────────────────
// The dirty shape the real ledger accumulates (j-20260830-r1 / -8b): a merged dev
// row, a QA `verified` sharing the same PR, a stale `redirected` sibling on the QA
// branch, and a case-variant re-gate row (`mike` after `Mike`). Detecting the
// merge must close the whole unit — the phantoms collapse (cleanup BEFORE the
// merge, so it never hits the merged-immutability wall) and every surviving row
// lands `merged`. Nothing is left `verified`/`delivered`/`redirected` to keep
// lying in the "precisa de você" queue.
const dirtyRoster: PersonaRegistryEntry[] = [
  { name: "Jesse", role: "dev-fullstack", repo: "aipe", path: null },
  { name: "Mike", role: "qa", repo: "aipe", path: null },
];

test("a merged PR closes the whole unit — QA verified + stale redirect + case dup all collapse to merged", async () => {
  const dir = await ws();
  try {
    await startJourney(dir, "j1");
    // Written raw (not through recordDispatch) so the case-variant `mike`/`Mike`
    // duplicate exists on disk exactly as the real ledger carries it.
    await writeLedger(dir, {
      id: "j1",
      dispatches: [
        { repo: "aipe", task: "work", specialist: "Jesse", branch: "aipe/j1/jesse", worktree: "/w", pr: "http://pr/100", status: "merged" },
        { repo: "aipe", task: "gate", specialist: "Mike", branch: "aipe/j1/mike", worktree: "/w", pr: "http://pr/100", status: "verified", evidence: { by: "qa", commands: ["bun test"], summary: "ok" } },
        { repo: "aipe", task: "gate", specialist: "Mike", branch: "aipe/j1/mike", worktree: "/w", status: "redirected", redirectReason: "stale — PR already merged" },
        { repo: "aipe", task: "gate-r2", specialist: "mike", branch: "aipe/j1/mike", worktree: "/w", pr: "http://pr/100", status: "verified", evidence: { by: "qa", commands: ["bun test"], summary: "re-gate" } },
      ],
    });

    const res = await reconcileJourney(dir, "j1", async () => "MERGED", dirtyRoster);

    const ledger = await readLedger(dir, "j1");
    const statuses = ledger!.dispatches.map((d) => d.status).sort();
    // Every surviving row landed merged; no phantom left open to lie in the queue.
    expect(statuses.every((s) => s === "merged")).toBe(true);
    expect(ledger!.dispatches.some((d) => d.status === "redirected")).toBe(false);
    expect(ledger!.dispatches.some((d) => d.status === "verified")).toBe(false);
    // The case-variant `mike` collapsed — no lowercase phantom survives.
    expect(ledger!.dispatches.some((d) => d.specialist === "mike")).toBe(false);
    expect(res.merged).toContain("http://pr/100");
    expect(res.collapsed).toBeGreaterThan(0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("reconcile leaves a genuinely-open redirect alone (no merged sibling to collapse into)", async () => {
  const dir = await ws();
  try {
    await startJourney(dir, "j1");
    await writeLedger(dir, {
      id: "j1",
      dispatches: [
        { repo: "aipe", task: "work", specialist: "Jesse", branch: "aipe/j1/jesse", worktree: "/w", status: "redirected", redirectReason: "live scope change, nothing landed" },
      ],
    });
    const res = await reconcileJourney(dir, "j1", async () => "MERGED", dirtyRoster);
    const ledger = await readLedger(dir, "j1");
    // No merge happened and the redirect is the unit's most-advanced state — it
    // must survive so the coordinator still sees it in the queue.
    expect(ledger!.dispatches).toHaveLength(1);
    expect(ledger!.dispatches[0]!.status).toBe("redirected");
    expect(res.merged).toEqual([]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("reconcile on a missing journey is a no-op", async () => {
  const dir = await ws();
  try {
    const res = await reconcileJourney(dir, "nope", async () => "MERGED");
    expect(res).toEqual({ journey: "nope", checked: 0, merged: [], collapsed: 0 });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
