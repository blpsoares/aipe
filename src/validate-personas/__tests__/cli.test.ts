import { expect, test } from "bun:test";
import { renderReport } from "../cli";
import { liveValidationSteps } from "../steps";

test("renderReport prints OK/PROBLEM lines and a STATE summary", () => {
  const lines = renderReport({
    results: [
      { name: "Joaquim", fqid: "embark", repo: "embark", path: "./embark/.claude/skills/joaquim", ok: true, issues: [] },
      { name: "Marina", fqid: "embark", repo: "embark", path: "./embark/.claude/skills/marina", ok: false, issues: ["SKILL.md is missing on disk"] },
    ],
    ready: 1,
    total: 2,
  });
  expect(lines.some((l) => l.startsWith("OK      Joaquim"))).toBe(true);
  expect(lines.some((l) => l.startsWith("PROBLEM Marina") && l.includes("missing on disk"))).toBe(true);
  expect(lines.some((l) => l === "STATE personas-ready=1/2 (1 problem(s))")).toBe(true);
});

test("liveValidationSteps documents the manual live step and expected result", () => {
  const steps = liveValidationSteps();
  expect(steps).toContain("live interactive session");
  expect(steps).toContain("superpowers:brainstorming");
  expect(steps).toContain("Expected result");
  expect(steps).toContain("09-persona-load-order.md");
});
