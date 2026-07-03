import { expect, test } from "bun:test";
import { mergeEdges } from "../merge";
import type { RepoReport } from "../types";

test("keeps a one-sided imports edge untouched", () => {
  const reports: RepoReport[] = [
    { repo: "embark", stack: [], relations: [{ to: "shared-ui", type: "imports", detail: "imports Button", evidence: "src/a.ts:1" }] },
  ];
  const edges = mergeEdges(reports);
  expect(edges).toEqual([
    { from: "embark", to: "shared-ui", type: "imports", perspectives: [{ detail: "imports Button", evidence: "src/a.ts:1" }] },
  ]);
});

test("merges consumes + exposed-by reported from both sides into one edge", () => {
  const reports: RepoReport[] = [
    { repo: "embark", stack: [], relations: [{ to: "prontuario", type: "consumes", detail: "calls GET /api/patients", evidence: "src/clients/prontuario.ts:12" }] },
    { repo: "prontuario", stack: [], relations: [{ to: "embark", type: "exposed-by", detail: "exposes /api/patients", evidence: "src/routes/patients.ts:5" }] },
  ];
  const edges = mergeEdges(reports);
  expect(edges).toEqual([
    {
      from: "embark",
      to: "prontuario",
      type: "consumes",
      perspectives: [
        { detail: "calls GET /api/patients", evidence: "src/clients/prontuario.ts:12" },
        { detail: "exposes /api/patients", evidence: "src/routes/patients.ts:5" },
      ],
    },
  ]);
});

test("merges imports + published-by reported from both sides into one edge", () => {
  const reports: RepoReport[] = [
    { repo: "embark", stack: [], relations: [{ to: "shared-ui", type: "imports", detail: "imports Button", evidence: "src/a.ts:1" }] },
    { repo: "shared-ui", stack: [], relations: [{ to: "embark", type: "published-by", detail: "publishes Button, used by embark", evidence: "src/Button.tsx:1" }] },
  ];
  const edges = mergeEdges(reports);
  expect(edges).toEqual([
    {
      from: "embark",
      to: "shared-ui",
      type: "imports",
      perspectives: [
        { detail: "imports Button", evidence: "src/a.ts:1" },
        { detail: "publishes Button, used by embark", evidence: "src/Button.tsx:1" },
      ],
    },
  ]);
});

test("canonicalizes shares-infra direction alphabetically, merging both sides", () => {
  const reports: RepoReport[] = [
    { repo: "prontuario", stack: [], relations: [{ to: "embark", type: "shares-infra", detail: "same Postgres", evidence: "docker-compose.yml:8" }] },
    { repo: "embark", stack: [], relations: [{ to: "prontuario", type: "shares-infra", detail: "same Postgres", evidence: ".env.example:3" }] },
  ];
  const edges = mergeEdges(reports);
  expect(edges).toHaveLength(1);
  expect(edges[0]?.from).toBe("embark");
  expect(edges[0]?.to).toBe("prontuario");
  expect(edges[0]?.perspectives).toHaveLength(2);
});

test("does not merge edges between different repo pairs or different types", () => {
  const reports: RepoReport[] = [
    { repo: "embark", stack: [], relations: [{ to: "prontuario", type: "consumes", detail: "a", evidence: "e1" }] },
    { repo: "embark", stack: [], relations: [{ to: "faturamento", type: "consumes", detail: "b", evidence: "e2" }] },
  ];
  const edges = mergeEdges(reports);
  expect(edges).toHaveLength(2);
});

test("sorts output deterministically by from, then to, then type", () => {
  const reports: RepoReport[] = [
    { repo: "z-repo", stack: [], relations: [{ to: "a-repo", type: "imports", detail: "d", evidence: "e" }] },
    { repo: "a-repo", stack: [], relations: [{ to: "b-repo", type: "consumes", detail: "d", evidence: "e" }] },
  ];
  const edges = mergeEdges(reports);
  expect(edges.map((e) => e.from)).toEqual(["a-repo", "z-repo"]);
});
