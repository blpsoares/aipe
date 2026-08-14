import { expect, test } from "bun:test";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "yaml";
import { buildBatchArgs } from "../batch";
import { classify } from "../poll";
import { composePrompt } from "../prompt";
import { collectCommand } from "../cli";
import { recordDispatch, recordDispatchGuarded, readLedger, startJourney } from "../../journey/ledger";
import { run as journeyRun } from "../../journey/cli";
import type { JourneyLedger } from "../../journey/types";
import type { AgentopRunner } from "../types";

test("each session is named <repo>/<persona> so the cockpit is legible", () => {
  const args = buildBatchArgs("aipe/j1", [
    { harness: "claude", cwd: "/w/wt", promptFile: "/p.md", name: "embark/joaquim" },
  ]);
  expect(args).toContain("--name");
  expect(args).toContain("embark/joaquim");
});

test("a redirected unit is its own phase, never mistaken for progress", () => {
  const ledger: JourneyLedger = {
    id: "j1",
    dispatches: [
      { repo: "embark", specialist: "J", branch: "b", worktree: "w", status: "redirected", mode: "session", sessionId: "s-1" },
    ],
  };
  expect(classify(ledger, new Set(["s-1"]))[0]!.phase).toBe("redirected");
});

test("a redirected unit stays redirected even after its session ends", () => {
  const ledger: JourneyLedger = {
    id: "j1",
    dispatches: [
      { repo: "embark", specialist: "J", branch: "b", worktree: "w", status: "redirected", mode: "session", sessionId: "s-1" },
    ],
  };
  expect(classify(ledger, new Set())[0]!.phase).toBe("redirected");
});

test("the prompt carries the redirect MUST, with the exact command", () => {
  const p = composePrompt({
    personaBody: "You are Joaquim.", specSlice: "Fix it.", worktree: "/w/wt",
    packagePath: null, branch: "b", journeyId: "j1", workspace: "/w",
    fqid: "embark", intensity: "normal", repo: "embark",
  });
  expect(p).toContain("--status redirected");
  expect(p).toContain("before acting on it");
  // All three blocks (delivered, escalated, redirected) must interpolate --repo embark exactly once each
  expect((p.match(/--repo embark/g) || []).length).toBe(3);
});

// ── collectCommand: redirected must never yield a clean exit ──────────────
// This is the load-bearing guarantee `redirected` exists for: a wave with a
// redirected unit is a wave whose approved spec no longer describes what is
// being built, and `collect`'s exit code is what a coordinator branches on to
// decide whether a wave is safe to report as done. If a redirected unit ever
// produced exit 0, that divergence would be invisible to the coordinator.
async function ledgerWithRedirect(redirectReason?: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "aipe-sess-redirect-"));
  await startJourney(dir, "j1");
  await recordDispatch(dir, "j1", {
    repo: "embark", specialist: "Joaquim", branch: "b", worktree: "w",
    status: "redirected", mode: "session", sessionId: "s-1",
    ...(redirectReason !== undefined ? { redirectReason } : {}),
  });
  return dir;
}

test("a redirected unit exits 2, never 0, and is reported by its own REDIRECTED line carrying the reason", async () => {
  const dir = await ledgerWithRedirect("use Stripe instead of the in-house gateway");
  const live: AgentopRunner = async () => ({ code: 0, stdout: JSON.stringify({ sessions: [{ id: "s-1" }] }), stderr: "" });
  const r = await collectCommand({ workspace: dir, journeyId: "j1", runner: live, timeoutMs: 1000, intervalMs: 10, sleep: async () => {} });
  expect(r.code).toBe(2);
  expect(r.code).not.toBe(0);
  expect(r.lines).toEqual([
    'REDIRECTED embark session s-1 reason="use Stripe instead of the in-house gateway" — the PE changed this unit\'s direction live. Fold the change into the Orientation Spec (bump its version) or escalate. A redirected unit MUST NOT pass the QA gate against an unreconciled spec',
  ]);
});

test("a redirected unit with an already-ended session still exits 2 with the same REDIRECTED line", async () => {
  const dir = await ledgerWithRedirect("use Stripe instead of the in-house gateway");
  const gone: AgentopRunner = async () => ({ code: 0, stdout: JSON.stringify({ sessions: [] }), stderr: "" });
  const r = await collectCommand({ workspace: dir, journeyId: "j1", runner: gone, timeoutMs: 1000, intervalMs: 10, sleep: async () => {} });
  expect(r.code).toBe(2);
  expect(r.lines).toEqual([
    'REDIRECTED embark session s-1 reason="use Stripe instead of the in-house gateway" — the PE changed this unit\'s direction live. Fold the change into the Orientation Spec (bump its version) or escalate. A redirected unit MUST NOT pass the QA gate against an unreconciled spec',
  ]);
});

