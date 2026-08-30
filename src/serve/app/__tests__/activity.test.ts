import { test, expect } from "bun:test";
import {
  FACTORY_CONFIG,
  normalizeConfig,
  groupBoard,
  matchesFilters,
  boardCards,
  distinctValues,
  taskTitle,
  envelopeNorm,
  isEnvException,
  copyCommandFor,
  type BoardConfig,
} from "../runtime/activity";
import type { Dispatch } from "../runtime/store";
import type { SessionInfo } from "../../sessions";

const d = (over: Partial<Dispatch> = {}): Dispatch =>
  ({ repo: "aipe", specialist: "Jesse", branch: "b", worktree: "/wt", status: "dispatched", mode: "session", journey: "j-1", ...over }) as Dispatch;

const cfg = (over: Partial<BoardConfig> = {}): BoardConfig => ({ ...FACTORY_CONFIG, ...over });

const sample = (): Dispatch[] => [
  d({ specialist: "Ana", repo: "aipe", status: "dispatched", liveness: "running", journey: "j-1" }),
  d({ specialist: "Bruno", repo: "embark", status: "delivered", journey: "j-1" }),
  d({ specialist: "Carla", repo: "aipe", status: "escalated", journey: "j-2" }),
  d({ specialist: "Dora", repo: "embark", status: "verified", liveness: "landed", journey: "j-2" }), // ready
  d({ specialist: "Eli", repo: "aipe", status: "verified", liveness: "landed", integrated: true, journey: "j-3" }), // integrated
  d({ specialist: "Fox", repo: "embark", status: "merged", journey: "j-3" }), // integrated
];
const running: SessionInfo = { id: "s1", status: "running", activity: "working", cwd: "/wt" };

test("factory config é agrupar por estado, só ativos (item 3)", () => {
  expect(FACTORY_CONFIG.groupBy).toBe("state");
  expect(FACTORY_CONFIG.showCompleted).toBe(false);
});

test("padrão de fábrica: agrupa por estado nas colunas ativas, Integrados NÃO aparece", () => {
  const cols = groupBoard(sample(), [running], FACTORY_CONFIG);
  expect(cols.map((c) => c.key)).toEqual(["working", "needs-you", "in-review", "ready"]);
  const byKey = Object.fromEntries(cols.map((c) => [c.key, c.cards.map((k) => k.dispatch.specialist)]));
  expect(byKey["working"]).toEqual(["Ana"]);
  expect(byKey["needs-you"]).toEqual(["Carla"]);
  expect(byKey["in-review"]).toEqual(["Bruno"]);
  expect(byKey["ready"]).toEqual(["Dora"]); // Eli (integrated) e Fox (merged) NÃO
});

test("showCompleted revela a coluna Integrados com os já-em-main", () => {
  const cols = groupBoard(sample(), [running], cfg({ showCompleted: true }));
  expect(cols.map((c) => c.key)).toContain("integrated");
  const integrated = cols.find((c) => c.key === "integrated")!;
  expect(integrated.cards.map((k) => k.dispatch.specialist).sort()).toEqual(["Eli", "Fox"]);
});

test("cada coluna reporta o total (a contagem, item 1)", () => {
  const cols = groupBoard(sample(), [running], cfg({ showCompleted: true }));
  const ready = cols.find((c) => c.key === "ready")!;
  expect(ready.total).toBe(ready.cards.length);
});

test("agrupar por repo: uma coluna por repo, ordenada, verbatim (não é chave i18n)", () => {
  const cols = groupBoard(sample(), [running], cfg({ groupBy: "repo", showCompleted: true }));
  expect(cols.map((c) => c.key)).toEqual(["aipe", "embark"]);
  expect(cols[0]!.labelIsKey).toBe(false);
  expect(cols[0]!.label).toBe("aipe");
});

test("agrupar por persona e por jornada", () => {
  const byPersona = groupBoard(sample(), [running], cfg({ groupBy: "persona", showCompleted: true }));
  expect(byPersona.map((c) => c.key)).toEqual(["Ana", "Bruno", "Carla", "Dora", "Eli", "Fox"]);
  const byJourney = groupBoard(sample(), [running], cfg({ groupBy: "journey", showCompleted: true }));
  expect(byJourney.map((c) => c.key)).toEqual(["j-1", "j-2", "j-3"]);
});

