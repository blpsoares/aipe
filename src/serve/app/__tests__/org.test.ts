import { test, expect, afterEach } from "bun:test";
import {
  orgColor,
  orgWorkersFor,
  orgSortByRole,
  orgQuery,
  fitTransform,
  fitToView,
  orgContent,
  orgTransform,
  zoomBy,
} from "../runtime/org";
import type { Worker } from "../runtime/store";

afterEach(() => {
  orgQuery.value = "";
  orgContent.value = { width: 0, height: 0 };
  orgTransform.value = { s: 1, x: 0, y: 0 };
});

const w = (name: string, role: string, repo = "app", extra: Partial<Worker> = {}): Worker =>
  ({ name, role, repo, package: null, status: "active", journey: undefined, pr: undefined, ...extra }) as Worker;

// Finding A (whole-branch review): `orgColor` had no branch for "redirected"
// at all, so it fell through to the default `slate` — the same color as an
// idle/available worker, the exact opposite of a specialist whose work just
// diverged mid-flight.
test("orgColor(\"redirected\") is amber, not the slate default", () => {
  expect(orgColor("redirected")).toBe("var(--amber)");
  expect(orgColor("redirected")).not.toBe("var(--slate)");
});

// #5 — intentional org ordering: dev-fullstack before QA, stable name tiebreaker.
test("orgSortByRole: dev-fullstack antes de qa, com desempate por nome", () => {
  const out = orgSortByRole([w("Zoe", "qa"), w("Ana", "dev-fullstack"), w("Bruno", "qa"), w("Caio", "dev-fullstack")]);
  expect(out.map((x) => x.name)).toEqual(["Ana", "Caio", "Bruno", "Zoe"]);
});

test("orgSortByRole: role desconhecida vai por último, sem quebrar", () => {
  const out = orgSortByRole([w("X", "qa"), w("Y", "reviewer"), w("Z", "dev-fullstack")]);
  expect(out.map((x) => x.name)).toEqual(["Z", "X", "Y"]);
});

test("orgWorkersFor aplica a ordenação de role (dev-fullstack antes de qa) por repo", () => {
  const workers = [w("Marina", "qa", "embark"), w("Joaquim", "dev-fullstack", "embark"), w("Outro", "qa", "other")];
  expect(orgWorkersFor(workers, "embark").map((x) => x.name)).toEqual(["Joaquim", "Marina"]);
});

test("orgWorkersFor mantém a ordenação mesmo com filtro ativo por nome de repo", () => {
  orgQuery.value = "embark";
  const workers = [w("Marina", "qa", "embark"), w("Joaquim", "dev-fullstack", "embark")];
  // repo-name match -> shows all, still ordered by role
  expect(orgWorkersFor(workers, "embark").map((x) => x.name)).toEqual(["Joaquim", "Marina"]);
});

// ── fit-to-view (j-20260827-jo, dobrada aqui): o org tem que CABER na viewport
// no load, sem scroll H nem V; reset re-enquadra; resize recalcula. ─────────────

test("fitTransform reduz conteúdo maior que a viewport para caber, centralizado", () => {
  // avail = 1000-2*20 x 800-2*20 = 960 x 760; ratios 960/2000=0.48, 760/1000=0.76 → s=0.48
  const t = fitTransform({ width: 2000, height: 1000 }, { width: 1000, height: 800 }, 20);
  expect(t.s).toBeCloseTo(0.48, 6);
  // centralizado: scaledW=960 → x=(1000-960)/2=20; scaledH=480 → y=(800-480)/2=160
  expect(t.x).toBeCloseTo(20, 6);
  expect(t.y).toBeCloseTo(160, 6);
  // e não transborda em nenhum eixo
  expect(t.s * 2000).toBeLessThanOrEqual(1000 + 1e-9);
  expect(t.s * 1000).toBeLessThanOrEqual(800 + 1e-9);
});

test("fitTransform nunca amplia conteúdo pequeno além do natural (s<=1) e centraliza", () => {
  const t = fitTransform({ width: 400, height: 300 }, { width: 1000, height: 800 }, 20);
  expect(t.s).toBe(1);
  expect(t.x).toBeCloseTo(300, 6); // (1000-400)/2
  expect(t.y).toBeCloseTo(250, 6); // (800-300)/2
});

test("fitTransform é seguro em casos degenerados (viewport/conteúdo zero → identidade)", () => {
  expect(fitTransform({ width: 0, height: 0 }, { width: 100, height: 100 })).toEqual({ s: 1, x: 0, y: 0 });
  expect(fitTransform({ width: 100, height: 100 }, { width: 0, height: 0 })).toEqual({ s: 1, x: 0, y: 0 });
});

test("fitToView lê orgContent e escreve o transform ajustado", () => {
  orgContent.value = { width: 2000, height: 1000 };
  fitToView({ width: 1000, height: 800 }, 20);
  expect(orgTransform.value.s).toBeCloseTo(0.48, 6);
  expect(orgTransform.value.x).toBeCloseTo(20, 6);
});

test("reset (zoomBy(0)) RE-ENQUADRA para caber, não volta a s:1", () => {
  orgContent.value = { width: 2000, height: 1000 };
  orgTransform.value = { s: 2.5, x: -100, y: -50 };
  zoomBy(0, { width: 1000, height: 800 }, 20);
  expect(orgTransform.value.s).toBeCloseTo(0.48, 6);
  expect(orgTransform.value).not.toEqual({ s: 1, x: 0, y: 0 });
});
