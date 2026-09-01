// "You cannot tell a pass from a no-op" — the second-order cause of 2026-08-31,
// and the one that let the first-order ones survive in plain sight.
//
// `OK aipe Jesse delivered` was byte-identical whether the SDD gate had run and
// approved, or had never been on the path at all. Nothing in the output, the
// exit code, or the ledger distinguished "checked and passed" from "not
// checked". So six approved gates could green-light three broken features while
// reporting, truthfully, that nothing had failed — and the PE had no way to see
// that the thing he was approving had not been examined.
//
// The fix is that every accepted write says what each gate DID, and the
// production path REFUSES to record a done-claim whose gates could not run.
import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { formatGates, recordDispatchGuarded, startJourney, type AcceptanceResolver } from "../ledger";
import { run } from "../cli";
import type { DispatchEvidence, JourneyDispatch } from "../types";

async function ws(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "aipe-gate-report-"));
  await startJourney(dir, "j1");
  return dir;
}

const DEV: JourneyDispatch = { repo: "aipe", specialist: "Jesse", branch: "b", worktree: "/wt", status: "dispatched" };
const devEv: DispatchEvidence = { by: "dev", commands: ["bun test"], summary: "42 pass" };
const qaEv: DispatchEvidence = { by: "qa", commands: ["drove it"], summary: "works" };

async function capture(fn: () => Promise<number>): Promise<{ code: number; output: string }> {
  const original = console.log;
  const lines: string[] = [];
  console.log = (...a: unknown[]) => void lines.push(a.join(" "));
  try {
    return { code: await fn(), output: lines.join("\n") };
  } finally {
    console.log = original;
  }
}

test("a gate that COULD NOT RUN reports not-checked — never silence, never a pass", async () => {
  const dir = await ws();
  try {
    // A delivered unit routed to the full SDD flow, with NO artifact resolver:
    // the gate applies and cannot run. This is the exact state that was
    // indistinguishable from success.
    const r = await recordDispatchGuarded(
      dir, "j1",
      { ...DEV, status: "delivered", sddKit: "spec-kit", evidence: devEv },
      {},
    );
    expect(r.ok).toBe(true); // the library stays injectable — it does not invent a verdict
    expect(r.gates?.sdd).toBe("not-checked");
    expect(formatGates(r.gates!)).toContain("sdd:—");
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("a gate that ran and applied reports ok; one that correctly did not apply reports n/a", async () => {
  const dir = await ws();
  try {
    const r = await recordDispatchGuarded(
      dir, "j1",
      { ...DEV, status: "delivered", sddKit: "spec-kit", evidence: devEv },
      { resolveSddArtifacts: async () => ({ spec: true, plan: true }) },
    );
    expect(r.gates?.sdd).toBe("ok");
    // no PR ⇒ nothing for the CI gate to resolve; that is an established
    // non-answer, not an unchecked one
    expect(r.gates?.ci).toBe("n/a");
    // not a `verified` write ⇒ the QA gate does not apply
    expect(r.gates?.qa).toBe("n/a");
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("a unit with no Task Spec reports qa:n/a — established, not merely unexamined", async () => {
  const dir = await ws();
  const none: AcceptanceResolver = async () => ({ kind: "none" });
  try {
    await recordDispatchGuarded(dir, "j1", { ...DEV, status: "delivered", evidence: devEv }, {});
    const r = await recordDispatchGuarded(
      dir, "j1",
      { ...DEV, specialist: "Mike", status: "verified", evidence: qaEv },
      { resolveAcceptance: none, reason: "QA gate" },
    );
    expect(r.ok).toBe(true);
    expect(r.gates?.qa).toBe("n/a");
  } finally { await rm(dir, { recursive: true, force: true }); }
});

// The invariant the fail-closed guard in `recordCommand` protects: on the
// PRODUCTION path every applicable gate actually runs. `not-checked` is
// unreachable there today because the CLI injects every resolver — and that is
// precisely what this test pins. Drop an injection, wire a new call site without
// them, and the SDD gate stops running: this test fails, and the guard turns
// that into a refusal instead of a cheerful `OK`.
test("the real CLI path leaves NO applicable gate unchecked — the SDD gate genuinely runs", async () => {
  const dir = await ws();
  try {
    // A delivered unit routed to the full flow, in a worktree with no committed
    // spec or plan. If the gate is wired, this is refused BY THE GATE. If the
    // resolver were missing, it would sail through as `OK … [sdd:—]`.
    const { code, output } = await capture(() =>
      run([
        "record", "--workspace", dir, "--journey", "j1",
        "--repo", "aipe", "--specialist", "Jesse", "--branch", "b", "--worktree", dir,
        "--status", "delivered", "--sdd", "spec-kit",
        "--evidence-cmd", "bun test", "--evidence-summary", "green",
      ]),
    );
    expect(code).toBe(1);
    // the gate spoke — not the fail-closed guard, and not silence
    expect(output).toContain("REJECT sdd-artifacts-required");
    expect(output).not.toContain("gate-unavailable");
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("an accepted record on the real CLI path prints what every gate did", async () => {
  const dir = await ws();
  try {
    const { code, output } = await capture(() =>
      run([
        "record", "--workspace", dir, "--journey", "j1",
        "--repo", "aipe", "--specialist", "Jesse", "--branch", "b", "--worktree", dir,
        "--status", "dispatched", "--size", "small",
      ]),
    );
    expect(code).toBe(0);
    // Every gate is accounted for by name. Before this, the line was
    // `OK aipe Jesse dispatched` and said nothing about what had been examined.
    expect(output).toContain("sdd:");
    expect(output).toContain("ci:");
    expect(output).toContain("qa:");
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("formatGates never renders not-checked as anything a reader could mistake for a verdict", () => {
  expect(formatGates({ sdd: "not-checked", ci: "not-checked", qa: "not-checked" })).toBe("[sdd:— ci:— qa:—]");
  expect(formatGates({ sdd: "ok", ci: "ok", qa: "n/a" }, "green")).toBe("[sdd:ok ci:green qa:n/a]");
});
