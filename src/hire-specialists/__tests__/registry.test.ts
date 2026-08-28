import { expect, test } from "bun:test";
import { parse } from "yaml";
import { buildRegistry, reconcilePersonaPaths, renderPersonasYaml } from "../registry";
import type { BrainFile, PersonaRegistryEntry, PersonaReport } from "../types";

const brain: BrainFile = {
  context: { name: "opvibes", coordinator: "Nicolas" },
  repos: [{ name: "embark", url: "git@github.com:opvibes/embark.git", path: "./embark" }],
};

test("buildRegistry includes the coordinator entry with null repo/path", () => {
  const entries = buildRegistry(brain, []);
  expect(entries).toEqual([{ name: "Nicolas", role: "coordinator", repo: null, path: null }]);
});

test("buildRegistry adds one entry per report with a slugified skill path", () => {
  const reports: PersonaReport[] = [{ repo: "embark", role: "dev-fullstack", name: "Joaquim", body: "b" }];
  const entries = buildRegistry(brain, reports);
  const joaquim = entries.find((e) => e.name === "Joaquim");
  expect(joaquim).toEqual({ name: "Joaquim", role: "dev-fullstack", repo: "embark", path: "./embark/.claude/skills/joaquim" });
});

test("reconcilePersonaPaths rewrites a stale root-layout path to the repos/ path", () => {
  const migrated: BrainFile = {
    context: { name: "opvibes", coordinator: "Nicolas" },
    repos: [{ name: "embark", url: "u", path: "./repos/embark" }],
  };
  const entries: PersonaRegistryEntry[] = [
    { name: "Nicolas", role: "coordinator", repo: null, path: null },
    { name: "Joaquim", role: "dev-fullstack", repo: "embark", path: "./embark/.claude/skills/joaquim" },
  ];
  const { entries: next, changed } = reconcilePersonaPaths(migrated, entries);
  expect(changed).toEqual([
    { name: "Joaquim", from: "./embark/.claude/skills/joaquim", to: "./repos/embark/.claude/skills/joaquim" },
  ]);
  expect(next.find((e) => e.name === "Joaquim")!.path).toBe("./repos/embark/.claude/skills/joaquim");
  // Coordinator row untouched.
  expect(next[0]).toEqual({ name: "Nicolas", role: "coordinator", repo: null, path: null });
});

test("reconcilePersonaPaths is a no-op when paths already agree with the brain", () => {
  const { changed } = reconcilePersonaPaths(brain, [
    { name: "Joaquim", role: "dev-fullstack", repo: "embark", path: "./embark/.claude/skills/joaquim" },
  ]);
  expect(changed).toEqual([]);
});

test("renderPersonasYaml produces parseable YAML with a personas list", () => {
  const entries = buildRegistry(brain, [{ repo: "embark", role: "qa", name: "Marina", body: "b" }]);
  const parsed = parse(renderPersonasYaml(entries));
  expect(parsed.personas).toHaveLength(2);
  expect(parsed.personas.map((p: { name: string }) => p.name).sort()).toEqual(["Marina", "Nicolas"]);
});
