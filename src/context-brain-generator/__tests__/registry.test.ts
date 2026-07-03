import { expect, test } from "bun:test";
import { parse } from "yaml";
import { buildRegistry, renderPersonasYaml } from "../registry";
import type { BrainFile, PersonaReport } from "../types";

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

test("renderPersonasYaml produces parseable YAML with a personas list", () => {
  const entries = buildRegistry(brain, [{ repo: "embark", role: "qa", name: "Marina", body: "b" }]);
  const parsed = parse(renderPersonasYaml(entries));
  expect(parsed.personas).toHaveLength(2);
  expect(parsed.personas.map((p: { name: string }) => p.name).sort()).toEqual(["Marina", "Nicolas"]);
});
