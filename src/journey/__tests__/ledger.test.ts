import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "yaml";
import { grantedTiers, readLedger, recordAuthorization, recordDispatch, startJourney } from "../ledger";

test("startJourney writes an empty ledger and is idempotent", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-jr-"));
  try {
    await startJourney(dir, "j1");
    const raw = await readFile(join(dir, ".aipe", "journeys", "j1.yaml"), "utf8");
    expect(parse(raw)).toEqual({ id: "j1", dispatches: [], authorizations: [] });

    await recordDispatch(dir, "j1", { repo: "embark", specialist: "Joaquim", branch: "aipe/j1/joaquim", worktree: "/w", status: "dispatched" });
    await startJourney(dir, "j1"); // must not clobber existing dispatches
    const ledger = await readLedger(dir, "j1");
    expect(ledger?.dispatches).toHaveLength(1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("recordDispatch upserts by (repo, specialist), preserving others", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-jr-"));
  try {
    await recordDispatch(dir, "j1", { repo: "embark", specialist: "Joaquim", branch: "aipe/j1/joaquim", worktree: "/w1", status: "dispatched" });
    await recordDispatch(dir, "j1", { repo: "prontuario", specialist: "Pedro", branch: "aipe/j1/pedro", worktree: "/w2", status: "dispatched" });
    // update Joaquim's status + add a PR
    await recordDispatch(dir, "j1", { repo: "embark", specialist: "Joaquim", branch: "aipe/j1/joaquim", worktree: "/w1", pr: "http://pr/1", status: "delivered" });

    const ledger = await readLedger(dir, "j1");
    expect(ledger?.dispatches).toHaveLength(2);
    const joaquim = ledger?.dispatches.find((d) => d.specialist === "Joaquim");
    expect(joaquim?.status).toBe("delivered");
    expect(joaquim?.pr).toBe("http://pr/1");
    expect(ledger?.dispatches.find((d) => d.specialist === "Pedro")?.status).toBe("dispatched");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("readLedger returns null for an unknown journey", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-jr-"));
  try {
    expect(await readLedger(dir, "nope")).toBeNull();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("recordAuthorization is idempotent per tier; grantedTiers reflects it", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-jr-"));
  try {
    await recordAuthorization(dir, "j1", { tier: "frontier", grantedBy: "PE" });
    await recordAuthorization(dir, "j1", { tier: "frontier", grantedBy: "PE" }); // no dup
    const ledger = await readLedger(dir, "j1");
    expect(ledger?.authorizations).toEqual([{ tier: "frontier", grantedBy: "PE" }]);
    expect(grantedTiers(ledger).has("frontier")).toBe(true);
    expect(grantedTiers(null).size).toBe(0);
    // records preserve dispatches added afterwards
    await recordDispatch(dir, "j1", { repo: "r", specialist: "s", branch: "b", worktree: "w", status: "dispatched", tier: "reasoning", model: "claude-opus-4-8" });
    const after = await readLedger(dir, "j1");
    expect(after?.authorizations).toHaveLength(1);
    expect(after?.dispatches[0]?.model).toBe("claude-opus-4-8");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
