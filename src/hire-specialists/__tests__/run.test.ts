import { expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile, readFile, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse, stringify } from "yaml";
import { resolvePersonaNames, runHireSpecialists } from "../run";
import type { BrainFile } from "../types";

const brain: BrainFile = {
  context: { name: "opvibes", coordinator: "Nicolas" },
  repos: [
    { name: "embark", url: "git@github.com:opvibes/embark.git", path: "./embark", stack: ["typescript"] },
    { name: "prontuario", url: "git@github.com:opvibes/prontuario.git", path: "./prontuario", stack: ["python"] },
  ],
};

async function ws(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "aipe-gen-run-"));
  await mkdir(join(dir, ".aipe"), { recursive: true });
  await writeFile(join(dir, ".aipe", "brain.yaml"), stringify(brain), "utf8");
  await writeFile(
    join(dir, ".aipe", "state.yaml"),
    stringify({ phase: { brain: "done", workspace: "done", relationship: "done", specialists: "pending" } }),
    "utf8",
  );
  return dir;
}

async function putReport(dir: string, repo: string, role: string, content: unknown): Promise<void> {
  const reportsDir = join(dir, ".aipe", "specialists", ".reports");
  await mkdir(reportsDir, { recursive: true });
  await writeFile(join(reportsDir, `${repo}-${role}.json`), JSON.stringify(content), "utf8");
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

test("resolvePersonaNames returns 4 assignments for a 2-repo brain", async () => {
  const dir = await ws();
  try {
    const result = await resolvePersonaNames(dir, {});
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.result.personas).toHaveLength(4);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("resolvePersonaNames propagates a missing brain as an error", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-gen-run-"));
  try {
    const result = await resolvePersonaNames(dir, {});
    expect(result.ok).toBe(false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("all (repo, role) pairs reported → phase done, SKILL.md files written, personas.yaml written, reports dir cleaned up", async () => {
  const dir = await ws();
  try {
    await putReport(dir, "embark", "dev-fullstack", { repo: "embark", role: "dev-fullstack", name: "Joaquim", body: "You are Joaquim." });
    await putReport(dir, "embark", "qa", { repo: "embark", role: "qa", name: "Marina", body: "You are Marina." });
    await putReport(dir, "prontuario", "dev-fullstack", { repo: "prontuario", role: "dev-fullstack", name: "Pedro", body: "You are Pedro." });
    await putReport(dir, "prontuario", "qa", { repo: "prontuario", role: "qa", name: "Karen", body: "You are Karen." });

    const result = await runHireSpecialists(dir);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.phase).toBe("done");
      expect(result.results.every((r) => r.status === "ok")).toBe(true);
    }

    const skillMd = await readFile(join(dir, "embark", ".claude", "skills", "joaquim", "SKILL.md"), "utf8");
    expect(skillMd).toContain("You are Joaquim.");
    expect(skillMd).toContain("Fullstack specialist for the embark repo (typescript).");

    // dual-write: a committed source-of-truth copy under .aipe/personas/ for portability
    const source = await readFile(join(dir, ".aipe", "personas", "embark", "joaquim", "SKILL.md"), "utf8");
    expect(source).toContain("You are Joaquim.");

    const registry = parse(await readFile(join(dir, ".aipe", "personas.yaml"), "utf8"));
    expect(registry.personas).toHaveLength(5); // coordinator + 4 personas

    const state = parse(await readFile(join(dir, ".aipe", "state.yaml"), "utf8"));
    expect(state.phase.specialists).toBe("done");

    expect(await exists(join(dir, ".aipe", "specialists", ".reports"))).toBe(false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

async function putGraph(dir: string, nodes: unknown[]): Promise<void> {
  const relDir = join(dir, ".aipe", "relations");
  await mkdir(relDir, { recursive: true });
  await writeFile(join(relDir, "graph.yaml"), stringify({ nodes, edges: [] }), "utf8");
}

test("hires per module when the graph has module nodes (monorepo)", async () => {
  const dir = await ws();
  try {
    // A single monorepo `prontuario` with two modules → 4 personas, not 2.
    const monoBrain: BrainFile = {
      context: { name: "opvibes", coordinator: "Nicolas" },
      repos: [{ name: "prontuario", url: "git@github.com:opvibes/prontuario.git", path: "./prontuario", stack: ["typescript"] }],
    };
    await writeFile(join(dir, ".aipe", "brain.yaml"), stringify(monoBrain), "utf8");
    await putGraph(dir, [
      { fqid: "prontuario/api", repo: "prontuario", module: "api", stack: ["hono"] },
      { fqid: "prontuario/web", repo: "prontuario", module: "web", stack: ["react"] },
    ]);

    await putReport(dir, "api-dev", "x", { repo: "prontuario", module: "api", role: "dev-fullstack", name: "Ana", body: "You are Ana." });
    await putReport(dir, "api-qa", "x", { repo: "prontuario", module: "api", role: "qa", name: "Bia", body: "You are Bia." });
    await putReport(dir, "web-dev", "x", { repo: "prontuario", module: "web", role: "dev-fullstack", name: "Caio", body: "You are Caio." });
    await putReport(dir, "web-qa", "x", { repo: "prontuario", module: "web", role: "qa", name: "Duda", body: "You are Duda." });

    const result = await runHireSpecialists(dir);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.phase).toBe("done");
      expect(result.results).toHaveLength(4);
    }

    // Ana's skill is grounded in the api module and its own stack.
    const ana = await readFile(join(dir, "prontuario", ".claude", "skills", "ana", "SKILL.md"), "utf8");
    expect(ana).toContain("You are Ana.");
    expect(ana).toContain("for the prontuario/api module (hono).");

    const registry = parse(await readFile(join(dir, ".aipe", "personas.yaml"), "utf8"));
    expect(registry.personas).toHaveLength(5); // coordinator + 4
    const anaEntry = registry.personas.find((p: { name: string }) => p.name === "Ana");
    expect(anaEntry.fqid).toBe("prontuario/api");
    expect(anaEntry.module).toBe("api");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a generic-harness workspace writes personas in the AGENTS format + location", async () => {
  const dir = await ws();
  try {
    await writeFile(join(dir, ".aipe", "harness"), "generic\n", "utf8");
    await putReport(dir, "embark", "dev-fullstack", { repo: "embark", role: "dev-fullstack", name: "Joaquim", body: "You are Joaquim." });
    await putReport(dir, "embark", "qa", { repo: "embark", role: "qa", name: "Marina", body: "You are Marina." });
    await putReport(dir, "prontuario", "dev-fullstack", { repo: "prontuario", role: "dev-fullstack", name: "Pedro", body: "You are Pedro." });
    await putReport(dir, "prontuario", "qa", { repo: "prontuario", role: "qa", name: "Karen", body: "You are Karen." });

    await runHireSpecialists(dir);

    // repo copy is the generic AGENTS-style file, not a .claude SKILL.md
    const persona = await readFile(join(dir, "embark", ".aipe-personas", "joaquim.md"), "utf8");
    expect(persona).toContain("# joaquim");
    expect(persona).toContain("You are Joaquim.");
    expect(persona.startsWith("---")).toBe(false);

    // the published source-of-truth copy stays in the canonical SKILL.md format
    const source = await readFile(join(dir, ".aipe", "personas", "embark", "joaquim", "SKILL.md"), "utf8");
    expect(source).toContain("name: joaquim");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a missing (repo, role) report → phase pending, reports dir kept for retry", async () => {
  const dir = await ws();
  try {
    await putReport(dir, "embark", "dev-fullstack", { repo: "embark", role: "dev-fullstack", name: "Joaquim", body: "b" });

    const result = await runHireSpecialists(dir);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.phase).toBe("pending");
      expect(result.results.find((r) => r.repo === "embark" && r.role === "qa")?.status).toBe("missing");
      expect(result.results.find((r) => r.repo === "embark" && r.role === "dev-fullstack")?.status).toBe("ok");
    }

    expect(await exists(join(dir, ".aipe", "specialists", ".reports", "embark-dev-fullstack.json"))).toBe(true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("missing brain → ok:false, nothing written", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-gen-run-"));
  try {
    const result = await runHireSpecialists(dir);
    expect(result.ok).toBe(false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
