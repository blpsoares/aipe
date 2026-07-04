import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "yaml";
import { initialState, writeBrainFiles } from "../write";
import type { BrainFile } from "../types";

const brain: BrainFile = {
  context: { name: "opvibes", coordinator: "Nicolas" },
  repos: [{ name: "embark", url: "git@github.com:opvibes/embark.git", path: "./embark", stack: ["typescript", "bun"] }],
};

test("initialState marks brain as done and the rest as pending", () => {
  expect(initialState()).toEqual({
    phase: { brain: "done", workspace: "pending", relationship: "pending", specialists: "pending" },
  });
});

test("writes brain.yaml and state.yaml in .aipe and they are valid YAML", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-"));
  try {
    const { brainPath, statePath } = await writeBrainFiles(dir, brain);
    expect(brainPath).toBe(join(dir, ".aipe", "brain.yaml"));
    expect(statePath).toBe(join(dir, ".aipe", "state.yaml"));

    const brainParsed = parse(await readFile(brainPath, "utf8"));
    expect(brainParsed.context.name).toBe("opvibes");
    expect(brainParsed.repos[0].stack).toEqual(["typescript", "bun"]);

    const stateParsed = parse(await readFile(statePath, "utf8"));
    expect(stateParsed.phase.brain).toBe("done");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
