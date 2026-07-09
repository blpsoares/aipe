import { test, expect } from "bun:test";
import { deriveWorkers, deriveRepos, deriveCounts, evMsg, diffActivity } from "../runtime/store";
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
  const s = { counts: { hired: 5, active: 3, delivered: 2, escalated: 1, available: 4 }, journeys: [{}, {}], repos: ["a", "b", "c"] };
  expect(deriveCounts(s)).toEqual({ hired: 5, active: 3, delivered: 2, escalated: 1, idle: 4, journeys: 2, repos: 3 });
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
