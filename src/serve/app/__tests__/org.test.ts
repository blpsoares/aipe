import { test, expect, afterEach } from "bun:test";
import { orgColor, orgWorkersFor, orgSortByRole, orgQuery } from "../runtime/org";
import type { Worker } from "../runtime/store";

afterEach(() => {
  orgQuery.value = "";
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
