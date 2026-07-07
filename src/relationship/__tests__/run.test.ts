import { expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile, readFile, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse, stringify } from "yaml";
import { runRelationship } from "../run";
import type { BrainFile } from "../types";

const brain: BrainFile = {
  context: { name: "opvibes", coordinator: "Nicolas" },
  repos: [
    { name: "embark", url: "git@github.com:opvibes/embark.git", path: "./embark" },
    { name: "prontuario", url: "git@github.com:opvibes/prontuario.git", path: "./prontuario" },
  ],
};

async function ws(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "aipe-rel-run-"));
  await mkdir(join(dir, ".aipe"), { recursive: true });
  await writeFile(join(dir, ".aipe", "brain.yaml"), stringify(brain), "utf8");
  await writeFile(
    join(dir, ".aipe", "state.yaml"),
    stringify({ phase: { brain: "done", workspace: "done", relationship: "pending", specialists: "pending" } }),
    "utf8",
  );
  return dir;
}

async function putReport(dir: string, repo: string, content: unknown): Promise<void> {
  const reportsDir = join(dir, ".aipe", "relations", ".reports");
  await mkdir(reportsDir, { recursive: true });
  await writeFile(join(reportsDir, `${repo}.json`), JSON.stringify(content), "utf8");
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

test("all repos reported → phase done, graph/readme written, reports dir cleaned up", async () => {
  const dir = await ws();
  try {
    await putReport(dir, "embark", { repo: "embark", stack: ["typescript"], relations: [{ to: "prontuario", type: "consumes", detail: "d", evidence: "e" }] });
    await putReport(dir, "prontuario", { repo: "prontuario", stack: ["python"], relations: [] });

    const result = await runRelationship(dir);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.phase).toBe("done");
      expect(result.results.every((r) => r.status === "ok")).toBe(true);
    }

    const graph = parse(await readFile(join(dir, ".aipe", "relations", "graph.yaml"), "utf8"));
    expect(graph.edges).toHaveLength(1);

    const readme = await readFile(join(dir, ".aipe", "relations", "README.md"), "utf8");
    expect(readme).toContain("## embark");

    const updatedBrain = parse(await readFile(join(dir, ".aipe", "brain.yaml"), "utf8"));
    expect(updatedBrain.repos.find((r: { name: string }) => r.name === "embark").stack).toEqual(["typescript"]);

    const state = parse(await readFile(join(dir, ".aipe", "state.yaml"), "utf8"));
    expect(state.phase.relationship).toBe("done");

    expect(await exists(join(dir, ".aipe", "relations", ".reports"))).toBe(false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a monorepo report → module nodes persisted by fqid + intra-monorepo edge", async () => {
  const dir = await ws();
  try {
    await putReport(dir, "embark", { repo: "embark", stack: ["typescript"], relations: [] });
    await putReport(dir, "prontuario", {
      repo: "prontuario",
      stack: ["typescript"],
      modules: [
        { id: "api", stack: ["hono"], description: "REST API" },
        { id: "apps/web", stack: ["react"] },
      ],
      relations: [{ from: "apps/web", to: "prontuario/api", type: "consumes", detail: "calls /records", evidence: "web:1" }],
    });

    const result = await runRelationship(dir);
    expect(result.ok && result.phase).toBe("done");

    const graph = parse(await readFile(join(dir, ".aipe", "relations", "graph.yaml"), "utf8"));
    expect(graph.nodes.map((n: { fqid: string }) => n.fqid).sort()).toEqual(["embark", "prontuario/api", "prontuario/apps/web"]);
    expect(graph.edges).toHaveLength(1);
    expect(graph.edges[0].from).toBe("prontuario/apps/web");
    expect(graph.edges[0].to).toBe("prontuario/api");

    const readme = await readFile(join(dir, ".aipe", "relations", "README.md"), "utf8");
    expect(readme).toContain("### prontuario/api");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a missing report → phase pending, reports dir kept for retry", async () => {
  const dir = await ws();
  try {
    await putReport(dir, "embark", { repo: "embark", stack: [], relations: [] });

    const result = await runRelationship(dir);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.phase).toBe("pending");
      expect(result.results.find((r) => r.name === "prontuario")?.status).toBe("missing");
      expect(result.results.find((r) => r.name === "embark")?.status).toBe("ok");
    }

    const state = parse(await readFile(join(dir, ".aipe", "state.yaml"), "utf8"));
    expect(state.phase.relationship).toBe("pending");

    expect(await exists(join(dir, ".aipe", "relations", ".reports", "embark.json"))).toBe(true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("missing brain → ok:false, nothing written", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-rel-run-"));
  try {
    const result = await runRelationship(dir);
    expect(result.ok).toBe(false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("never overwrites a stack already declared in brain.yaml", async () => {
  const dir = await ws();
  try {
    const brainWithStack: BrainFile = {
      ...brain,
      repos: brain.repos.map((r) => (r.name === "embark" ? { ...r, stack: ["ruby"] } : r)),
    };
    await writeFile(join(dir, ".aipe", "brain.yaml"), stringify(brainWithStack), "utf8");
    await putReport(dir, "embark", { repo: "embark", stack: ["typescript"], relations: [] });
    await putReport(dir, "prontuario", { repo: "prontuario", stack: [], relations: [] });

    await runRelationship(dir);

    const updatedBrain = parse(await readFile(join(dir, ".aipe", "brain.yaml"), "utf8"));
    expect(updatedBrain.repos.find((r: { name: string }) => r.name === "embark").stack).toEqual(["ruby"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
