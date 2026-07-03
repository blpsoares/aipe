import { expect, test } from "bun:test";
import { personaSlug, renderSkillMd } from "../render";
import type { PersonaReport } from "../types";

test("personaSlug lowercases and hyphenates a name", () => {
  expect(personaSlug("Joaquim")).toBe("joaquim");
  expect(personaSlug("Ana Maria")).toBe("ana-maria");
  expect(personaSlug(" -Zé- ")).toBe("ze");
});

test("renderSkillMd produces frontmatter with the slugified name", () => {
  const report: PersonaReport = { repo: "embark", role: "dev-fullstack", name: "Joaquim", body: "You are Joaquim." };
  const md = renderSkillMd(report, ["typescript", "bun"]);
  expect(md).toContain("name: joaquim");
  expect(md).toContain("description: Fullstack specialist for the embark repo (typescript, bun).");
  expect(md).toContain("You are Joaquim.");
});

test("renderSkillMd uses the QA label for qa role", () => {
  const report: PersonaReport = { repo: "embark", role: "qa", name: "Marina", body: "You are Marina." };
  const md = renderSkillMd(report, ["typescript"]);
  expect(md).toContain("description: QA specialist for the embark repo (typescript).");
});

test("renderSkillMd falls back to 'unknown stack' when stack is empty", () => {
  const report: PersonaReport = { repo: "embark", role: "dev-fullstack", name: "Joaquim", body: "body" };
  const md = renderSkillMd(report, []);
  expect(md).toContain("(unknown stack)");
});

test("renderSkillMd starts with YAML frontmatter delimiters", () => {
  const report: PersonaReport = { repo: "embark", role: "qa", name: "Marina", body: "body" };
  const md = renderSkillMd(report, ["typescript"]);
  const lines = md.split("\n");
  expect(lines[0]).toBe("---");
  expect(lines.slice(1).findIndex((l) => l === "---")).toBeGreaterThan(0);
});
