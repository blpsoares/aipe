import { expect, test } from "bun:test";
import { parse } from "yaml";
import { renderGraphYaml, renderReadme } from "../render";
import type { GraphNode, MergedEdge } from "../types";

const edges: MergedEdge[] = [
  {
    from: "embark",
    to: "prontuario",
    type: "consumes",
    perspectives: [{ detail: "calls GET /api/patients", evidence: "src/clients/prontuario.ts:12" }],
  },
];

const repoNodes: GraphNode[] = [
  { fqid: "embark", repo: "embark", module: null, stack: ["bun"] },
  { fqid: "prontuario", repo: "prontuario", module: null, stack: ["hono"] },
];

test("renderGraphYaml produces parseable YAML with nodes + edges", () => {
  const yaml = renderGraphYaml(repoNodes, edges);
  const parsed = parse(yaml);
  expect(parsed.nodes).toHaveLength(2);
  expect(parsed.nodes[0].fqid).toBe("embark");
  expect(parsed.edges).toHaveLength(1);
  expect(parsed.edges[0].from).toBe("embark");
  expect(parsed.edges[0].perspectives[0].detail).toBe("calls GET /api/patients");
});

test("renderGraphYaml with nothing still produces valid empty lists", () => {
  const parsed = parse(renderGraphYaml([], []));
  expect(parsed.edges).toEqual([]);
  expect(parsed.nodes).toEqual([]);
});

test("renderReadme groups edges under each repo, from and to sides (single-module)", () => {
  const readme = renderReadme(repoNodes, edges, ["embark", "prontuario"]);
  expect(readme).toContain("## embark");
  expect(readme).toContain("## prontuario");
  expect(readme).toContain("consumes → prontuario");
  expect(readme).toContain("embark → consumes → this repo");
  expect(readme).toContain("calls GET /api/patients (src/clients/prontuario.ts:12)");
});

test("renderReadme notes repos with no known relations", () => {
  const readme = renderReadme([], [], ["standalone-repo"]);
  expect(readme).toContain("## standalone-repo");
  expect(readme).toContain("_No known relations._");
});

test("renderReadme renders per-module sub-sections for a monorepo", () => {
  const nodes: GraphNode[] = [
    { fqid: "prontuario/api", repo: "prontuario", module: "api", stack: ["hono"], description: "REST API" },
    { fqid: "prontuario/apps/web", repo: "prontuario", module: "apps/web", stack: ["react"] },
  ];
  const monoEdges: MergedEdge[] = [
    { from: "prontuario/apps/web", to: "prontuario/api", type: "consumes", perspectives: [{ detail: "calls /records", evidence: "web:1" }] },
  ];
  const readme = renderReadme(nodes, monoEdges, ["prontuario"]);
  expect(readme).toContain("## prontuario");
  expect(readme).toContain("### prontuario/api");
  expect(readme).toContain("### prontuario/apps/web");
  expect(readme).toContain("_REST API_");
  // web consumes api
  expect(readme).toContain("consumes → prontuario/api");
  // api sees the reverse
  expect(readme).toContain("prontuario/apps/web → consumes → this");
});
