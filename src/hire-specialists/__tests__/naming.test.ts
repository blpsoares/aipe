import { expect, test } from "bun:test";
import { dedupeReportsByName, resolveNames } from "../naming";
import type { BrainFile, PersonaReport, ProvidedNames } from "../types";

const brain: BrainFile = {
  context: { name: "opvibes", coordinator: "Nicolas" },
  repos: [
    { name: "embark", url: "git@github.com:opvibes/embark.git", path: "./embark" },
    { name: "prontuario", url: "git@github.com:opvibes/prontuario.git", path: "./prontuario" },
  ],
};

test("produces exactly 2 personas per repo (dev-fullstack + qa)", () => {
  const result = resolveNames(brain, {});
  expect(result.personas).toHaveLength(4);
  expect(result.personas.filter((p) => p.repo === "embark").map((p) => p.role).sort()).toEqual(["dev-fullstack", "qa"]);
  expect(result.personas.filter((p) => p.repo === "prontuario").map((p) => p.role).sort()).toEqual(["dev-fullstack", "qa"]);
});

test("uses PE-provided names when present", () => {
  const provided: ProvidedNames = { embark: { devFullstack: "Joaquim", qa: "Marina" } };
  const result = resolveNames(brain, provided);
  const embarkDev = result.personas.find((p) => p.repo === "embark" && p.role === "dev-fullstack");
  const embarkQa = result.personas.find((p) => p.repo === "embark" && p.role === "qa");
  expect(embarkDev?.name).toBe("Joaquim");
  expect(embarkQa?.name).toBe("Marina");
});

test("fills missing names from the built-in pool, never colliding with the coordinator", () => {
  const result = resolveNames(brain, {});
  const names = [result.coordinator, ...result.personas.map((p) => p.name)].map((n) => n.toLowerCase());
  expect(new Set(names).size).toBe(names.length);
  expect(result.coordinator).toBe("Nicolas");
});

test("re-picks from the pool when a provided name collides with an already-used name", () => {
  const provided: ProvidedNames = {
    embark: { devFullstack: "Nicolas", qa: null },
    prontuario: { devFullstack: null, qa: null },
  };
  const result = resolveNames(brain, provided);
  const embarkDev = result.personas.find((p) => p.repo === "embark" && p.role === "dev-fullstack");
  expect(embarkDev?.name).not.toBe("Nicolas");
  const names = [result.coordinator, ...result.personas.map((p) => p.name)].map((n) => n.toLowerCase());
  expect(new Set(names).size).toBe(names.length);
});

test("dedupeReportsByName keeps the first occurrence of a duplicate name", () => {
  const reports: PersonaReport[] = [
    { repo: "embark", role: "dev-fullstack", name: "Joaquim", body: "first" },
    { repo: "prontuario", role: "dev-fullstack", name: "Joaquim", body: "second" },
  ];
  const kept = dedupeReportsByName(reports, "Nicolas");
  expect(kept).toHaveLength(1);
  expect(kept[0]?.body).toBe("first");
});

test("dedupeReportsByName drops a report whose name matches the coordinator's, case-insensitively", () => {
  const reports: PersonaReport[] = [{ repo: "embark", role: "qa", name: "nicolas", body: "oops" }];
  const kept = dedupeReportsByName(reports, "Nicolas");
  expect(kept).toHaveLength(0);
});
