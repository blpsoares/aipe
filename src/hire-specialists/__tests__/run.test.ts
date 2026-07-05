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
