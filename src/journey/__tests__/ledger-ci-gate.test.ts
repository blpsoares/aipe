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

// D2 (j-20260830-w0) — the honest escape hatch for "checks were verified green
// before this PR merged and gh can no longer resolve them", distinct from
// --ci-none (which asserts "no CI is configured" — false whenever CI exists).
test("--ci-verified-pre-merge accepts an unresolvable verdict WITH a reason, and stamps a distinct ciBypass", async () => {
  const dir = await ws();
  const r = await recordDispatchGuarded(
    dir, "j1", { ...base },
    { resolveChecks: resolver("unknown"), ciVerifiedPreMerge: true, reason: "saw 2/2 green on the PR before it merged; branch is now deleted" },
  );
  expect(r.ok).toBe(true);
  const d = (await readLedger(dir, "j1"))?.dispatches[0];
  expect(d?.ciBypass).toBe("verified-pre-merge");
});

test("--ci-verified-pre-merge without --reason is REJECTED — the claim needs an audit trail", async () => {
  const dir = await ws();
  const r = await recordDispatchGuarded(dir, "j1", { ...base }, { resolveChecks: resolver("unknown"), ciVerifiedPreMerge: true });
  expect(r.ok).toBe(false);
  expect(r.code).toBe("ci-verified-pre-merge-needs-reason");
});

test("--ci-verified-pre-merge NEVER masks a red or pending verdict — it only upgrades a genuinely unresolvable one", async () => {
  const dir = await ws();
  const red = await recordDispatchGuarded(dir, "j1", { ...base }, { resolveChecks: resolver("red"), ciVerifiedPreMerge: true, reason: "x" });
  expect(red.code).toBe("ci-red");
  const pending = await recordDispatchGuarded(dir, "j1", { ...base }, { resolveChecks: resolver("pending"), ciVerifiedPreMerge: true, reason: "x" });
  expect(pending.code).toBe("ci-pending");
});

test("an unresolvable verdict's REJECT message names what was attempted and what came back, not four generic guesses", async () => {
  const dir = await ws();
  const r = await recordDispatchGuarded(
    dir, "j1", { ...base },
    { resolveChecks: async () => ({ verdict: "unknown" as CheckVerdict, detail: "gh pr checks 257 --repo acme/widgets → exit 1: no branch found for pull request" }) },
  );
  expect(r.ok).toBe(false);
  expect(r.message).toContain("gh pr checks 257 --repo acme/widgets");
  expect(r.message).toContain("no branch found for pull request");
  expect(r.message).not.toContain("gh missing, unauthenticated, offline, or an unqueryable host");
});

test("verified is gated too, not only delivered", async () => {
  const dir = await ws();
  // A QA verdict judges a DELIVERY; seed the one it examines so the CI gate —
  // the subject of this test — is the rule that actually answers.
  await recordDispatchGuarded(dir, "j1", { ...base, status: "delivered", evidence: { by: "dev", commands: ["bun test"], summary: "green" } });
  const r = await recordDispatchGuarded(
    dir,
    "j1",
    // the QA's OWN row — a verification signed by the builder is refused before
    // the CI gate is ever consulted, which would hide the rule under test
    { ...base, specialist: "Mike", status: "verified", evidence: { by: "qa", commands: ["bun test"], summary: "qa passed" } },
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
