import { expect, test } from "bun:test";
import {
  hasSessionDispatch,
  relevantSessions,
  coordinatorSessionsOf,
  annotateLiveness,
  annotateIntegrated,
  refreshPrMergeCache,
  prMergedFromCache,
  prStateFromCache,
  _seedPrCache,
  _clearPrCache,
  PR_TTL_MS,
  type PrMergeState,
} from "../payload";
import type { SessionInfo } from "../sessions";
import type { JourneyView } from "../../dashboard/snapshot";
import type { PrState } from "../../journey/reconcile";

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
// se o trabalho já está em main, independente do status do ledger, por DOIS sinais:
// --is-ancestor (ff/merge-commit) E o estado MERGED do PR (squash). Conservador:
// na dúvida, false, nunca um falso "integrado". ──
const jv = (over: Record<string, unknown>) =>
  [{ id: "j", dispatches: [{ repo: "aipe", specialist: "Jesse", branch: "b", worktree: "/ws/aipe/.worktrees/j-jesse", status: "verified", ...over }] }] as unknown as JourneyView[];

// annotateIntegrated is SYNCHRONOUS and reads a SYNC tri-state prState resolver
// (re-gate B2): the render path never awaits the network. Unknown ⇒ not integrated
// but PENDING (shown as "verifying"), so a cold read never asserts a merge status.
const UNKNOWN = (): PrMergeState => "unknown";
const recOf = (
  over: Record<string, unknown>,
  isAncestor: (r: string, b: string) => boolean,
  prState: (u: string) => PrMergeState = UNKNOWN,
) => annotateIntegrated(jv(over), isAncestor, prState)[0]!.dispatches[0] as { integrated?: boolean; integrationPending?: boolean };
const intOf = (over: Record<string, unknown>, isAncestor: (r: string, b: string) => boolean, prState?: (u: string) => PrMergeState) =>
  recOf(over, isAncestor, prState).integrated;

test("merged é integrado sem tocar em git (verdade declarada)", () => {
  expect(intOf({ status: "merged" }, () => { throw new Error("git nao devia rodar"); })).toBe(true);
});

test("verified cujo branch JÁ está em main (ancestral) → integrated=true", () => {
  expect(intOf({ status: "verified" }, () => true)).toBe(true);
});

// re-gate B: o defeito sistemático. aipe mergeia por SQUASH, então --is-ancestor é
// SEMPRE false; a verdade vem do PR MERGED (agora do cache, não da rede).
test("SQUASH: branch NÃO-ancestral mas PR MERGED (cache) → integrado (o falso-negativo curado)", () => {
  expect(intOf({ status: "verified", pr: "https://github.com/blpsoares/aipe/pull/22" }, () => false, () => "merged")).toBe(true);
});

test("verified com PR CONFIRMADO aberto → não integrado, e NÃO pendente (verdade estabelecida)", () => {
  const r = recOf({ status: "verified", pr: "https://github.com/x/y/pull/99" }, () => false, () => "open");
  expect(r.integrated).toBe(false);
  expect(r.integrationPending).toBeUndefined();
});

// re-gate B2 follow-up: cache FRIO não pode afirmar o que não estabeleceu. Um
// verified com PR ainda não conferido é integrated=false MAS integrationPending —
// a tela mostra "verificando", não "confirmado pendente".
test("cache FRIO (unknown): não integrado, porém PENDENTE — a tela diz 'verificando'", () => {
  const r = recOf({ status: "verified", pr: "https://github.com/x/y/pull/40" }, () => false, () => "unknown");
  expect(r.integrated).toBe(false);
  expect(r.integrationPending).toBe(true);
});

test("delivered squash-mergeado (PR MERGED) também é integrado", () => {
  expect(intOf({ status: "delivered", pr: "https://github.com/x/y/pull/1" }, () => false, () => "merged")).toBe(true);
});

