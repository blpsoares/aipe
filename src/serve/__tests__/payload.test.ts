import { expect, test } from "bun:test";
import { hasSessionDispatch, relevantSessions, coordinatorSessionsOf, annotateLiveness, annotateIntegrated } from "../payload";
import type { SessionInfo } from "../sessions";
import type { JourneyView } from "../../dashboard/snapshot";

const journeys = [
  { id: "j", dispatches: [
    { repo: "aipe", specialist: "Jesse", branch: "b", worktree: "/ws/aipe/.worktrees/na-jesse", status: "dispatched", mode: "session" },
    { repo: "aipe", specialist: "Ana", branch: "b", worktree: "/ws/aipe/.worktrees/na-ana", status: "delivered" },
  ] },
] as unknown as JourneyView[];

test("hasSessionDispatch triggers only when a dispatch runs as a session", () => {
  expect(hasSessionDispatch(journeys)).toBe(true);
  expect(hasSessionDispatch([{ id: "j", dispatches: [{ repo: "a", specialist: "x", branch: "b", worktree: "w", status: "dispatched" }] }] as any)).toBe(false);
});

test("relevantSessions keeps only sessions whose cwd matches a dispatch worktree (running or exited)", () => {
  const sessions: SessionInfo[] = [
    { id: "mine", status: "running", activity: "working", cwd: "/ws/aipe/.worktrees/na-jesse" },
    { id: "dead", status: "exited", cwd: "/ws/aipe/.worktrees/na-ana" }, // matches Ana → keep (dead-silent signal)
    { id: "unrelated", status: "running", activity: "waiting", cwd: "/home/u/somewhere-else" },
  ];
  const kept = relevantSessions(sessions, journeys).map((s) => s.id).sort();
  expect(kept).toEqual(["dead", "mine"]);
});

test("coordinatorSessionsOf keeps only RUNNING sessions rooted at the workspace itself", () => {
  const sessions: SessionInfo[] = [
    { id: "coord", status: "running", cwd: "/ws" }, // at the workspace root → coordinator
    { id: "coord-dead", status: "exited", cwd: "/ws" }, // exited → not counted
    { id: "spec", status: "running", cwd: "/ws/aipe/.worktrees/na-jesse" }, // a specialist worktree
  ];
  const kept = coordinatorSessionsOf(sessions, "/ws").map((s) => s.id);
  expect(kept).toEqual(["coord"]);
});

// ── annotateLiveness — a liveness canônica por dispatch, consumindo o MESMO
// dispatchPhase do `aipe status` (sem re-derivação otimista) + o cross-check de
// worktree no disco (armadilhas 1 e 2 do quadro de 4 colunas, jornada s9). ──────

const sess = (over: Partial<Record<string, unknown>> = {}) =>
  ({ id: "j", dispatches: [{ repo: "aipe", specialist: "Jesse", branch: "b", worktree: "/wt", status: "dispatched", mode: "session", sessionId: "s1", ...over }] }) as unknown as JourneyView[][number];

const liveOf = (over: Partial<Record<string, unknown>>, live: Set<string>, reliable: boolean, exists: (p: string) => boolean) =>
  (annotateLiveness([sess(over)], live, reliable, exists)[0]!.dispatches[0] as { liveness?: string }).liveness;

test("annotateLiveness: sessão viva (sessionId no live-set confiável) → running", () => {
  expect(liveOf({}, new Set(["s1"]), true, () => true)).toBe("running");
});

test("armadilha 2: dispatched com worktree removido do disco NÃO é running → dead-silent", () => {
  // reliable, mas s1 não está vivo E o worktree sumiu → morto, nunca "trabalhando"
  expect(liveOf({ worktree: "/gone" }, new Set(), true, (p) => p !== "/gone")).toBe("dead-silent");
});

test("armadilha 2: agentop ilegível (unreliable) + worktree removido → dead-silent", () => {
  expect(liveOf({ worktree: "/gone" }, new Set(), false, () => false)).toBe("dead-silent");
});

test("liveness ilegível (unreliable) com worktree presente → unknown (nem trabalhando nem morto)", () => {
  expect(liveOf({}, new Set(), false, () => true)).toBe("unknown");
});

test("dispatch subagent (sem sessão) não recebe campo liveness", () => {
  expect(liveOf({ mode: "subagent" }, new Set(), true, () => true)).toBeUndefined();
});

test("estado terminal do ledger (verified→landed) permanece landed, ignora liveness/worktree", () => {
  expect(liveOf({ status: "verified" }, new Set(), false, () => false)).toBe("landed");
});

test("blocked→waiting e redirected→redirected vêm do ledger, não do live-set", () => {
  expect(liveOf({ status: "blocked" }, new Set(), false, () => false)).toBe("waiting");
  expect(liveOf({ status: "redirected" }, new Set(), false, () => false)).toBe("redirected");
});

// ── annotateIntegrated — a VERDADE do merge (defeito 2, j-20260829-dp): a tela lê
// se o branch já está em main (merge-base --is-ancestor origin/main), independente
// do status do ledger. Conservador: na dúvida, false, nunca um falso "integrado". ──
const jv = (over: Record<string, unknown>) =>
  [{ id: "j", dispatches: [{ repo: "aipe", specialist: "Jesse", branch: "b", worktree: "/ws/aipe/.worktrees/j-jesse", status: "verified", ...over }] }] as unknown as JourneyView[];

const intOf = (over: Record<string, unknown>, isAncestor: (r: string, b: string) => boolean) =>
  (annotateIntegrated(jv(over), isAncestor)[0]!.dispatches[0] as { integrated?: boolean }).integrated;

test("merged é integrado sem tocar em git (verdade declarada)", () => {
  expect(intOf({ status: "merged" }, () => { throw new Error("git nao devia rodar"); })).toBe(true);
});

test("verified cujo branch JÁ está em main → integrated=true (a coluna que mentia)", () => {
  expect(intOf({ status: "verified" }, () => true)).toBe(true);
});

test("verified NÃO em main permanece integrated=false (fica em 'pronto p/ integrar')", () => {
  expect(intOf({ status: "verified" }, () => false)).toBe(false);
});

test("delivered já em main também é integrado", () => {
  expect(intOf({ status: "delivered" }, () => true)).toBe(true);
});

test("dispatched/em progresso NUNCA é integrado, mesmo que o branch seja ancestral (branch vazio p.ex.)", () => {
  expect(intOf({ status: "dispatched" }, () => true)).toBe(false);
  expect(intOf({ status: "failed" }, () => true)).toBe(false);
});

test("sem worktree localizável → conservador false (não roda git)", () => {
  expect(intOf({ status: "verified", worktree: "/no/worktrees/here" }, () => { throw new Error("nao localiza repo"); })).toBe(false);
});

test("removed sai como não-integrado (histórico puro, branch provavelmente já foi)", () => {
  expect(intOf({ status: "removed" }, () => true)).toBe(false);
});