test("a legacy redirected record with no persisted reason still reads cleanly and prints reason=null, not a throw", async () => {
  const dir = await ledgerWithRedirect(); // no redirectReason — pre-fix ledger shape
  const live: AgentopRunner = async () => ({ code: 0, stdout: JSON.stringify({ sessions: [{ id: "s-1" }] }), stderr: "" });
  const r = await collectCommand({ workspace: dir, journeyId: "j1", runner: live, timeoutMs: 1000, intervalMs: 10, sleep: async () => {} });
  expect(r.code).toBe(2);
  expect(r.lines).toEqual([
    "REDIRECTED embark session s-1 reason=null — the PE changed this unit's direction live. Fold the change into the Orientation Spec (bump its version) or escalate. A redirected unit MUST NOT pass the QA gate against an unreconciled spec",
  ]);
});

// ── the actual gap from Task 15: --reason must survive the full round trip ─

test("recordDispatchGuarded rejects a redirected record with no --reason", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-sess-redirect-gate-"));
  await startJourney(dir, "j1");
  const r = await recordDispatchGuarded(dir, "j1", {
    repo: "embark", specialist: "Joaquim", branch: "b", worktree: "w", status: "redirected",
  });
  expect(r.ok).toBe(false);
  expect(r.code).toBe("redirect-needs-reason");
  expect((await readLedger(dir, "j1"))!.dispatches).toHaveLength(0);
});

test("recordDispatchGuarded rejects a redirected record whose --reason is blank/whitespace-only", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-sess-redirect-gate-"));
  await startJourney(dir, "j1");
  const r = await recordDispatchGuarded(
    dir, "j1",
    { repo: "embark", specialist: "Joaquim", branch: "b", worktree: "w", status: "redirected" },
    { reason: "   " },
  );
  expect(r.ok).toBe(false);
  expect(r.code).toBe("redirect-needs-reason");
});

test("an awkward multi-word reason with an apostrophe survives record → ledger re-read → collect intact", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-sess-redirect-roundtrip-"));
  const awkwardReason = "the PE said: don't touch billing, use the client's sandbox key instead";

  // 1. record it through the real CLI entrypoint, exactly as the specialist's
  //    prompt instructs (`--status redirected --reason "..."`).
  const recordCode = await journeyRun([
    "record",
    "--workspace", dir,
    "--journey", "j1",
    "--repo", "embark",
    "--specialist", "Joaquim",
    "--branch", "b",
    "--worktree", "w",
    "--mode", "session",
    "--session-id", "s-1",
    "--status", "redirected",
    "--reason", awkwardReason,
  ]);
  expect(recordCode).toBe(0);

  // 2. re-read the ledger from disk (through YAML, not the in-memory object)
  //    and assert the reason survived intact, verbatim.
  const ledger = await readLedger(dir, "j1");
  expect(ledger!.dispatches[0]!.redirectReason).toBe(awkwardReason);
  const raw = parse(await readFile(join(dir, ".aipe", "journeys", "j1.yaml"), "utf8"));
  expect(raw.dispatches[0].redirectReason).toBe(awkwardReason);

  // 3. `collect` must print it back, so the coordinator sees it without
  //    opening the ledger file.
  const live: AgentopRunner = async () => ({ code: 0, stdout: JSON.stringify({ sessions: [{ id: "s-1" }] }), stderr: "" });
  const r = await collectCommand({ workspace: dir, journeyId: "j1", runner: live, timeoutMs: 1000, intervalMs: 10, sleep: async () => {} });
  expect(r.code).toBe(2);
  expect(r.lines).toEqual([
    `REDIRECTED embark session s-1 reason=${JSON.stringify(awkwardReason)} — the PE changed this unit's direction live. Fold the change into the Orientation Spec (bump its version) or escalate. A redirected unit MUST NOT pass the QA gate against an unreconciled spec`,
  ]);
});

test("a redirected unit with a live session settles immediately instead of waiting out the timeout", async () => {
  // If `redirected` were mistaken for ordinary progress, the loop would keep
  // polling until the deadline (see poll.ts's ordering comment). It must not:
  // a redirected unit is "settled" (not running) the moment it is observed.
  const dir = await ledgerWithRedirect();
  let pollCalls = 0;
  const live: AgentopRunner = async () => {
    pollCalls += 1;
    return { code: 0, stdout: JSON.stringify({ sessions: [{ id: "s-1" }] }), stderr: "" };
  };
  const r = await collectCommand({
    workspace: dir, journeyId: "j1", runner: live,
    timeoutMs: 10_000, intervalMs: 10,
    sleep: async () => { throw new Error("must not sleep — the wave should settle on the first poll"); },
  });
  expect(r.code).toBe(2);
  expect(pollCalls).toBe(1);
});