test("filtro por repo restringe a um repo (combinável)", () => {
  const cols = groupBoard(sample(), [running], cfg({ showCompleted: true, filters: { ...FACTORY_CONFIG.filters, repos: ["aipe"] } }));
  const all = cols.flatMap((c) => c.cards.map((k) => k.dispatch.repo));
  expect(all.every((r) => r === "aipe")).toBe(true);
});

test("filtro waitsOnPE mostra só o que precisa do PE", () => {
  const cols = groupBoard(sample(), [running], cfg({ filters: { ...FACTORY_CONFIG.filters, waitsOnPE: true } }));
  const specialists = cols.flatMap((c) => c.cards.map((k) => k.dispatch.specialist));
  expect(specialists).toEqual(["Carla"]);
});

test("matchesFilters: showCompleted=false esconde integrado/merged", () => {
  const cards = boardCards(sample(), [running]);
  const eli = cards.find((c) => c.dispatch.specialist === "Eli")!;
  expect(matchesFilters(eli, FACTORY_CONFIG)).toBe(false);
  expect(matchesFilters(eli, cfg({ showCompleted: true }))).toBe(true);
});

test("distinctValues alimenta a UI de filtros", () => {
  expect(distinctValues(sample(), [running], "repo")).toEqual(["aipe", "embark"]);
  expect(distinctValues(sample(), [running], "persona")).toContain("Carla");
});

// ── persistence normalize: defensivo, nunca lança, sempre volta ao chão firme ──
test("normalizeConfig repara lixo e ausência (volta ao padrão de fábrica)", () => {
  expect(normalizeConfig(null)).toEqual(FACTORY_CONFIG);
  expect(normalizeConfig({ groupBy: "nonsense" }).groupBy).toBe("state");
  const good = normalizeConfig({ groupBy: "repo", showCompleted: true, filters: { repos: ["aipe"], states: ["bogus", "ready"] } });
  expect(good.groupBy).toBe("repo");
  expect(good.showCompleted).toBe(true);
  expect(good.filters.repos).toEqual(["aipe"]);
  expect(good.filters.states).toEqual(["ready"]); // bogus dropped
});

// ── card fields (SDD §8) ──────────────────────────────────────────────────────
test("taskTitle deriva um título legível do slug, sem inventar campo", () => {
  expect(taskTitle(d({ task: "atividade-kanban" }))).toBe("atividade kanban");
  expect(taskTitle(d({ task: undefined, branch: "aipe/j-1/jesse__gate-pr34" }))).toBe("jesse gate pr34");
  expect(taskTitle(d({ task: undefined, branch: "" }))).toBe("—");
});

test("envelopeNorm acha o comum; a exceção é o que difere (ausência não é exceção)", () => {
  const board = [
    d({ harness: "claude-code", model: "claude-opus-4-8", intensity: "normal" }),
    d({ harness: "claude-code", model: "claude-opus-4-8", intensity: "normal" }),
    d({ harness: "claude-code", model: "claude-opus-4-8", intensity: "ultracode" }),
    d({ harness: undefined, model: undefined, intensity: undefined }), // legado
  ];
  const norm = envelopeNorm(board);
  expect(norm.model).toBe("claude-opus-4-8");
  expect(norm.intensity).toBe("normal");
  expect(isEnvException("ultracode", norm.intensity)).toBe(true); // a exceção salta
  expect(isEnvException("normal", norm.intensity)).toBe(false); // o comum se cala
  expect(isEnvException(undefined, norm.intensity)).toBe(false); // legado não é exceção
});

test("copyCommandFor: inspeciona sessão viva, senão vai ao worktree, senão nada", () => {
  expect(copyCommandFor(d({ sessionId: "abc123" }))).toBe("agentop session attach abc123");
  expect(copyCommandFor(d({ sessionId: undefined, worktree: "/ws/x" }))).toBe("cd /ws/x");
  expect(copyCommandFor(d({ sessionId: undefined, worktree: undefined }))).toBeNull();
});
