// planReap: the fact-based reaper's plan. It does NOT trust that the coordinator
// recorded the close correctly (item 2) — it establishes each session's landing
// by verifiable fact (the unit has a PR and the forge reports it MERGED), finds
// the live session (reconciling a stale id by worktree, item 3), and NEVER
// touches a blocked/dispatched/redirected session. It only ever plans; the
// caller lists before closing.
import { expect, test } from "bun:test";
import { executeReap, planReap, type ReapItem } from "../reap";
import type { JourneyDispatch, JourneyLedger } from "../types";
import type { RosterEntry } from "../../session/poll";
import type { PrState } from "../reconcile";
import type { AgentopRunner } from "../../session/types";

const sess = (over: Partial<JourneyDispatch>): JourneyDispatch => ({
  repo: "aipe", specialist: "Jesse", branch: "b", worktree: "/ws/aipe/.worktrees/j1-jesse",
  status: "dispatched", mode: "session", ...over,
});
const ledgerOf = (...dispatches: JourneyDispatch[]): JourneyLedger => ({ id: "j1", dispatches });
const entry = (id: string, cwd: string, liveness: RosterEntry["liveness"] = "alive"): RosterEntry => ({ id, liveness, cwd, task: "aipe/j1", label: id });

// A forge that reports MERGED for the given PR urls, OPEN otherwise.
const mergedFor = (...urls: string[]) => async (pr: string): Promise<PrState> => (urls.includes(pr) ? "MERGED" : "OPEN");

test("a session whose unit has a MERGED PR and a live session is planned would-close", async () => {
  const ledger = ledgerOf(sess({ status: "merged", pr: "http://pr/1", sessionId: "s1", worktree: "/ws/aipe/wt1" }));
  const items = await planReap(ledger, "/ws", [entry("s1", "/ws/aipe/wt1")], true, mergedFor("http://pr/1"));
  expect(items).toHaveLength(1);
  expect(items[0]!.disposition).toBe("would-close");
  expect(items[0]!.sessionId).toBe("s1");
});

test("a blocked session is PROTECTED even when its PR is merged — reaped on no path", async () => {
  const ledger = ledgerOf(sess({ status: "blocked", pr: "http://pr/1", sessionId: "s1", worktree: "/ws/aipe/wt1", blockedReason: "x" }));
  const items = await planReap(ledger, "/ws", [entry("s1", "/ws/aipe/wt1")], true, mergedFor("http://pr/1"));
  expect(items[0]!.disposition).toBe("protected");
});

test("a dispatched and a redirected session are PROTECTED", async () => {
  const ledger = ledgerOf(
    sess({ task: "a", status: "dispatched", pr: "http://pr/1", sessionId: "s1", worktree: "/ws/aipe/a" }),
    sess({ task: "b", status: "redirected", pr: "http://pr/2", sessionId: "s2", worktree: "/ws/aipe/b", redirectReason: "y" }),
  );
  const items = await planReap(ledger, "/ws", [entry("s1", "/ws/aipe/a"), entry("s2", "/ws/aipe/b")], true, mergedFor("http://pr/1", "http://pr/2"));
  expect(items.map((i) => i.disposition)).toEqual(["protected", "protected"]);
});

test("a unit with NO PR, or a PR that is not merged, is not-landed (work has not landed)", async () => {
  const ledger = ledgerOf(
    sess({ task: "a", status: "verified", sessionId: "s1", worktree: "/ws/aipe/a" }), // no pr
    sess({ task: "b", status: "delivered", pr: "http://pr/2", sessionId: "s2", worktree: "/ws/aipe/b" }), // open
  );
  const items = await planReap(ledger, "/ws", [entry("s1", "/ws/aipe/a"), entry("s2", "/ws/aipe/b")], true, mergedFor("http://pr/nope"));
  expect(items.map((i) => i.disposition)).toEqual(["not-landed", "not-landed"]);
});

