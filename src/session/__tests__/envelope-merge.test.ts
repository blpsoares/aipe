// CRITICAL: a specialist that follows its own prompt to the letter must not
// erase its own session envelope from the ledger. `composePrompt` (../prompt)
// tells a session-mode specialist to record `delivered`/`escalated`/
// `redirected` with ONLY --repo/--specialist/--branch/--worktree/--status
// (plus --pr/--evidence-* or --reason) — never --mode/--intensity/--harness/
// --session-id, because the specialist has no reliable way to know its own
// agentop session id. Before this fix, `recordDispatch` upserted by full
// REPLACE, so that ordinary, prompt-instructed call wiped the whole envelope
// the coordinator recorded when it dispatched the unit — and `aipe session
// collect` would then report "no session-mode units to collect" (the unit
// silently vanished from the wave), exactly as reproduced against the real
// CLI. This file pins the fix: record dispatched-with-envelope, then record
// exactly the commands the prompt instructs (delivered, and separately
// redirected), and assert the envelope survives AND `collect` reports the
// unit correctly.
import { expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run as journeyRun } from "../../journey/cli";
import { readLedger, startJourney } from "../../journey/ledger";
import { collectCommand } from "../cli";
import type { AgentopRunner } from "../types";

async function dispatchedWithEnvelope(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "aipe-envelope-"));
  await startJourney(dir, "j1");
  const code = await journeyRun([
    "record",
    "--workspace", dir,
    "--journey", "j1",
    "--repo", "embark",
    "--specialist", "Joaquim",
    "--branch", "aipe/j1/joaquim",
    "--worktree", "w",
    "--mode", "session",
    "--intensity", "ultracode",
    "--harness", "claude-code",
    "--session-id", "s-1",
    "--status", "dispatched",
  ]);
  expect(code).toBe(0);
  return dir;
}

test("BEFORE: the dispatched envelope is present on the ledger", async () => {
  const dir = await dispatchedWithEnvelope();
  const before = (await readLedger(dir, "j1"))!.dispatches[0]!;
  expect(before.status).toBe("dispatched");
  expect(before.mode).toBe("session");
  expect(before.intensity).toBe("ultracode");
  expect(before.harness).toBe("claude-code");
  expect(before.sessionId).toBe("s-1");
});

test("delivering exactly as the prompt instructs (no --mode/--session-id) preserves the whole envelope, and collect reports LANDED", async () => {
  const dir = await dispatchedWithEnvelope();

  // Exactly the flags `composePrompt`'s "successful delivery" block tells the
  // specialist to run — no --mode, --intensity, --harness, --session-id.
  const code = await journeyRun([
    "record",
    "--workspace", dir,
    "--journey", "j1",
    "--repo", "embark",
    "--specialist", "Joaquim",
    "--branch", "aipe/j1/joaquim",
    "--worktree", "w",
    "--status", "delivered",
    "--pr", "http://pr/1",
    "--evidence-cmd", "bun test",
    "--evidence-summary", "42 pass, 0 fail",
  ]);
  expect(code).toBe(0);

  const after = (await readLedger(dir, "j1"))!.dispatches[0]!;
  expect(after.status).toBe("delivered");
  expect(after.pr).toBe("http://pr/1");
  expect(after.evidence?.summary).toBe("42 pass, 0 fail");
  // The envelope every field, exactly — not merely "still truthy".
  expect(after.mode).toBe("session");
  expect(after.intensity).toBe("ultracode");
  expect(after.harness).toBe("claude-code");
  expect(after.sessionId).toBe("s-1");

  const runner: AgentopRunner = async () => ({ code: 0, stdout: JSON.stringify({ sessions: [] }), stderr: "" });
  const r = await collectCommand({ workspace: dir, journeyId: "j1", runner, timeoutMs: 1000, intervalMs: 10, sleep: async () => {} });
  expect(r.code).toBe(0);
  expect(r.lines).toEqual(["LANDED embark"]);
});

test("redirecting exactly as the prompt instructs (no --mode/--session-id) preserves the whole envelope, and collect reports REDIRECTED with the right session id", async () => {
  const dir = await dispatchedWithEnvelope();

  // Exactly the flags `composePrompt`'s "redirected" block tells the
  // specialist to run.
  const code = await journeyRun([
    "record",
    "--workspace", dir,
    "--journey", "j1",
    "--repo", "embark",
    "--specialist", "Joaquim",
    "--branch", "aipe/j1/joaquim",
    "--worktree", "w",
    "--status", "redirected",
    "--reason", "use Stripe instead of the in-house gateway",
  ]);
  expect(code).toBe(0);

  const after = (await readLedger(dir, "j1"))!.dispatches[0]!;
  expect(after.status).toBe("redirected");
  expect(after.redirectReason).toBe("use Stripe instead of the in-house gateway");
  expect(after.mode).toBe("session");
  expect(after.intensity).toBe("ultracode");
  expect(after.harness).toBe("claude-code");
  expect(after.sessionId).toBe("s-1");

  const runner: AgentopRunner = async () => ({ code: 0, stdout: JSON.stringify({ sessions: [{ id: "s-1" }] }), stderr: "" });
  const r = await collectCommand({ workspace: dir, journeyId: "j1", runner, timeoutMs: 1000, intervalMs: 10, sleep: async () => {} });
  expect(r.code).toBe(2);
  expect(r.lines).toEqual([
    'REDIRECTED embark session s-1 reason="use Stripe instead of the in-house gateway" — the PE changed this unit\'s direction live. Fold the change into the Orientation Spec (bump its version) or escalate. A redirected unit MUST NOT pass the QA gate against an unreconciled spec',
  ]);
});

// The reopening (genuine re-dispatch) case: sessionId must NOT survive, or
// `aipe session dispatch`'s pending filter (`mode === "session" && status ===
// "dispatched" && !sessionId`) would never pick this unit up for a new
// session — the whole point of a redispatch is a NEW session. `pr`/`evidence`
// from the superseded delivery must not survive either. `mode`/`intensity`/
// `harness` (dispatch POLICY, not run-instance state) DO survive — the
// redispatch should still honor the same harness/intensity the PE approved.
test("a genuine re-dispatch (delivered → dispatched, with --reason) clears the stale sessionId/pr/evidence but keeps mode/intensity/harness", async () => {
  const dir = await dispatchedWithEnvelope();
  await journeyRun([
    "record", "--workspace", dir, "--journey", "j1",
    "--repo", "embark", "--specialist", "Joaquim", "--branch", "aipe/j1/joaquim", "--worktree", "w",
    "--status", "delivered", "--pr", "http://pr/1",
    "--evidence-cmd", "bun test", "--evidence-summary", "42 pass, 0 fail",
  ]);

  const code = await journeyRun([
    "record", "--workspace", dir, "--journey", "j1",
    "--repo", "embark", "--specialist", "Joaquim", "--branch", "aipe/j1/joaquim", "--worktree", "w",
    "--status", "dispatched", "--reason", "QA found a regression in totals",
  ]);
  expect(code).toBe(0);

  const after = (await readLedger(dir, "j1"))!.dispatches[0]!;
  expect(after.status).toBe("dispatched");
  expect(after.redispatchReason).toBe("QA found a regression in totals");
  expect(after.sessionId).toBeUndefined();
  expect(after.pr).toBeUndefined();
  expect(after.evidence).toBeUndefined();
  expect(after.mode).toBe("session");
  expect(after.intensity).toBe("ultracode");
  expect(after.harness).toBe("claude-code");
});