test("dispatched/em progresso NUNCA é integrado nem pendente, mesmo com PR desconhecido", () => {
  const a = recOf({ status: "dispatched", pr: "https://github.com/x/y/pull/1" }, () => true, () => "unknown");
  expect(a.integrated).toBe(false);
  expect(a.integrationPending).toBeUndefined();
  expect(intOf({ status: "failed", pr: "https://github.com/x/y/pull/1" }, () => true, () => "merged")).toBe(false);
});

test("sem worktree E sem PR → não integrado e NÃO pendente (nada a estabelecer)", () => {
  const r = recOf({ status: "verified", worktree: "/no/worktrees/here" }, () => { throw new Error("nao localiza repo"); });
  expect(r.integrated).toBe(false);
  expect(r.integrationPending).toBeUndefined();
});

test("removed sai como não-integrado (histórico puro)", () => {
  expect(intOf({ status: "removed" }, () => true, () => "merged")).toBe(false);
});

// ── re-gate B2: a rede está FORA do render ──────────────────────────────────────
test("annotateIntegrated é SÍNCRONO — o render nunca pode aguardar a rede", () => {
  const r = annotateIntegrated(jv({ status: "verified", pr: "https://x/y/pull/1" }), () => false, () => "merged");
  expect(r instanceof Promise).toBe(false);
});

test("o resolver de PR do build lê o CACHE (sync tri-state), nunca dispara rede", () => {
  _clearPrCache();
  const spy = { calls: 0 };
  const cacheReader = (_u: string): PrMergeState => { spy.calls++; return "unknown"; };
  annotateIntegrated(jv({ status: "verified", pr: "https://x/y/pull/1" }), () => false, cacheReader);
  expect(spy.calls).toBe(1); // consultou o resolver sync uma vez, sem await/rede
  // o cache tri-state distingue merged / open / unknown, de forma síncrona
  _seedPrCache("https://x/y/pull/7", true);
  _seedPrCache("https://x/y/pull/8", false);
  expect(prStateFromCache("https://x/y/pull/7")).toBe("merged");
  expect(prStateFromCache("https://x/y/pull/8")).toBe("open");
  expect(prStateFromCache("https://x/y/pull/none")).toBe("unknown");
  expect(prMergedFromCache("https://x/y/pull/7")).toBe(true);
});

test("refreshPrMergeCache: MERGED é sticky e NUNCA rebaixa sob rate-limit (null)", async () => {
  _clearPrCache();
  const url = "https://github.com/blpsoares/aipe/pull/22";
  // primeira consulta: MERGED
  await refreshPrMergeCache([url], async () => "MERGED" as PrState);
  expect(prMergedFromCache(url)).toBe(true);
  // agora o gh está rate-limited (null) — o merged NÃO pode voltar para "ready"
  await refreshPrMergeCache([url], async () => { throw new Error("nao deveria re-consultar um merged sticky"); });
  expect(prMergedFromCache(url)).toBe(true);
});

test("refreshPrMergeCache: null (rate-limit/timeout) num PR aberto não cria/rebaixa entrada", async () => {
  _clearPrCache();
  const url = "https://github.com/x/y/pull/99";
  await refreshPrMergeCache([url], async () => null);
  expect(prMergedFromCache(url)).toBe(false); // desconhecido, conservador — nunca um falso "integrado"
});

test("refreshPrMergeCache: entrada fresca não é re-consultada dentro do TTL", async () => {
  _clearPrCache();
  const url = "https://github.com/x/y/pull/5";
  let calls = 0;
  const fetch = async (): Promise<PrState> => { calls++; return "OPEN"; };
  const now = 1_000_000;
  await refreshPrMergeCache([url], fetch, now);
  await refreshPrMergeCache([url], fetch, now + PR_TTL_MS - 1); // ainda fresco
  expect(calls).toBe(1);
  await refreshPrMergeCache([url], fetch, now + PR_TTL_MS + 1); // expirou → re-consulta
  expect(calls).toBe(2);
});