test("a MERGED unit with a STALE sessionId is reconciled by worktree and planned would-close", async () => {
  // The exact real case: the ledger's recorded id no longer matches any live
  // session, but the real one is at the worktree.
  const ledger = ledgerOf(sess({ status: "merged", pr: "http://pr/1", sessionId: "s-OLD", worktree: "/ws/aipe/wt1" }));
  const items = await planReap(ledger, "/ws", [entry("s-NEW", "/ws/aipe/wt1")], true, mergedFor("http://pr/1"));
  expect(items[0]!.disposition).toBe("would-close");
  expect(items[0]!.sessionId).toBe("s-NEW");
  expect(items[0]!.reconciled).toBe(true);
});

test("a MERGED unit whose session cannot be established (stale id, nothing at the worktree) is unresolvable — never a guess", async () => {
  const ledger = ledgerOf(sess({ status: "merged", pr: "http://pr/1", sessionId: "s-gone", worktree: "/ws/aipe/wt1" }));
  const items = await planReap(ledger, "/ws", [entry("someone", "/ws/other")], true, mergedFor("http://pr/1"));
  expect(items[0]!.disposition).toBe("unresolvable");
});

test("when the live roster is unreliable, a merged unit is unresolvable, not guessed closed", async () => {
  const ledger = ledgerOf(sess({ status: "merged", pr: "http://pr/1", sessionId: "s1", worktree: "/ws/aipe/wt1" }));
  const items = await planReap(ledger, "/ws", [], false, mergedFor("http://pr/1"));
  expect(items[0]!.disposition).toBe("unresolvable");
});

// ── the dangerous case the PE named: a merged PR from an earlier round + the
// dev working AGAIN on the same unit. The fix round reuses the worktree, so the
// merged row reconciles by worktree to the fix's live session. Reaping it would
// kill the fix. The keep-alive row protects that live session — by worktree even
// before its own sessionId is recorded.

test("a merged unit being WORKED AGAIN (fix loop reusing the worktree) is NOT reaped — the live fix session is protected", async () => {
  const ledger = ledgerOf(
    sess({ task: "r1", status: "merged", pr: "http://pr/1", sessionId: "s-DEAD", worktree: "/ws/aipe/jesse" }),
    sess({ task: "r2-fix", status: "dispatched", sessionId: "s-FIX", worktree: "/ws/aipe/jesse" }), // same worktree, live
  );
  // Only the fix session is live; the merged round's session is gone.
  const items = await planReap(ledger, "/ws", [entry("s-FIX", "/ws/aipe/jesse")], true, mergedFor("http://pr/1"));
  const r1 = items.find((i) => i.reason.includes("merged"))!;
  // The merged row reconciled by worktree to s-FIX, but s-FIX is active work → protected, NOT would-close.
  expect(items.every((i) => i.disposition !== "would-close")).toBe(true);
  expect(r1.disposition).toBe("protected");
  expect(items.find((i) => i.recordedId === "s-FIX")!.disposition).toBe("protected");
});

test("the fix round is protected even BEFORE its sessionId is recorded (protected by worktree)", async () => {
  const ledger = ledgerOf(
    sess({ task: "r1", status: "merged", pr: "http://pr/1", sessionId: "s-DEAD", worktree: "/ws/aipe/jesse" }),
    sess({ task: "r2-fix", status: "dispatched", worktree: "/ws/aipe/jesse" }), // dispatched, NO sessionId yet
  );
  const items = await planReap(ledger, "/ws", [entry("s-FIX", "/ws/aipe/jesse")], true, mergedFor("http://pr/1"));
  // s-FIX is at the fix row's worktree → active work → the merged row must not reap it.
  expect(items.every((i) => i.disposition !== "would-close")).toBe(true);
});

// ── item 3, round 2: collect by PROCESS STATE, not just merged PR. A session
// that died BEFORE landing any work is invisible to a reaper that only trusts
// "PR merged" — this is the j-20260830-c5 real case (not-landed=4, no PR ever
// opened, the specialist's process was already dead). `exited` in agentop's own
// roster (Liveness "gone") is an observable fact of death that stands on its
// own, independent of the ledger's status or the PR.

test("a not-landed unit (no PR) whose recorded session has EXITED is planned would-close — the process is provably dead", async () => {
  const ledger = ledgerOf(sess({ status: "delivered", sessionId: "s1", worktree: "/ws/aipe/wt1" })); // no pr at all
  const items = await planReap(ledger, "/ws", [entry("s1", "/ws/aipe/wt1", "gone")], true, mergedFor());
  expect(items[0]!.disposition).toBe("would-close");
  expect(items[0]!.sessionId).toBe("s1");
});

