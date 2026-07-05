import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stringify } from "yaml";
import { buildSnapshot } from "../snapshot";
import type { BrainFile } from "../../context-brain/types";

// A workspace seeded with stacks, a relations graph, a toolbox and a journey —
// enough to exercise every field the web console reads on top of the TUI's.
async function ws(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "aipe-snapext-"));
  const brain: BrainFile = {
    context: { name: "opvibes", coordinator: "Nicolas" },
    repos: [
      { name: "embark", url: "u1", path: "./embark", stack: ["TypeScript", "Bun"] },
      { name: "api", url: "u2", path: "./api", stack: ["Go"] },
    ],
  };
  await mkdir(join(dir, ".aipe", "journeys"), { recursive: true });
  await mkdir(join(dir, ".aipe", "relations"), { recursive: true });
  await writeFile(join(dir, ".aipe", "brain.yaml"), stringify(brain), "utf8");
  await writeFile(
    join(dir, ".aipe", "personas.yaml"),
    stringify({
      personas: [
        { name: "Nicolas", role: "coordinator", repo: null, path: null },
        { name: "Joaquim", role: "dev-fullstack", repo: "embark", path: "p" },
      ],
    }),
    "utf8",
  );
  await writeFile(
    join(dir, ".aipe", "relations", "graph.yaml"),
    stringify({
      edges: [
        {
          from: "embark",
          to: "api",
          type: "consumes",
          perspectives: [{ detail: "embark calls the api", evidence: "fetch(/api)" }],
        },
      ],
    }),
    "utf8",
  );
  await writeFile(
    join(dir, ".aipe", "toolbox.yaml"),
    stringify({
      skills: [{ name: "sdd", description: "Spec-driven kit", objective: "specs", whenToUse: "big features", repos: ["embark"] }],
      mcps: [{ name: "pg", scope: "workspace", repos: [], description: "Postgres", config: { url: "${PG_URL}" } }],
    }),
    "utf8",
  );
  await writeFile(
    join(dir, ".aipe", "journeys", "j1.yaml"),
    stringify({ id: "j1", dispatches: [{ repo: "embark", specialist: "Joaquim", branch: "b", worktree: "w", status: "dispatched" }] }),
    "utf8",
  );
  return dir;
}

test("snapshot exposes per-repo stacks", async () => {
  const dir = await ws();
  try {
    const s = await buildSnapshot(dir);
    expect(s.repoInfos).toEqual([
      { name: "embark", stack: ["TypeScript", "Bun"] },
      { name: "api", stack: ["Go"] },
    ]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("snapshot exposes relation edges with a detail", async () => {
  const dir = await ws();
  try {
    const s = await buildSnapshot(dir);
    expect(s.relations).toHaveLength(1);
    expect(s.relations[0]).toMatchObject({ from: "embark", to: "api", type: "consumes", detail: "embark calls the api" });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("snapshot exposes toolbox detail (not just counts)", async () => {
  const dir = await ws();
  try {
    const s = await buildSnapshot(dir);
    expect(s.skills).toBe(1);
    expect(s.mcps).toBe(1);
    expect(s.toolboxDetail.skills[0]).toMatchObject({ name: "sdd", whenToUse: "big features", repos: ["embark"] });
    expect(s.toolboxDetail.mcps[0]).toMatchObject({ name: "pg", scope: "workspace" });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("snapshot carries a generatedAt stamp and journey updatedAt", async () => {
  const dir = await ws();
  try {
    const s = await buildSnapshot(dir);
    expect(typeof s.generatedAt).toBe("string");
    expect(s.journeys[0]?.updatedAt).toBeDefined();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
