// The path that would have made the whole QA closure optional in practice.
//
// `aipe journey reconcile` learns from the FORGE that a PR merged, and writes
// `merged` straight to the ledger — it does not go through recordDispatchGuarded,
// so the merge-needs-qa gate never sees it. Left alone, that means the rule holds
// only on the path a human happens to type, and not on the one that actually
// runs. Rewriting the status to something friendlier is not the answer either:
// the PR really did merge, and a ledger that denies it lies about the world.
//
// So the merge is recorded as the fact it is, and the GAP is stamped — then
// `journey verify` fails on it as a critical.
import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readLedger, recordDispatch, startJourney } from "../ledger";
import { reconcileJourney } from "../reconcile";
import { verifyJourney } from "../verify";

async function ws(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "aipe-qa-gap-"));
  await startJourney(dir, "j1");
  return dir;
}

const merged = async () => "MERGED" as const;

test("a PR merged on the forge with NO QA pass is recorded merged AND stamped as a gap", async () => {
  const dir = await ws();
  try {
    await recordDispatch(dir, "j1", {
      repo: "aipe", specialist: "Jesse", branch: "b", worktree: "/wt",
      status: "delivered", pr: "http://pr/1", round: 1,
      evidence: { by: "dev", commands: ["bun test"], summary: "green" },
    });
    await reconcileJourney(dir, "j1", merged, []);

    const row = (await readLedger(dir, "j1"))!.dispatches[0]!;
    expect(row.status).toBe("merged"); // the forge is the authority: the fact stands
    expect(row.qaGap).toBe(true); // and the gap is on the record

    const findings = verifyJourney((await readLedger(dir, "j1"))!, []);
    const gap = findings.find((f) => f.code === "merged-without-qa");
    expect(gap?.severity).toBe("critical");
    expect(gap?.detail).toContain("without any QA verification");
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("a merge WITH a current-round QA pass is stamped with no gap", async () => {
  const dir = await ws();
  try {
    await recordDispatch(dir, "j1", {
      repo: "aipe", specialist: "Jesse", branch: "b", worktree: "/wt",
      status: "delivered", pr: "http://pr/1", round: 1,
      evidence: { by: "dev", commands: ["bun test"], summary: "green" },
    });
    await recordDispatch(dir, "j1", {
      repo: "aipe", specialist: "Mike", task: "gate", branch: "bq", worktree: "/wq",
      status: "verified", round: 1, verifiedRound: 1,
      evidence: { by: "qa", commands: ["drove it"], summary: "typing works" },
    });
    await reconcileJourney(dir, "j1", merged, []);

    const rows = (await readLedger(dir, "j1"))!.dispatches;
    expect(rows.every((d) => d.qaGap === undefined)).toBe(true);
    expect(verifyJourney((await readLedger(dir, "j1"))!, []).filter((f) => f.code === "merged-without-qa")).toHaveLength(0);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("a merge whose QA pass is from an EARLIER round is a gap — the re-test never happened", async () => {
  const dir = await ws();
  try {
    // round 1 passed, then the unit was reworked to round 2 and merged
    await recordDispatch(dir, "j1", {
      repo: "aipe", specialist: "Mike", task: "gate", branch: "bq", worktree: "/wq",
      status: "verified", round: 1, verifiedRound: 1,
      evidence: { by: "qa", commands: ["drove it"], summary: "ok" },
    });
    await recordDispatch(dir, "j1", {
      repo: "aipe", specialist: "Jesse", branch: "b", worktree: "/wt",
      status: "delivered", pr: "http://pr/2", round: 2,
      evidence: { by: "dev", commands: ["bun test"], summary: "fixed" },
    });
    await reconcileJourney(dir, "j1", merged, []);

    const findings = verifyJourney((await readLedger(dir, "j1"))!, []);
    const gap = findings.find((f) => f.code === "merged-without-qa");
    expect(gap?.severity).toBe("critical");
    expect(gap?.detail).toContain("round 2");
    expect(gap?.detail).toContain("round 1");
  } finally { await rm(dir, { recursive: true, force: true }); }
});
