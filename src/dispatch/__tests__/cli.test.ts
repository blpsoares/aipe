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

// Identity-per-task: the claim CLI splits the lock by task ONLY for a non-writing
// role; a writing role keeps the unit-level lock even with --task (defense in
// depth — two devs never get concurrency by passing a task).
async function wsWithQa(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "aipe-disp-"));
  const brain: BrainFile = {
    context: { name: "opvibes", coordinator: "Nicolas" },
    repos: [{ name: "embark", url: "git@github.com:o/embark.git", path: "./embark" }],
  };
  await mkdir(join(dir, ".aipe"), { recursive: true });
  await writeFile(join(dir, ".aipe", "brain.yaml"), stringify(brain), "utf8");
  await writeFile(
    join(dir, ".aipe", "personas.yaml"),
    stringify({
      personas: [
        { name: "Joaquim", role: "dev-fullstack", repo: "embark", path: "./embark/.claude/skills/joaquim" },
        { name: "Marina", role: "qa", repo: "embark", path: "./embark/.claude/skills/marina" },
      ],
    }),
    "utf8",
  );
  return dir;
}

async function capture(fn: () => Promise<number>): Promise<{ code: number; out: string }> {
  const orig = console.log;
  const lines: string[] = [];
  console.log = (...a: unknown[]) => lines.push(a.join(" "));
  try {
    const code = await fn();
    return { code, out: lines.join("\n") };
  } finally {
    console.log = orig;
  }
}

test("claim: a QA (non-writing) gets a per-task lock; two tasks both CLAIM", async () => {
  const dir = await wsWithQa();
  try {
    const a = await capture(() => run(["claim", "embark", "--journey", "j1", "--specialist", "Marina", "--task", "gate-pr24", "--workspace", dir]));
    const b = await capture(() => run(["claim", "embark", "--journey", "j1", "--specialist", "Marina", "--task", "gate-pr23", "--workspace", dir]));
    expect(a.code).toBe(0);
    expect(b.code).toBe(0);
    expect(a.out).toContain("task=gate-pr24");
    expect(b.out).toContain("task=gate-pr23");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("claim: a DEV (writing) keeps the unit lock even with --task; a second dev task COLLIDES", async () => {
  const dir = await wsWithQa();
  try {
    const a = await capture(() => run(["claim", "embark", "--journey", "j1", "--specialist", "Joaquim", "--task", "feat-a", "--pid", "0", "--workspace", dir]));
    const b = await capture(() => run(["claim", "embark", "--journey", "j2", "--specialist", "Joaquim", "--task", "feat-b", "--pid", "0", "--workspace", dir]));
    expect(a.code).toBe(0);
    expect(a.out).toContain("NOTE"); // task did not split the lock for a writing role
    expect(b.code).toBe(2); // collision — the unit lock is held, task ignored
    expect(b.out).toContain("COLLISION");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

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

test("validate --journey blocks a consumer whose producer (a unit of this journey) hasn't landed", async () => {
  const dir = await ws();
  try {
    // embark consumes prontuario. prontuario is a UNIT OF THIS JOURNEY —
    // dispatched but not yet landed — so the consumer must wait for it.
    await mkdir(join(dir, ".aipe", "relations"), { recursive: true });
    await writeFile(
      join(dir, ".aipe", "relations", "graph.yaml"),
      stringify({ nodes: [{ fqid: "embark", repo: "embark", package: null, stack: [] }, { fqid: "prontuario", repo: "prontuario", package: null, stack: [] }], edges: [{ from: "embark", to: "prontuario", type: "consumes", perspectives: [{ detail: "d", evidence: "e" }] }] }),
      "utf8",
    );
    await mkdir(join(dir, ".aipe", "journeys"), { recursive: true });
    await writeFile(
      join(dir, ".aipe", "journeys", "j1.yaml"),
      stringify({ id: "j1", dispatches: [{ repo: "prontuario", specialist: "Pedro", branch: "b", worktree: "w", status: "dispatched" }] }),
      "utf8",
    );

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

// D5 (blocking): the landing gate permanently blocked any repo with an inbound
// `consumes` edge to a repo OUTSIDE the journey's demand. graph.yaml records
// `aipe consumes agentistics` (the agentop binary), and agentistics is a node
// in the context-wide graph — but it is NOT a unit of this journey and never
// will be, so it can never reach verified/merged here. The old gate keyed
// "ours to gate" off "is a graph node", so it fired forever, making aipe
// undispatchable. The gate must key off "is an actual unit of THIS journey"
// (the ledger's units + the batch), so an edge to an out-of-demand repo is not
// treated as an unmet dependency. Batch of only `aipe` must validate.
test("validate --journey does NOT block a consumer whose producer is a graph node but not a unit of this journey (D5)", async () => {
  const dir = await ws();
  try {
    // Extend the roster/brain with `aipe` so the batch itself is lawful.
    const brain: BrainFile = {
      context: { name: "opvibes", coordinator: "Nicolas" },
      repos: [
        { name: "aipe", url: "git@github.com:o/aipe.git", path: "./aipe" },
        { name: "agentistics", url: "git@github.com:o/agentistics.git", path: "./agentistics" },
      ],
    };
    await writeFile(join(dir, ".aipe", "brain.yaml"), stringify(brain), "utf8");
    await writeFile(
      join(dir, ".aipe", "personas.yaml"),
      stringify({ personas: [
        { name: "Nicolas", role: "coordinator", repo: null, path: null },
        { name: "Jesse", role: "dev-fullstack", repo: "aipe", path: "./aipe/.claude/skills/jesse" },
      ] }),
      "utf8",
    );
    await mkdir(join(dir, ".aipe", "relations"), { recursive: true });
    // agentistics IS a node in the context-wide graph, and aipe consumes it.
    await writeFile(
      join(dir, ".aipe", "relations", "graph.yaml"),
      stringify({
        nodes: [
          { fqid: "aipe", repo: "aipe", package: null, stack: [] },
          { fqid: "agentistics", repo: "agentistics", package: null, stack: [] },
        ],
        edges: [{ from: "aipe", to: "agentistics", type: "consumes", perspectives: [{ detail: "the agentop binary", evidence: "src/session/runner.ts" }] }],
      }),
      "utf8",
    );
    await mkdir(join(dir, ".aipe", "journeys"), { recursive: true });
    // The journey's demand is ONLY aipe — agentistics is never dispatched here.
    await writeFile(join(dir, ".aipe", "journeys", "j1.yaml"), stringify({ id: "j1", dispatches: [] }), "utf8");

    const batch = await writeBatch(dir, [{ repo: "aipe", specialist: "Jesse" }]);
    const code = await run(["validate", "--input", batch, "--journey", "j1", "--workspace", dir]);
    expect(code).toBe(0); // NOT blocked — agentistics is outside the demand.
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
