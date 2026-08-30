// recordDispatch matches the specialist CASE-INSENSITIVELY, so a case-only
// difference (`mike` after `Mike`) updates the one record instead of forking a
// duplicate — the jane/Jane split refused at write time, not cleaned up after.
import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readLedger, recordDispatch, recordDispatchGuarded } from "../ledger";
import type { JourneyDispatch } from "../types";

async function ws(): Promise<string> {
  return mkdtemp(join(tmpdir(), "aipe-record-case-"));
}

const d = (over: Partial<JourneyDispatch>): JourneyDispatch => ({
  repo: "aipe",
  specialist: "Mike",
  branch: "aipe/j1/mike",
  worktree: "/wt",
  status: "dispatched",
  ...over,
});

test("recording `mike` after `Mike` on the same unit UPDATES — one record, first spelling kept canonical", async () => {
  const dir = await ws();
  try {
    await recordDispatch(dir, "j1", d({ specialist: "Mike", task: "gate", status: "dispatched" }));
    await recordDispatch(dir, "j1", d({ specialist: "mike", task: "gate", status: "delivered", pr: "http://pr/1", evidence: { by: "dev", commands: ["bun test"], summary: "green" } }));

    const ledger = await readLedger(dir, "j1");
    expect(ledger?.dispatches).toHaveLength(1); // updated, not duplicated
    const rec = ledger!.dispatches[0]!;
    expect(rec.specialist).toBe("Mike"); // FIRST record's case is canonical
    expect(rec.status).toBe("delivered"); // the update landed
    expect(rec.pr).toBe("http://pr/1");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("two DIFFERENT specialists on the same unit are still two records (case-insensitive ≠ collapse-everything)", async () => {
  const dir = await ws();
  try {
    await recordDispatch(dir, "j1", d({ specialist: "Mike", task: "t" }));
    await recordDispatch(dir, "j1", d({ specialist: "Jesse", task: "t" }));

    const ledger = await readLedger(dir, "j1");
    expect(ledger?.dispatches).toHaveLength(2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a merged unit stays immutable — `mike` cannot rewrite a `Mike` merged record through the guard", async () => {
  const dir = await ws();
  try {
    // Mike's unit is merged (immutable).
    await recordDispatch(dir, "j1", d({ specialist: "Mike", task: "t", status: "merged", pr: "http://pr/9", evidence: { by: "qa", commands: ["ci"], summary: "green" } }));

    // A later `mike` write to the same task is refused by the immutability gate,
    // and the existing record is untouched (case-insensitive match reaches it).
    const res = await recordDispatchGuarded(dir, "j1", d({ specialist: "mike", task: "t", status: "dispatched" }), { reason: "redo" });
    expect(res.ok).toBe(false);
    expect(res.code).toBe("unit-immutable");

    const ledger = await readLedger(dir, "j1");
    expect(ledger?.dispatches).toHaveLength(1);
    expect(ledger!.dispatches[0]!.specialist).toBe("Mike");
    expect(ledger!.dispatches[0]!.status).toBe("merged");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
