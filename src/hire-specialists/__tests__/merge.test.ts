import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse, stringify } from "yaml";
import { runHireSpecialistsMerge } from "../run";
import { mergeRegistry } from "../registry";
import type { BrainFile, PersonaRegistryEntry, PersonaReport } from "../types";

const brain2: BrainFile = {
  context: { name: "opvibes", coordinator: "Nicolas" },
  repos: [
    { name: "embark", url: "u", path: "./embark", stack: ["typescript"] },
    { name: "prontuario", url: "u", path: "./prontuario", stack: ["python"] },
  ],
};

test("mergeRegistry keeps existing personas and adds new repo's, deduped", () => {
  const existing: PersonaRegistryEntry[] = [
    { name: "Nicolas", role: "coordinator", repo: null, path: null },
    { name: "Joaquim", role: "dev-fullstack", repo: "embark", path: "./embark/.claude/skills/joaquim" },
    { name: "Marina", role: "qa", repo: "embark", path: "./embark/.claude/skills/marina" },
  ];
  const reports: PersonaReport[] = [
    { repo: "prontuario", role: "dev-fullstack", name: "Pedro", body: "b" },
    { repo: "prontuario", role: "qa", name: "Karen", body: "b" },
  ];
  const merged = mergeRegistry(brain2, existing, reports);
  expect(merged.map((e) => e.name).sort()).toEqual(["Joaquim", "Karen", "Marina", "Nicolas", "Pedro"]);
  expect(merged.filter((e) => e.role === "coordinator")).toHaveLength(1);
});

test("runHireSpecialistsMerge adds a new repo's personas without touching existing ones", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-merge-"));
  try {
    await mkdir(join(dir, ".aipe"), { recursive: true });
    await writeFile(join(dir, ".aipe", "brain.yaml"), stringify(brain2), "utf8");
    await writeFile(
      join(dir, ".aipe", "state.yaml"),
      stringify({ phase: { brain: "done", workspace: "done", relationship: "done", specialists: "pending" } }),
      "utf8",
    );
    // existing roster: embark already hired
    await writeFile(
      join(dir, ".aipe", "personas.yaml"),
      stringify({
        personas: [
          { name: "Nicolas", role: "coordinator", repo: null, path: null },
          { name: "Joaquim", role: "dev-fullstack", repo: "embark", path: "./embark/.claude/skills/joaquim" },
          { name: "Marina", role: "qa", repo: "embark", path: "./embark/.claude/skills/marina" },
        ],
      }),
      "utf8",
    );
    // stage only the new repo's two reports
    const reportsDir = join(dir, ".aipe", "specialists", ".reports");
    await mkdir(reportsDir, { recursive: true });
    await writeFile(join(reportsDir, "prontuario-dev-fullstack.json"), JSON.stringify({ repo: "prontuario", role: "dev-fullstack", name: "Pedro", body: "You are Pedro." }));
    await writeFile(join(reportsDir, "prontuario-qa.json"), JSON.stringify({ repo: "prontuario", role: "qa", name: "Karen", body: "You are Karen." }));

    const result = await runHireSpecialistsMerge(dir);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.phase).toBe("done");

    const roster = parse(await readFile(join(dir, ".aipe", "personas.yaml"), "utf8"));
    expect(roster.personas.map((p: { name: string }) => p.name).sort()).toEqual(["Joaquim", "Karen", "Marina", "Nicolas", "Pedro"]);

    // new persona installed + dual-written
    expect(await readFile(join(dir, "prontuario", ".claude", "skills", "pedro", "SKILL.md"), "utf8")).toContain("You are Pedro.");
    expect(await readFile(join(dir, ".aipe", "personas", "prontuario", "pedro", "SKILL.md"), "utf8")).toContain("You are Pedro.");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
