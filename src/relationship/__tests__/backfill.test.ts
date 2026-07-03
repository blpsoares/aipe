import { expect, test } from "bun:test";
import { backfillStack } from "../backfill";
import type { BrainFile, RepoReport } from "../types";

const brain: BrainFile = {
  context: { name: "opvibes", coordinator: "Nicolas" },
  repos: [
    { name: "embark", url: "git@github.com:opvibes/embark.git", path: "./embark" },
    { name: "prontuario", url: "git@github.com:opvibes/prontuario.git", path: "./prontuario", stack: ["python"] },
  ],
};

test("fills stack for a repo with none declared", () => {
  const reports: RepoReport[] = [{ repo: "embark", stack: ["typescript", "bun"], relations: [] }];
  const result = backfillStack(brain, reports);
  expect(result.repos.find((r) => r.name === "embark")?.stack).toEqual(["typescript", "bun"]);
});

test("never overwrites a stack the PE already declared", () => {
  const reports: RepoReport[] = [{ repo: "prontuario", stack: ["typescript"], relations: [] }];
  const result = backfillStack(brain, reports);
  expect(result.repos.find((r) => r.name === "prontuario")?.stack).toEqual(["python"]);
});

test("leaves stack empty when there is no report for that repo", () => {
  const result = backfillStack(brain, []);
  expect(result.repos.find((r) => r.name === "embark")?.stack).toBeUndefined();
});

test("does not mutate the input brain", () => {
  const reports: RepoReport[] = [{ repo: "embark", stack: ["typescript"], relations: [] }];
  backfillStack(brain, reports);
  expect(brain.repos.find((r) => r.name === "embark")?.stack).toBeUndefined();
});
