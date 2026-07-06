import { expect, test } from "bun:test";
import { dedupeReportsByName, resolveNames } from "../naming";
import { repoGroups } from "../groups";
import type { BrainFile, HiringGroup, PersonaReport, ProvidedNames } from "../types";

const brain: BrainFile = {
  context: { name: "opvibes", coordinator: "Nicolas" },
  repos: [
    { name: "embark", url: "git@github.com:opvibes/embark.git", path: "./embark" },
    { name: "prontuario", url: "git@github.com:opvibes/prontuario.git", path: "./prontuario" },
  ],
};

const groups = repoGroups(brain);
const coordinator = brain.context.coordinator;

test("produces exactly 2 personas per repo (dev-fullstack + qa)", () => {
  const result = resolveNames(groups, coordinator, {});
  expect(result.personas).toHaveLength(4);
  expect(result.personas.filter((p) => p.repo === "embark").map((p) => p.role).sort()).toEqual(["dev-fullstack", "qa"]);
  expect(result.personas.filter((p) => p.repo === "prontuario").map((p) => p.role).sort()).toEqual(["dev-fullstack", "qa"]);
});

test("uses PE-provided names when present", () => {
  const provided: ProvidedNames = { embark: { devFullstack: "Joaquim", qa: "Marina" } };
  const result = resolveNames(groups, coordinator, provided);
  const embarkDev = result.personas.find((p) => p.repo === "embark" && p.role === "dev-fullstack");
  const embarkQa = result.personas.find((p) => p.repo === "embark" && p.role === "qa");
  expect(embarkDev?.name).toBe("Joaquim");
  expect(embarkQa?.name).toBe("Marina");
});

test("fills missing names from the built-in pool, never colliding with the coordinator", () => {
  const result = resolveNames(groups, coordinator, {});
  const names = [result.coordinator, ...result.personas.map((p) => p.name)].map((n) => n.toLowerCase());
  expect(new Set(names).size).toBe(names.length);
  expect(result.coordinator).toBe("Nicolas");
});

test("re-picks from the pool when a provided name collides with an already-used name", () => {
  const provided: ProvidedNames = {
    embark: { devFullstack: "Nicolas", qa: null },
    prontuario: { devFullstack: null, qa: null },
  };
  const result = resolveNames(groups, coordinator, provided);
  const embarkDev = result.personas.find((p) => p.repo === "embark" && p.role === "dev-fullstack");
  expect(embarkDev?.name).not.toBe("Nicolas");
  const names = [result.coordinator, ...result.personas.map((p) => p.name)].map((n) => n.toLowerCase());
  expect(new Set(names).size).toBe(names.length);
});

test("hires per module when given module hiring groups (fqid-keyed names)", () => {
  const monoGroups: HiringGroup[] = [
    { fqid: "prontuario/api", repo: "prontuario", module: "api", stack: ["hono"] },
    { fqid: "prontuario/apps/web", repo: "prontuario", module: "apps/web", stack: ["react"] },
  ];
  const provided: ProvidedNames = { "prontuario/api": { devFullstack: "Ana", qa: null } };
  const result = resolveNames(monoGroups, coordinator, provided);
  expect(result.personas).toHaveLength(4);
  const apiDev = result.personas.find((p) => p.fqid === "prontuario/api" && p.role === "dev-fullstack");
  expect(apiDev?.name).toBe("Ana");
  expect(apiDev?.module).toBe("api");
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
