import { test, expect } from "bun:test";
import { deriveWorkers, deriveRepos, deriveCounts, evMsg, diffActivity, applySnapshot, activity } from "../runtime/store";
import { fqidOf, dkey } from "../runtime/dom";

const idT = (k: string) => k; // t() identidade para testes de evMsg

test("deriveWorkers exclui coordinator", () => {
  const s = { workers: [{ name: "C", role: "coordinator" }, { name: "A", role: "dev" }, { name: "B", role: "qa" }] };
  const w = deriveWorkers(s);
  expect(w.map(x => x.name)).toEqual(["A", "B"]);
});

test("deriveRepos monta packages não-implicit e group undefined quando igual", () => {
  const s = {
    repos: ["app"],
    repoInfos: [{ name: "app", stack: ["ts"], kind: "service" }],
    packages: [
      { repo: "app", package: "core", implicit: false, stack: ["ts"], kind: "lib", group: "core" },
      { repo: "app", package: "gen", implicit: true, stack: [], kind: "" },
    ],
  };
  const r = deriveRepos(s);
  expect(r).toEqual([{ name: "app", stack: ["ts"], kind: "service", packages: [{ name: "core", stack: ["ts"], kind: "lib", group: undefined }] }]);
});

test("deriveCounts renomeia available→idle e conta journeys/repos", () => {
  const s = { counts: { hired: 5, active: 3, delivered: 2, escalated: 1, available: 4, redirected: 2 }, journeys: [{}, {}], repos: ["a", "b", "c"] };
  expect(deriveCounts(s)).toEqual({ hired: 5, active: 3, delivered: 2, escalated: 1, redirected: 2, idle: 4, journeys: 2, repos: 3 });
});

test("deriveCounts: redirected ausente no snapshot bruto vira 0, nunca undefined", () => {
  const s = { counts: { hired: 1, active: 0, delivered: 0, escalated: 0, available: 1 }, journeys: [], repos: [] };
  expect(deriveCounts(s).redirected).toBe(0);
});

test("fqidOf e dkey", () => {
  expect(fqidOf({ repo: "app", package: "core" })).toBe("app/core");
  expect(fqidOf({ repo: "app" })).toBe("app");
  expect(dkey({ repo: "app", package: "core", specialist: "Ana" })).toBe("app/core::ana");
});

test("evMsg formata por status", () => {
  expect(evMsg({ status: "dispatched", repo: "app", package: "core", journey: "j1" }, idT)).toContain("dispatched to app/core");
  expect(evMsg({ status: "paused", journey: "j1" }, idT)).toContain("paused");
});

// Finding A (whole-branch review): `evMsg` had no case for "redirected" at
// all, so the activity feed fell back to the raw `${status}${journey}` line
// — technically visible, but with none of the "this needs a look" framing
// every other off-track status gets.
test("evMsg: redirected gets its own explicit, exact activity line", () => {
  expect(evMsg({ status: "redirected", repo: "app", package: "core", journey: "j1" }, idT)).toBe(
    "redirected — direction changed, spec needs reconciling · j1",
  );
});

test("diffActivity: primeiro snapshot popula em ordem reversa sem 'changed'", () => {
  const cur = [{ repo: "a", specialist: "X", status: "dispatched", journey: "j" }];
  const r = diffActivity(null, cur, 1000, idT);
  expect(r.activity.length).toBe(1);
  expect(r.changed.length).toBe(0);
});

test("diffActivity: mudança de status gera changed", () => {
  const prev = new Map([[dkey({ repo: "a", specialist: "X" }), { status: "dispatched", pr: undefined }]]);
  const cur = [{ repo: "a", specialist: "X", status: "delivered", journey: "j" }];
  const r = diffActivity(prev, cur, 2000, idT);
  expect(r.changed.length).toBe(1);
  expect(r.changed[0]!.status).toBe("delivered");
});

test("applySnapshot: activity respeita o cap de 60, mais recente no índice 0", () => {
  // First snapshot with no dispatches: primes the module-level prevMap (empty).
  applySnapshot({ ok: true, journeys: [] }, 0, idT);
  // 70 successive snapshots, each introducing one brand-new dispatch (distinct
  // specialist → distinct dkey → always "changed" → unshifted onto activity).
  for (let i = 0; i < 70; i++) {
    applySnapshot(
      { ok: true, journeys: [{ id: "j", dispatches: [{ repo: "a", specialist: "S" + i, status: "dispatched" }] }] },
      1000 + i,
      idT,
    );
  }
  expect(activity.value.length).toBe(60);
  expect(activity.value[0]!.w).toBe("S69"); // newest event most-recent-first
});
