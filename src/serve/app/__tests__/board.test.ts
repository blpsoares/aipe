import { test, expect } from "bun:test";
import { columnOf, boardActor, buildBoard, BOARD_COLUMNS, ACTIVE_COLUMNS, isActive } from "../runtime/board";
import type { Dispatch } from "../runtime/store";
import type { SessionInfo } from "../../sessions";

const d = (over: Partial<Dispatch> = {}): Dispatch =>
  ({ repo: "aipe", specialist: "Jesse", branch: "b", worktree: "/wt", status: "dispatched", mode: "session", ...over }) as Dispatch;

const running: SessionInfo = { id: "s1", status: "running", activity: "working", cwd: "/wt" };
const waitingSess: SessionInfo = { id: "s1", status: "running", activity: "waiting", cwd: "/wt" };

// ── the four columns, mapped from the canonical UnitPhase (consuming, not
// re-deriving) — SDD §11.2. ──────────────────────────────────────────────────

test("BOARD_COLUMNS: ordem working → needs-you → in-review → ready → integrated", () => {
  expect(BOARD_COLUMNS).toEqual(["working", "needs-you", "in-review", "ready", "integrated"]);
});

test("ACTIVE_COLUMNS é o vivo (sem integrated), o padrão de fábrica (item 3)", () => {
  expect(ACTIVE_COLUMNS).toEqual(["working", "needs-you", "in-review", "ready"]);
  expect(isActive(d({ status: "verified", liveness: "landed" }))).toBe(true);
  expect(isActive(d({ status: "merged" }))).toBe(false);
  expect(isActive(d({ status: "verified", liveness: "landed", integrated: true }))).toBe(false);
});

test("Trabalhando: sessão viva (liveness running) trabalhando", () => {
  expect(columnOf(d({ liveness: "running" }), running)).toBe("working");
});

test("Em revisão: delivered", () => {
  expect(columnOf(d({ status: "delivered" }))).toBe("in-review");
});

test("Pronto p/ integrar: verified que ainda NÃO está em main", () => {
  expect(columnOf(d({ status: "verified", liveness: "landed" }))).toBe("ready");
});

// defeito (2), o mais grave — a coluna que mente. Um `verified` cujo branch JÁ
// está em main (integrated=true, lido server-side por merge-base) vai para
// Integrados, não fica em "pronto para integrar" prometendo trabalho que não
// existe mais. A tela lê a verdade; não pinta por cima.
test("Integrados: verified com integrated=true sai de 'pronto' e vai para Integrados", () => {
  expect(columnOf(d({ status: "verified", liveness: "landed", integrated: true }))).toBe("integrated");
});

test("Integrados: merged é integrado (antes saía do quadro)", () => {
  expect(columnOf(d({ status: "merged" }))).toBe("integrated");
});

test("Integrados: delivered já em main também é integrado, não 'em revisão'", () => {
  expect(columnOf(d({ status: "delivered", integrated: true }))).toBe("integrated");
});

test("removed (worktree desmontado) sai do quadro (null) — é histórico puro", () => {
  expect(columnOf(d({ status: "removed" }))).toBeNull();
});

test("Precisa de você: escalated, blocked→waiting, redirected, failed", () => {
  expect(columnOf(d({ status: "escalated" }))).toBe("needs-you");
  expect(columnOf(d({ status: "blocked", liveness: "waiting" }))).toBe("needs-you");
  expect(columnOf(d({ status: "redirected", liveness: "redirected" }))).toBe("needs-you");
  expect(columnOf(d({ status: "failed" }))).toBe("needs-you");
});

// armadilha 1 — waiting-approval: a sessão viva ESPERANDO uma pessoa cai em
// Precisa de você, não fica em Trabalhando. Herdada de agentop (#243); nós só
// consumimos activity:"waiting".
test("armadilha 1: sessão running com activity 'waiting' → Precisa de você (waiting-approval)", () => {
  expect(columnOf(d({ liveness: "running" }), waitingSess)).toBe("needs-you");
});

