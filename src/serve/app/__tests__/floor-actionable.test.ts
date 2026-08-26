import { expect, test } from "bun:test";
import {
  buildDecisionInbox,
  decisionAction,
  decisionSection,
  producerOf,
  derivePhase,
  type DecisionItem,
} from "../runtime/floor";
import { coordinatorView } from "../runtime/coordinator";
import type { Dispatch } from "../runtime/store";

const WS = "/home/pe/aipe-blpsoares";

function d(over: Partial<Dispatch> = {}): Dispatch {
  return { repo: "aipe", specialist: "Jesse", branch: "aipe/j-1/jesse", worktree: "/ws/aipe/.worktrees/j-1-jesse", status: "dispatched", journey: "j-1", ...over } as Dispatch;
}
function item(over: Partial<DecisionItem> = {}): DecisionItem {
  return { kind: "escalation", section: "decision", severity: "warning", unit: "aipe", specialist: "Jesse", journey: "j-1", detail: "escalated — waiting on the PE", rank: 0, ...over } as DecisionItem;
}

// ── the split: decisions vs observations ─────────────────────────────────────
test("decisionSection routes only PE-resolvable kinds to 'decision'; the rest are observations", () => {
  expect(decisionSection("escalation")).toBe("decision");
  expect(decisionSection("gated")).toBe("decision");
  expect(decisionSection("dead-silent")).toBe("decision");
  for (const k of ["no-evidence", "failed-open", "dependency-not-landed", "qa-gap", "redirected", "blocked"] as const) {
    expect(decisionSection(k)).toBe("observation");
  }
});

// ── the four answers + the exact command ─────────────────────────────────────
test("decisionAction answers what/why/do/actor and emits a REAL, workspace-scoped command", () => {
  const esc = decisionAction(item({ kind: "escalation" }), d({ status: "escalated" }), WS);
  expect(esc.section).toBe("decision");
  expect(esc.whatKey).toBe("fa_what_escalation");
  expect(esc.whyKey).toBe("fa_why_escalation");
  expect(esc.todoKey).toBe("fa_todo_escalation");
  expect(esc.actorKey).toBe("fa_actor_you");
  // a real subcommand, scoped to this workspace and journey — copyable as-is
  expect(esc.command).toBe(`aipe journey show --workspace ${WS} --journey j-1`);
  expect(esc.vars.who).toBe("Jesse");
  expect(esc.vars.journey).toBe("j-1");
});

test("decisionAction for a gated envelope shows NO command (honest) with an authorize note", () => {
  const g = decisionAction(item({ kind: "gated" }), d(), WS);
  expect(g.command).toBeNull();
  expect(g.commandNoteKey).toBe("fa_cmd_none_auth");
  expect(g.actorKey).toBe("fa_actor_you");
});

test("decisionAction for dead-silent inspects the branch read-only via its worktree", () => {
  const wt = "/ws/aipe/.worktrees/j-1-jesse";
  const ds = decisionAction(item({ kind: "dead-silent", section: "decision" }), d({ worktree: wt }), WS);
  expect(ds.command).toBe(`git -C ${wt} log --oneline -20`);
});

test("decisionAction for dependency-not-landed names the producer and runs verify", () => {
  const it = item({ kind: "dependency-not-landed", section: "observation", severity: "critical", detail: "shipped against agentistics/tui, which never landed (verified/merged)" });
  const dep = decisionAction(it, d(), WS);
  expect(dep.vars.producer).toBe("agentistics/tui");
  expect(dep.command).toBe(`aipe journey verify --workspace ${WS} --journey j-1`);
  expect(dep.actorKey).toBe("fa_actor_coord");
});

test("decisionAction surfaces WHERE — branch, worktree, journey and PR — from the dispatch", () => {
  const withPr = decisionAction(item({ kind: "failed-open", section: "observation" }), d({ status: "failed", pr: "https://github.com/x/y/pull/1" }), WS);
  expect(withPr.where.branch).toBe("aipe/j-1/jesse");
  expect(withPr.where.worktree).toBe("/ws/aipe/.worktrees/j-1-jesse");
  expect(withPr.where.journey).toBe("j-1");
  expect(withPr.where.pr).toBe("https://github.com/x/y/pull/1");
});

