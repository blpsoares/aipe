import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stringify } from "yaml";
import { readPersonaContext } from "../persona-context";

async function root(personas?: unknown, graph?: unknown): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "aipe-pc-"));
  await mkdir(join(dir, ".aipe", "relations"), { recursive: true });
  if (personas !== undefined) await writeFile(join(dir, ".aipe", "personas.yaml"), stringify(personas), "utf8");
  if (graph !== undefined) await writeFile(join(dir, ".aipe", "relations", "graph.yaml"), stringify(graph), "utf8");
  return dir;
}

test("returns only the personas hired for the given repo, dropping the coordinator", async () => {
  const dir = await root({
    personas: [
      { name: "Nicolas", role: "coordinator", repo: null, path: null },
      { name: "Alice", role: "dev-fullstack", repo: "embark", path: "./embark/.claude/skills/alice" },
      { name: "Bob", role: "qa", repo: "embark", path: "./embark/.claude/skills/bob" },
      { name: "Carol", role: "dev-fullstack", repo: "prontuario", path: "./prontuario/.claude/skills/carol" },
    ],
  });
  try {
    const ctx = await readPersonaContext(dir, "embark");
    expect(ctx.personas).toEqual([
      { name: "Alice", role: "dev-fullstack" },
      { name: "Bob", role: "qa" },
    ]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("returns edges touching the repo on either side, dropping unrelated edges", async () => {
  const dir = await root(undefined, {
    nodes: [],
    edges: [
      { from: "embark", to: "prontuario", type: "consumes", perspectives: [{ detail: "calls the API", evidence: "x.ts:1" }] },
      { from: "other-a", to: "other-b", type: "shares-infra", perspectives: [] },
    ],
  });
  try {
    const ctx = await readPersonaContext(dir, "embark");
    expect(ctx.edges).toHaveLength(1);
    expect(ctx.edges[0]?.to).toBe("prontuario");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("missing personas.yaml / graph.yaml → empty context, no throw", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-pc-"));
  try {
    const ctx = await readPersonaContext(dir, "embark");
    expect(ctx.personas).toEqual([]);
    expect(ctx.edges).toEqual([]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
