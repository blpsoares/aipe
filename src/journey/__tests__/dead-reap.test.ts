// planDeadReap: the AUTOMATIC half of the reaper (#73). It plans ONLY the close
// that needs no forge and no human judgement — a session whose PROCESS agentop
// reports as `gone` (exited/closed). This is what an edge aipe already runs
// (`aipe status`) may collect on its own; the coordinator's `journey reap
// --close` still owns the merged-but-LIVE case. A live session — running,
// `waiting`, `NEEDS APPROVAL`, or `lost` — is never in this plan, which is the
// PE's hard constraint made structural. It takes no PrStateFetcher: it must not
// touch the network, because it runs on the status hot path.
import { expect, test } from "bun:test";
import { planDeadReap } from "../reap";
import type { JourneyDispatch, JourneyLedger } from "../types";
import type { RosterEntry } from "../../session/poll";

const sess = (over: Partial<JourneyDispatch>): JourneyDispatch => ({
  repo: "aipe", specialist: "Jesse", branch: "b", worktree: "/ws/aipe/.worktrees/j1-jesse",
  status: "dispatched", mode: "session", ...over,
});
const ledgerOf = (...dispatches: JourneyDispatch[]): JourneyLedger => ({ id: "j1", dispatches });
const entry = (id: string, cwd: string, liveness: RosterEntry["liveness"] = "alive"): RosterEntry => ({ id, liveness, cwd, task: "aipe/j1", label: id });

test("a session whose PROCESS has EXITED is planned would-close — collected automatically", () => {
  const ledger = ledgerOf(sess({ status: "dispatched", sessionId: "s1", worktree: "/ws/aipe/wt1" }));
  const items = planDeadReap(ledger, "/ws", [entry("s1", "/ws/aipe/wt1", "gone")], true);
  expect(items).toHaveLength(1);
  expect(items[0]!.disposition).toBe("would-close");
  expect(items[0]!.sessionId).toBe("s1");
});

test("a LIVE session (waiting / NEEDS APPROVAL / running all report `alive`) is NEVER planned — the PE's hard constraint", () => {
  // agentop keeps `status: running` for an idle session waiting on a person, so
  // its Liveness is `alive`. It must survive the automatic trigger untouched.
  const ledger = ledgerOf(sess({ status: "dispatched", sessionId: "s-waiting", worktree: "/ws/aipe/wt1" }));
  const items = planDeadReap(ledger, "/ws", [entry("s-waiting", "/ws/aipe/wt1", "alive")], true);
  expect(items).toEqual([]);
});

test("a `lost` session is NOT collected — ambiguous, may still hold work", () => {
  const ledger = ledgerOf(sess({ status: "dispatched", sessionId: "s1", worktree: "/ws/aipe/wt1" }));
  const items = planDeadReap(ledger, "/ws", [entry("s1", "/ws/aipe/wt1", "lost")], true);
  expect(items).toEqual([]);
});

test("an exited session with a STALE recorded id is reconciled by worktree and collected", () => {
  const ledger = ledgerOf(sess({ status: "delivered", sessionId: "s-OLD", worktree: "/ws/aipe/wt1" }));
  const items = planDeadReap(ledger, "/ws", [entry("s-NEW", "/ws/aipe/wt1", "gone")], true);
  expect(items).toHaveLength(1);
  expect(items[0]!.sessionId).toBe("s-NEW");
  expect(items[0]!.reconciled).toBe(true);
});

test("a dead row whose worktree now hosts a LIVE session (a fix loop reusing it) is NOT collected — never kill live work", () => {
  // The dead round has no recorded id; only the live fix session sits at the
  // worktree. findDeadProcess resolves to the live one → not `gone` → left alone.
  const ledger = ledgerOf(sess({ status: "delivered", worktree: "/ws/aipe/jesse" }));
  const items = planDeadReap(ledger, "/ws", [entry("s-FIX", "/ws/aipe/jesse", "alive")], true);
  expect(items).toEqual([]);
});

test("an unreadable roster collects NOTHING — cannot establish death, so never a guessed close", () => {
  const ledger = ledgerOf(sess({ status: "dispatched", sessionId: "s1", worktree: "/ws/aipe/wt1" }));
  const items = planDeadReap(ledger, "/ws", [], false);
  expect(items).toEqual([]);
});

test("no forge is consulted — a not-landed unit (no PR) whose session is dead is still collected", () => {
  const ledger = ledgerOf(sess({ status: "dispatched", sessionId: "s1", worktree: "/ws/aipe/wt1" }));
  const items = planDeadReap(ledger, "/ws", [entry("s1", "/ws/aipe/wt1", "gone")], true);
  expect(items[0]!.disposition).toBe("would-close");
});

test("subagent-mode units are ignored entirely", () => {
  const ledger = ledgerOf({ repo: "aipe", specialist: "Jesse", branch: "b", worktree: "/w", status: "delivered", mode: "subagent" });
  const items = planDeadReap(ledger, "/ws", [], true);
  expect(items).toEqual([]);
});