test("sessão running com activity 'working' fica em Trabalhando", () => {
  expect(columnOf(d({ liveness: "running" }), running)).toBe("working");
});

// armadilha 2 — dispatched morto (dead-silent) NUNCA aparece como Trabalhando.
test("armadilha 2: liveness dead-silent → Precisa de você, nunca Trabalhando", () => {
  expect(columnOf(d({ liveness: "dead-silent" }))).toBe("needs-you");
});

test("liveness unknown (não dá para verificar) fica em Trabalhando, mas sinalizável", () => {
  expect(columnOf(d({ liveness: "unknown" }))).toBe("working");
});

test("subagent dispatched (sem liveness) → Trabalhando", () => {
  expect(columnOf(d({ mode: "subagent", liveness: undefined }))).toBe("working");
});

// ── quem age em seguida (para recuar o que não é do PE) — SDD §11.2. ──────────

test("boardActor: escalated/dead-silent/waiting-approval são do PE ('you')", () => {
  expect(boardActor(d({ status: "escalated" }))).toBe("you");
  expect(boardActor(d({ status: "dispatched", liveness: "dead-silent" }))).toBe("you");
  expect(boardActor(d({ status: "dispatched", liveness: "running" }), waitingSess)).toBe("you");
});

test("boardActor: failed é do dev; blocked/redirected são do coordenador", () => {
  expect(boardActor(d({ status: "failed" }))).toBe("dev");
  expect(boardActor(d({ status: "blocked", liveness: "waiting" }))).toBe("coord");
  expect(boardActor(d({ status: "redirected", liveness: "redirected" }))).toBe("coord");
});

test("boardActor é null para colunas que não são 'precisa de você'", () => {
  expect(boardActor(d({ liveness: "running" }), running)).toBeNull();
  expect(boardActor(d({ status: "delivered" }))).toBeNull();
});

// ── buildBoard agrupa, na ordem, e mantém task/persona/branch/pr/status juntos ──

test("buildBoard agrupa por coluna na ordem, com Integrados no fim", () => {
  const dispatches = [
    d({ specialist: "A", liveness: "running" }),
    d({ specialist: "B", status: "delivered", pr: "http://pr/1" }),
    d({ specialist: "C", status: "verified", liveness: "landed" }),
    d({ specialist: "D", status: "escalated" }),
    d({ specialist: "E", status: "merged" }), // agora em Integrados
    d({ specialist: "F", status: "verified", liveness: "landed", integrated: true }), // mentia em "pronto"
  ];
  const board = buildBoard(dispatches, [running]);
  expect(board.map((c) => c.column)).toEqual(["working", "needs-you", "in-review", "ready", "integrated"]);
  const byCol = Object.fromEntries(board.map((c) => [c.column, c.cards.map((k) => k.dispatch.specialist)]));
  expect(byCol["working"]).toEqual(["A"]);
  expect(byCol["needs-you"]).toEqual(["D"]);
  expect(byCol["in-review"]).toEqual(["B"]);
  expect(byCol["ready"]).toEqual(["C"]); // só o que NÃO está em main
  expect(byCol["integrated"]).toEqual(["E", "F"]);
  // o card carrega o PR junto (task/persona/branch já vêm no dispatch)
  const inReview = board.find((c) => c.column === "in-review")!;
  expect(inReview.cards[0]!.dispatch.pr).toBe("http://pr/1");
});

test("buildBoard: card de 'precisa de você' carrega o ator; PE-first dentro da coluna", () => {
  const dispatches = [
    d({ specialist: "Coord", status: "blocked", liveness: "waiting" }), // coord
    d({ specialist: "Pe", status: "escalated" }), // you
  ];
  const board = buildBoard(dispatches, []);
  const needs = board.find((c) => c.column === "needs-you")!;
  // itens do PE ('you') sobem ao topo
  expect(needs.cards.map((k) => k.dispatch.specialist)).toEqual(["Pe", "Coord"]);
  expect(needs.cards[0]!.actor).toBe("you");
  expect(needs.cards[1]!.actor).toBe("coord");
});
