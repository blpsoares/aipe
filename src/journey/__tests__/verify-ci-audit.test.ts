// `aipe journey verify` must audit CI too: a delivered/verified unit whose PR
// checks are not green is a finding. This is what catches a LEGACY red-CI record
// (the PR #22 class) that predates the record gate — without turning a
// legitimate no-checks repo into a false critical.
import { expect, test } from "bun:test";
import { auditPrChecks } from "../verify";
import type { CheckVerdict } from "../checks";
import type { JourneyLedger } from "../types";

const ledgerOf = (dispatches: JourneyLedger["dispatches"]): JourneyLedger => ({ id: "j1", dispatches });
const resolver = (v: CheckVerdict) => async () => v;
const dev = { repo: "aipe", specialist: "Jesse", branch: "b", worktree: "w", pr: "http://pr/22" } as const;

test("a verified unit with RED CI is a critical finding (the PR #22 class)", async () => {
  const f = await auditPrChecks(ledgerOf([{ ...dev, status: "verified", evidence: { by: "qa", commands: ["x"], summary: "s" } }]), resolver("red"));
  expect(f).toHaveLength(1);
  expect(f[0]?.severity).toBe("critical");
  expect(f[0]?.code).toBe("ci-red");
  expect(f[0]?.unit).toBe("aipe");
});

test("a delivered unit with PENDING CI is a critical finding too — not-green is a finding", async () => {
  const f = await auditPrChecks(ledgerOf([{ ...dev, status: "delivered", evidence: { by: "dev", commands: ["x"], summary: "s" } }]), resolver("pending"));
  expect(f).toHaveLength(1);
  expect(f[0]?.code).toBe("ci-pending");
});

test("a green unit yields no CI finding", async () => {
  const f = await auditPrChecks(ledgerOf([{ ...dev, status: "verified", evidence: { by: "qa", commands: ["x"], summary: "s" } }]), resolver("green"));
  expect(f).toHaveLength(0);
});

test("a no-checks repo ABSTAINS — never a false critical (openvibes-embark today)", async () => {
  const f = await auditPrChecks(ledgerOf([{ ...dev, status: "delivered", evidence: { by: "dev", commands: ["x"], summary: "s" } }]), resolver("none"));
  expect(f).toHaveLength(0);
});

test("an unresolvable forge ABSTAINS loudly (no finding, never a guessed critical)", async () => {
  const f = await auditPrChecks(ledgerOf([{ ...dev, status: "verified", evidence: { by: "qa", commands: ["x"], summary: "s" } }]), resolver("unknown"));
  expect(f).toHaveLength(0);
});

test("a merged unit is terminal — reconcile's domain, not re-audited for CI", async () => {
  const f = await auditPrChecks(ledgerOf([{ ...dev, status: "merged" }]), resolver("red"));
  expect(f).toHaveLength(0);
});

test("a recorded ciBypass is respected — the no-checks path was taken deliberately", async () => {
  const f = await auditPrChecks(
    ledgerOf([{ ...dev, status: "verified", ciBypass: "no-checks", evidence: { by: "qa", commands: ["x"], summary: "s" } }]),
    resolver("red"),
  );
  expect(f).toHaveLength(0);
});

test("a delivered unit with NO --pr has nothing to resolve", async () => {
  const { pr, ...noPr } = dev;
  const f = await auditPrChecks(ledgerOf([{ ...noPr, status: "delivered", evidence: { by: "dev", commands: ["x"], summary: "s" } }]), resolver("red"));
  expect(f).toHaveLength(0);
});

test("a dispatched (in-flight) unit is not CI-audited", async () => {
  const f = await auditPrChecks(ledgerOf([{ ...dev, status: "dispatched" }]), resolver("red"));
  expect(f).toHaveLength(0);
});