test("a command omits --workspace only when the console never learned the dir (never a wrong path)", () => {
  const noWs = decisionAction(item({ kind: "escalation" }), d({ status: "escalated" }), "");
  expect(noWs.command).toBe("aipe journey show --journey j-1");
});

test("producerOf extracts the in-context producer from a dependency-not-landed detail", () => {
  expect(producerOf("shipped against agentistics/server, which never landed (verified/merged)")).toBe("agentistics/server");
  expect(producerOf("no producer mentioned")).toBeNull();
});

// ── blocked renders as blocked (defect D7), never as "building it" ────────────
test("a blocked unit derives the blocked phase, not a booting/dispatched one", () => {
  expect(derivePhase(d({ status: "blocked" }))).toBe("blocked");
});

test("coordinatorView shows a blocked unit as owed-an-answer, never as 'building it'", () => {
  const j = { id: "j-1", dispatches: [d({ status: "blocked", specialist: "Skyler", blockedReason: "needs PR #240 first" } as Partial<Dispatch>)] } as any;
  const v = coordinatorView(j, 0);
  expect(v.waiting.some((w) => w.whatKey === "co_wait_dev")).toBe(false);
  expect(v.next.some((n) => n.actionKey === "co_next_unblock")).toBe(true);
});

test("buildDecisionInbox surfaces a blocked ledger status as an observation, deduped", () => {
  const journeys = [{ id: "j-1", dispatches: [d({ status: "blocked", specialist: "Skyler", blockedReason: "waiting on server contract" } as Partial<Dispatch>)] }] as any;
  const inbox = buildDecisionInbox({ attention: [], journeys, sessions: [], now: 0 });
  const b = inbox.find((i) => i.kind === "blocked");
  expect(b).toBeTruthy();
  expect(b!.section).toBe("observation");
});

// ── resolved means gone: the same pure engine, one SSE frame later ───────────
test("redirected shows a read-only inspection command (never the merge-detecting reconcile)", () => {
  const r = decisionAction(item({ kind: "redirected", section: "observation" }), d({ status: "redirected" }), WS);
  expect(r.command).toBe(`aipe journey show --workspace ${WS} --journey j-1`);
  expect(r.command).not.toContain("reconcile");
});

test("an item disappears when its underlying condition clears (SSE-driven, no manual dismiss)", () => {
  const before = buildDecisionInbox({
    attention: [],
    journeys: [{ id: "j-1", dispatches: [d({ status: "redirected", redirectReason: "changed" } as Partial<Dispatch>)] }] as any,
    sessions: [],
    now: 0,
  });
  expect(before.some((i) => i.kind === "redirected")).toBe(true);

  // next frame: the coordinator reconciled and the unit moved on — the item is gone.
  const after = buildDecisionInbox({
    attention: [],
    journeys: [{ id: "j-1", dispatches: [d({ status: "merged" })] }] as any,
    sessions: [],
    now: 0,
  });
  expect(after.some((i) => i.kind === "redirected")).toBe(false);
});

// ── the header count and the inbox count are the SAME set ────────────────────
test("decisions (the 'need you' count) exclude observations, so header and inbox agree", () => {
  const journeys = [{
    id: "j-1",
    authorizations: [],
    dispatches: [
      d({ status: "escalated", specialist: "Mike" }),
      d({ status: "blocked", specialist: "Skyler" } as Partial<Dispatch>),
    ],
  }] as any;
  const attention = [{ kind: "escalated-open", severity: "warning", unit: "aipe", specialist: "Mike", journey: "j-1", detail: "waiting on the PE" }] as any;
  const inbox = buildDecisionInbox({ attention, journeys, sessions: [], now: 0 });
  const decisions = inbox.filter((i) => i.section === "decision");
  const observations = inbox.filter((i) => i.section === "observation");
  expect(decisions.map((i) => i.kind)).toContain("escalation");
  expect(observations.map((i) => i.kind)).toContain("blocked");
  // the "need you" count is decisions only — a blocked unit does not inflate it
  expect(decisions.length).toBe(1);
});