test("a DISPATCHED (keep-alive) unit whose session has EXITED is reaped too — dead trumps 'still working'", async () => {
  const ledger = ledgerOf(sess({ status: "dispatched", sessionId: "s1", worktree: "/ws/aipe/wt1" }));
  const items = await planReap(ledger, "/ws", [entry("s1", "/ws/aipe/wt1", "gone")], true, mergedFor());
  expect(items[0]!.disposition).toBe("would-close");
});

test("a BLOCKED unit whose session is still ALIVE stays protected — waiting/needs-approval is never a reap target", async () => {
  const ledger = ledgerOf(sess({ status: "blocked", sessionId: "s1", worktree: "/ws/aipe/wt1", blockedReason: "x" }));
  const items = await planReap(ledger, "/ws", [entry("s1", "/ws/aipe/wt1", "alive")], true, mergedFor());
  expect(items[0]!.disposition).toBe("protected");
});

test("a session agentop marks LOST is NOT reaped by the dead-process path — ambiguous, may still hold work", async () => {
  const ledger = ledgerOf(sess({ status: "dispatched", sessionId: "s1", worktree: "/ws/aipe/wt1" }));
  const items = await planReap(ledger, "/ws", [entry("s1", "/ws/aipe/wt1", "lost")], true, mergedFor());
  expect(items[0]!.disposition).toBe("protected"); // falls through to the ordinary keep-alive rule
});

test("a MERGED unit whose session has EXITED is still would-close, worded by the dead-process fact", async () => {
  const ledger = ledgerOf(sess({ status: "merged", pr: "http://pr/1", sessionId: "s1", worktree: "/ws/aipe/wt1" }));
  const items = await planReap(ledger, "/ws", [entry("s1", "/ws/aipe/wt1", "gone")], true, mergedFor("http://pr/1"));
  expect(items[0]!.disposition).toBe("would-close");
  expect(items[0]!.reason).toContain("exited");
});

test("subagent-mode units are ignored entirely", async () => {
  const ledger = ledgerOf({ repo: "aipe", specialist: "Jesse", branch: "b", worktree: "/w", status: "merged", pr: "http://pr/1", mode: "subagent" });
  const items = await planReap(ledger, "/ws", [], true, mergedFor("http://pr/1"));
  expect(items).toEqual([]);
});

// ── executeReap: only would-close is acted on, and the kill is judged honestly ──

const item = (over: Partial<ReapItem>): ReapItem => ({
  unit: "aipe", specialist: "Jesse", disposition: "would-close", sessionId: "s1", recordedId: "s1", reconciled: false, reason: "r", ...over,
});

test("executeReap kills only would-close items; protected/unresolvable are never touched", async () => {
  const kills: string[] = [];
  const runner: AgentopRunner = async (a) => { if (a[1] === "kill") kills.push(a[2]!); return { code: 0, stdout: "", stderr: "" }; };
  await executeReap(
    [item({ sessionId: "s1" }), item({ disposition: "protected", sessionId: "s2" }), item({ disposition: "unresolvable", sessionId: "s3" })],
    runner,
  );
  expect(kills).toEqual(["s1"]);
});

test("executeReap does NOT claim closed when the kill exits non-zero", async () => {
  const runner: AgentopRunner = async () => ({ code: 1, stdout: "", stderr: "boom" });
  const lines = await executeReap([item({ sessionId: "s1" })], runner);
  expect(lines[0]!.closed).toBe(false);
  expect(lines[0]!.line).toContain("could not be confirmed");
  expect(lines[0]!.line).not.toContain("CLOSED");
});

test("executeReap survives an agentop that throws — a non-fatal could-not-confirm NOTE", async () => {
  const runner: AgentopRunner = async () => { throw new Error("agentop gone"); };
  const lines = await executeReap([item({ sessionId: "s1" })], runner);
  expect(lines[0]!.closed).toBe(false);
  expect(lines[0]!.line).toContain("could not be confirmed");
});
