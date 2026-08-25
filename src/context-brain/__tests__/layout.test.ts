import { expect, test } from "bun:test";
import {
  defaultRepoPath,
  isLegacyLayout,
  isLegacyRepoPath,
  legacyRepos,
  normalizePath,
  normalizeRepoPaths,
} from "../layout";
import type { ContextInput } from "../types";

test("a repo declared without a path defaults to repos/<name>", () => {
  const input: ContextInput = {
    context: { name: "opvibes", coordinator: "Nicolas" },
    repos: [{ name: "embark", url: "git@github.com:opvibes/embark.git" }],
  };
  expect(normalizeRepoPaths(input).repos[0]?.path).toBe("./repos/embark");
});

test("an explicit path is never rewritten — legacy or not", () => {
  const input: ContextInput = {
    context: { name: "opvibes", coordinator: "Nicolas" },
    repos: [
      { name: "embark", url: "git@x:o/embark.git", path: "./embark" },
      { name: "billing", url: "git@x:o/billing.git", path: "./services/billing" },
    ],
  };
  const repos = normalizeRepoPaths(input).repos;
  expect(repos[0]?.path).toBe("./embark");
  expect(repos[1]?.path).toBe("./services/billing");
});

test("a nameless repo is left for validation to reject, not defaulted", () => {
  const input: ContextInput = {
    context: { name: "opvibes", coordinator: "Nicolas" },
    repos: [{ name: "  ", url: "git@x:o/e.git" }],
  };
  expect(normalizeRepoPaths(input).repos[0]?.path).toBeUndefined();
});

test("only a single-segment path counts as the legacy layout", () => {
  expect(isLegacyRepoPath("./embark")).toBe(true);
  expect(isLegacyRepoPath("embark")).toBe(true);
  expect(isLegacyRepoPath("./repos/embark")).toBe(false);
  expect(isLegacyRepoPath("./services/billing")).toBe(false);
  expect(isLegacyRepoPath("")).toBe(false);
});

test("normalizePath strips ./ and trailing slashes", () => {
  expect(normalizePath("./repos/embark/")).toBe("repos/embark");
});

test("a workspace is legacy only when EVERY repo sits at the root", () => {
  const rooted = [{ name: "a", path: "./a" }, { name: "b", path: "./b" }];
  const mixed = [{ name: "a", path: "./a" }, { name: "b", path: "./repos/b" }];
  expect(isLegacyLayout(rooted)).toBe(true);
  expect(isLegacyLayout(mixed)).toBe(false);
  expect(isLegacyLayout([])).toBe(false);
  expect(legacyRepos(mixed)).toEqual(["a"]);
});
