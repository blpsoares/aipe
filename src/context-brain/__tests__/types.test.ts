import { expect, test } from "bun:test";
import type { BrainFile } from "../types";

test("BrainFile aceita um contexto bem-formado", () => {
  const brain: BrainFile = {
    context: { name: "opvibes", coordinator: "Nicolas" },
    repos: [{ name: "embark", url: "git@github.com:opvibes/embark.git", path: "./embark" }],
  };
  expect(brain.repos.length).toBe(1);
});
