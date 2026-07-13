import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stringify } from "yaml";
import { run } from "../cli";
import type { BrainFile } from "../../context-brain/types";

async function ws(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "aipe-disp-"));
  const brain: BrainFile = {
    context: { name: "opvibes", coordinator: "Nicolas" },
    repos: [
      { name: "embark", url: "git@github.com:o/embark.git", path: "./embark" },
      { name: "prontuario", url: "git@github.com:o/prontuario.git", path: "./prontuario" },
    ],
  };
  await mkdir(join(dir, ".aipe"), { recursive: true });
  await writeFile(join(dir, ".aipe", "brain.yaml"), stringify(brain), "utf8");
  await writeFile(
    join(dir, ".aipe", "personas.yaml"),
    stringify({
      personas: [
        { name: "Nicolas", role: "coordinator", repo: null, path: null },
        { name: "Joaquim", role: "dev-fullstack", repo: "embark", path: "./embark/.claude/skills/joaquim" },
        { name: "Pedro", role: "dev-fullstack", repo: "prontuario", path: "./prontuario/.claude/skills/pedro" },
      ],
    }),
    "utf8",
  );
  return dir;
}

async function writeBatch(dir: string, batch: unknown): Promise<string> {
  const p = join(dir, "batch.json");
  await writeFile(p, JSON.stringify(batch), "utf8");
  return p;
}

test("validate returns 0 for a lawful batch", async () => {
  const dir = await ws();
  try {
    const batch = await writeBatch(dir, [
      { repo: "embark", specialist: "Joaquim" },
      { repo: "prontuario", specialist: "Pedro" },
    ]);
    const code = await run(["validate", "--input", batch, "--workspace", dir]);
    expect(code).toBe(0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("validate returns 1 for a same-repo collision", async () => {
  const dir = await ws();
  try {
    const batch = await writeBatch(dir, [
      { repo: "embark", specialist: "Joaquim" },
      { repo: "embark", specialist: "Joaquim" },
    ]);
    const code = await run(["validate", "--input", batch, "--workspace", dir]);
    expect(code).toBe(1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("validate --journey blocks a consumer whose producer hasn't landed", async () => {
  const dir = await ws();
  try {
    // embark consumes prontuario (a producer); no ledger yet → nothing landed.
    await mkdir(join(dir, ".aipe", "relations"), { recursive: true });
    await writeFile(
      join(dir, ".aipe", "relations", "graph.yaml"),
      stringify({ nodes: [{ fqid: "embark", repo: "embark", package: null, stack: [] }, { fqid: "prontuario", repo: "prontuario", package: null, stack: [] }], edges: [{ from: "embark", to: "prontuario", type: "consumes", perspectives: [{ detail: "d", evidence: "e" }] }] }),
      "utf8",
    );
    await mkdir(join(dir, ".aipe", "journeys"), { recursive: true });
    await writeFile(join(dir, ".aipe", "journeys", "j1.yaml"), stringify({ id: "j1", dispatches: [] }), "utf8");

    const batch = await writeBatch(dir, [{ repo: "embark", specialist: "Joaquim" }]);
    const blocked = await run(["validate", "--input", batch, "--journey", "j1", "--workspace", dir]);
    expect(blocked).toBe(1);

    // once prontuario is verified in the ledger, the consumer is free.
    await writeFile(
      join(dir, ".aipe", "journeys", "j1.yaml"),
      stringify({ id: "j1", dispatches: [{ repo: "prontuario", specialist: "Pedro", branch: "b", worktree: "w", status: "verified", evidence: { by: "qa", commands: ["bun test"], summary: "ok" } }] }),
      "utf8",
    );
    const freed = await run(["validate", "--input", batch, "--journey", "j1", "--workspace", dir]);
    expect(freed).toBe(0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("validate WITHOUT --journey skips the landing gate (backward compatible)", async () => {
  const dir = await ws();
  try {
    await mkdir(join(dir, ".aipe", "relations"), { recursive: true });
    await writeFile(
      join(dir, ".aipe", "relations", "graph.yaml"),
      stringify({ nodes: [{ fqid: "embark", repo: "embark", package: null, stack: [] }, { fqid: "prontuario", repo: "prontuario", package: null, stack: [] }], edges: [{ from: "embark", to: "prontuario", type: "consumes", perspectives: [{ detail: "d", evidence: "e" }] }] }),
      "utf8",
    );
    const batch = await writeBatch(dir, [{ repo: "embark", specialist: "Joaquim" }]);
    const code = await run(["validate", "--input", batch, "--workspace", dir]);
    expect(code).toBe(0); // no --journey → landing gate not applied
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
