// The CI gate on recordDispatchGuarded: a delivered/verified record that carries
// a --pr must resolve GREEN checks, else the ledger physically refuses the write.
// The resolver is injected (mirrors reconcile's ghPrState) so this is offline.
import { expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readLedger, recordDispatchGuarded, startJourney } from "../ledger";
import type { CheckVerdict } from "../checks";
import type { JourneyDispatch } from "../types";

async function ws(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "aipe-ci-gate-"));
  await startJourney(dir, "j1");
  return dir;
}

const evidence = { by: "dev" as const, commands: ["bun test"], summary: "all green" };
const base: JourneyDispatch = {
  repo: "aipe",
  specialist: "Jesse",
  branch: "aipe/j1/jesse",
  worktree: "/wt",
  status: "delivered",
  pr: "https://github.com/blpsoares/aipe/pull/99",
  evidence,
};
const resolver = (v: CheckVerdict) => async () => v;

test("green checks pass the gate and record", async () => {
  const dir = await ws();
  const r = await recordDispatchGuarded(dir, "j1", { ...base }, { resolveChecks: resolver("green") });
  expect(r.ok).toBe(true);
  const ledger = await readLedger(dir, "j1");
  expect(ledger?.dispatches[0]?.status).toBe("delivered");
});

test("red checks are REJECTED with ci-red — a failing workflow is not a delivery", async () => {
  const dir = await ws();
  const r = await recordDispatchGuarded(dir, "j1", { ...base }, { resolveChecks: resolver("red") });
  expect(r.ok).toBe(false);
  expect(r.code).toBe("ci-red");
  // nothing was written
  expect((await readLedger(dir, "j1"))?.dispatches.length ?? 0).toBe(0);
});

test("pending checks are REJECTED as ci-pending — 'still running' is not 'passed' and not 'failed'", async () => {
  const dir = await ws();
  const r = await recordDispatchGuarded(dir, "j1", { ...base }, { resolveChecks: resolver("pending") });
  expect(r.ok).toBe(false);
  expect(r.code).toBe("ci-pending");
});

test("no checks configured is REJECTED as ci-none without the explicit flag", async () => {
  const dir = await ws();
  const r = await recordDispatchGuarded(dir, "j1", { ...base }, { resolveChecks: resolver("none") });
  expect(r.ok).toBe(false);
  expect(r.code).toBe("ci-none");
});

test("no checks + --ci-none accepts AND stamps ciBypass on the ledger (recorded, not silent)", async () => {
  const dir = await ws();
  const r = await recordDispatchGuarded(dir, "j1", { ...base }, { resolveChecks: resolver("none"), ciNone: true });
  expect(r.ok).toBe(true);
  const d = (await readLedger(dir, "j1"))?.dispatches[0];
  expect(d?.ciBypass).toBe("no-checks");
});

test("--ci-none NEVER masks red — the flag only upgrades a resolved 'none'", async () => {
  const dir = await ws();
  const r = await recordDispatchGuarded(dir, "j1", { ...base }, { resolveChecks: resolver("red"), ciNone: true });
  expect(r.ok).toBe(false);
  expect(r.code).toBe("ci-red");
});

test("--ci-none does not mask pending either", async () => {
  const dir = await ws();
  const r = await recordDispatchGuarded(dir, "j1", { ...base }, { resolveChecks: resolver("pending"), ciNone: true });
  expect(r.ok).toBe(false);
  expect(r.code).toBe("ci-pending");
});

test("unresolvable checks (gh absent/offline/unqueryable) are REJECTED, never guessed green", async () => {
  const dir = await ws();
  const r = await recordDispatchGuarded(dir, "j1", { ...base }, { resolveChecks: resolver("unknown") });
  expect(r.ok).toBe(false);
  expect(r.code).toBe("ci-unresolvable");
});

test("--ci-none cannot substitute for an unresolvable verdict either", async () => {
  const dir = await ws();
  const r = await recordDispatchGuarded(dir, "j1", { ...base }, { resolveChecks: resolver("unknown"), ciNone: true });
  expect(r.ok).toBe(false);
  expect(r.code).toBe("ci-unresolvable");
});

test("verified is gated too, not only delivered", async () => {
  const dir = await ws();
  const r = await recordDispatchGuarded(
    dir,
    "j1",
    { ...base, status: "verified", evidence: { by: "qa", commands: ["bun test"], summary: "qa passed" } },
    { resolveChecks: resolver("red") },
  );
  expect(r.ok).toBe(false);
  expect(r.code).toBe("ci-red");
});

test("a delivered record with NO --pr is not CI-gated (nothing to resolve)", async () => {
  const dir = await ws();
  const { pr, ...noPr } = base;
  const r = await recordDispatchGuarded(dir, "j1", noPr, { resolveChecks: resolver("red") });
  expect(r.ok).toBe(true);
});

test("a dispatched record is never CI-gated even with a --pr", async () => {
  const dir = await ws();
  const r = await recordDispatchGuarded(dir, "j1", { ...base, status: "dispatched", evidence: undefined }, { resolveChecks: resolver("red") });
  expect(r.ok).toBe(true);
});

test("with NO resolver injected the CI gate is inert (other-gate tests keep passing, never a silent fabricated pass)", async () => {
  const dir = await ws();
  const r = await recordDispatchGuarded(dir, "j1", { ...base });
  expect(r.ok).toBe(true);
});

test("the evidence gate still runs before CI — no evidence is rejected without ever touching the resolver", async () => {
  const dir = await ws();
  let called = false;
  const spy = async () => {
    called = true;
    return "green" as CheckVerdict;
  };
  const r = await recordDispatchGuarded(dir, "j1", { ...base, evidence: undefined }, { resolveChecks: spy });
  expect(r.ok).toBe(false);
  expect(r.code).toBe("evidence-required");
  expect(called).toBe(false);
});
