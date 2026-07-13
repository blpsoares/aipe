import { expect, test } from "bun:test";
import { checkDependenciesLanded, type DependencyContext } from "../law";
import type { Batch } from "../types";

// embark consumes prontuario/api; prontuario/web imports prontuario/api.
const edges = [
  { from: "embark", to: "prontuario/api", type: "consumes" },
  { from: "prontuario/web", to: "prontuario/api", type: "imports" },
  { from: "embark", to: "billing", type: "shares-infra" }, // not a build-order dep
];
const contextUnits = new Set(["embark", "prontuario/api", "prontuario/web", "billing"]);

function ctx(landed: string[]): DependencyContext {
  return { edges, landed: new Set(landed), contextUnits };
}

test("consumer is blocked while its producer has not landed", () => {
  const batch: Batch = [{ repo: "embark", specialist: "Joaquim" }];
  expect(checkDependenciesLanded(batch, ctx([]))).toEqual(["dependency-not-landed embark needs prontuario/api"]);
});

test("consumer is free once the producer is verified/merged", () => {
  const batch: Batch = [{ repo: "embark", specialist: "Joaquim" }];
  expect(checkDependenciesLanded(batch, ctx(["prontuario/api"]))).toEqual([]);
});

test("producer in the SAME wave still blocks the consumer (must land first)", () => {
  const batch: Batch = [
    { repo: "prontuario", package: "api", specialist: "Ana" },
    { repo: "prontuario", package: "web", specialist: "Léo" }, // imports api, not yet landed
  ];
  expect(checkDependenciesLanded(batch, ctx([]))).toEqual(["dependency-not-landed prontuario/web needs prontuario/api"]);
});

test("shares-infra is not a build-order dependency → never blocks", () => {
  const batch: Batch = [{ repo: "embark", specialist: "Joaquim" }];
  // only the shares-infra edge points at billing; api is landed so embark is free
  expect(checkDependenciesLanded(batch, ctx(["prontuario/api"]))).toEqual([]);
});

test("external producers (not in-context) are not gated", () => {
  const batch: Batch = [{ repo: "embark", specialist: "Joaquim" }];
  const external: DependencyContext = {
    edges: [{ from: "embark", to: "some-vendor-sdk", type: "consumes" }],
    landed: new Set(),
    contextUnits: new Set(["embark"]),
  };
  expect(checkDependenciesLanded(batch, external)).toEqual([]);
});

test("a consumer with two unlanded producers reports each once", () => {
  const twoEdges = [
    { from: "embark", to: "prontuario/api", type: "consumes" },
    { from: "embark", to: "billing", type: "imports" },
  ];
  const batch: Batch = [{ repo: "embark", specialist: "Joaquim" }];
  const r = checkDependenciesLanded(batch, { edges: twoEdges, landed: new Set(), contextUnits });
  expect(r.sort()).toEqual(["dependency-not-landed embark needs billing", "dependency-not-landed embark needs prontuario/api"]);
});
