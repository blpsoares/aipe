import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse, stringify } from "yaml";
import { combineMergedEdges, pruneEdges } from "../merge";
import { runRelationshipMerge } from "../run";
import type { BrainFile, MergedEdge } from "../types";

test("combineMergedEdges unions perspectives and dedups identical ones", () => {
  const a: MergedEdge[] = [
    { from: "embark", to: "prontuario", type: "consumes", perspectives: [{ detail: "d1", evidence: "e1" }] },
  ];
  const b: MergedEdge[] = [
    { from: "embark", to: "prontuario", type: "consumes", perspectives: [{ detail: "d1", evidence: "e1" }, { detail: "d2", evidence: "e2" }] },
    { from: "faturas", to: "embark", type: "imports", perspectives: [{ detail: "x", evidence: "y" }] },
  ];
  const merged = combineMergedEdges(a, b);
  const consumes = merged.find((e) => e.type === "consumes");
  expect(consumes?.perspectives).toHaveLength(2); // d1 deduped, d2 added
  expect(merged).toHaveLength(2);
});

test("pruneEdges drops edges touching removed repos", () => {
  const edges: MergedEdge[] = [
    { from: "a", to: "b", type: "consumes", perspectives: [] },
    { from: "a", to: "gone", type: "imports", perspectives: [] },
  ];
  expect(pruneEdges(edges, new Set(["a", "b"]))).toHaveLength(1);
});

test("runRelationshipMerge folds a new repo's edges into the existing graph", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-relm-"));
  try {
    const brain: BrainFile = {
      context: { name: "opvibes", coordinator: "Nicolas" },
      repos: [
        { name: "embark", url: "u", path: "./embark", stack: ["typescript"] },
        { name: "prontuario", url: "u", path: "./prontuario", stack: ["python"] },
        { name: "faturas", url: "u", path: "./faturas" }, // newly added, no stack yet
      ],
    };
    await mkdir(join(dir, ".aipe", "relations", ".reports"), { recursive: true });
    await writeFile(join(dir, ".aipe", "brain.yaml"), stringify(brain), "utf8");
    // existing graph (before faturas)
    await writeFile(
      join(dir, ".aipe", "relations", "graph.yaml"),
      stringify({ edges: [{ from: "embark", to: "prontuario", type: "consumes", perspectives: [{ detail: "old", evidence: "e" }] }] }),
      "utf8",
    );
    // staged report for the new repo only
    await writeFile(
      join(dir, ".aipe", "relations", ".reports", "faturas.json"),
      JSON.stringify({ repo: "faturas", stack: ["node"], relations: [{ to: "embark", type: "imports", detail: "faturas imports embark sdk", evidence: "pkg.json" }] }),
    );

    const result = await runRelationshipMerge(dir);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.phase).toBe("done");

    const graph = parse(await readFile(join(dir, ".aipe", "relations", "graph.yaml"), "utf8"));
    // old edge preserved + new edge added
    expect(graph.edges).toHaveLength(2);
    expect(graph.edges.some((e: MergedEdge) => e.from === "embark" && e.to === "prontuario")).toBe(true);
    expect(graph.edges.some((e: MergedEdge) => e.from === "faturas" && e.to === "embark")).toBe(true);

    // stack backfilled only for the new repo
    const brain2 = parse(await readFile(join(dir, ".aipe", "brain.yaml"), "utf8"));
    expect(brain2.repos.find((r: { name: string }) => r.name === "faturas").stack).toEqual(["node"]);
    expect(brain2.repos.find((r: { name: string }) => r.name === "embark").stack).toEqual(["typescript"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
