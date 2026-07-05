import { expect, test } from "bun:test";
import { matchSkills } from "../routing";
import { emptyToolbox } from "../types";
import type { Toolbox } from "../types";

function tb(): Toolbox {
  const t = emptyToolbox();
  t.skills = [
    {
      name: "sdd",
      description: "d",
      objective: "o",
      whenToUse: "big features only",
      repos: ["embark"],
      routing: { taskTypes: ["feature", "refactor"], skipFor: ["styling", "copy"], minSize: "large" },
    },
    { name: "lint-kit", description: "d", objective: "o", whenToUse: "anytime", repos: ["embark"] }, // no routing → always
  ];
  return t;
}

test("a styling task skips SDD but keeps the un-routed skill", () => {
  const matched = matchSkills(tb(), { taskType: "styling", size: "small" });
  expect(matched.map((s) => s.name)).toEqual(["lint-kit"]);
});

test("a large feature matches SDD", () => {
  const matched = matchSkills(tb(), { taskType: "feature", size: "large" });
  expect(matched.map((s) => s.name).sort()).toEqual(["lint-kit", "sdd"]);
});

test("a small feature is below SDD's minSize", () => {
  const matched = matchSkills(tb(), { taskType: "feature", size: "small" });
  expect(matched.map((s) => s.name)).toEqual(["lint-kit"]);
});

test("a task type outside SDD's taskTypes doesn't match it", () => {
  const matched = matchSkills(tb(), { taskType: "docs", size: "large" });
  expect(matched.map((s) => s.name)).toEqual(["lint-kit"]);
});

test("no task shape → everything matches", () => {
  expect(matchSkills(tb(), {}).map((s) => s.name).sort()).toEqual(["lint-kit", "sdd"]);
});
