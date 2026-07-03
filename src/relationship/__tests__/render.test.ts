import { expect, test } from "bun:test";
import { parse } from "yaml";
import { renderGraphYaml, renderReadme } from "../render";
import type { MergedEdge } from "../types";

const edges: MergedEdge[] = [
  {
    from: "embark",
    to: "prontuario",
    type: "consumes",
    perspectives: [{ detail: "calls GET /api/patients", evidence: "src/clients/prontuario.ts:12" }],
  },
];

test("renderGraphYaml produces parseable YAML with the edges list", () => {
  const yaml = renderGraphYaml(edges);
  const parsed = parse(yaml);
  expect(parsed.edges).toHaveLength(1);
  expect(parsed.edges[0].from).toBe("embark");
  expect(parsed.edges[0].perspectives[0].detail).toBe("calls GET /api/patients");
});

test("renderGraphYaml with no edges still produces a valid empty list", () => {
  const parsed = parse(renderGraphYaml([]));
  expect(parsed.edges).toEqual([]);
});

test("renderReadme groups edges under each repo, from and to sides", () => {
  const readme = renderReadme(edges, ["embark", "prontuario"]);
  expect(readme).toContain("## embark");
  expect(readme).toContain("## prontuario");
  expect(readme).toContain("consumes → prontuario");
  expect(readme).toContain("embark → consumes → this repo");
  expect(readme).toContain("calls GET /api/patients (src/clients/prontuario.ts:12)");
});

test("renderReadme notes repos with no known relations", () => {
  const readme = renderReadme([], ["standalone-repo"]);
  expect(readme).toContain("## standalone-repo");
  expect(readme).toContain("_No known relations._");
});
