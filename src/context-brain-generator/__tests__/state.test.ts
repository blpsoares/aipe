import { expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse, stringify } from "yaml";
import { updateGeneratorPhase } from "../state";

test("updates generator preserving the other phases", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-genst-"));
  try {
    await mkdir(join(dir, ".aipe"), { recursive: true });
    await writeFile(
      join(dir, ".aipe", "state.yaml"),
      stringify({ phase: { brain: "done", workspace: "done", relationship: "done", generator: "pending" } }),
      "utf8",
    );

    const statePath = await updateGeneratorPhase(dir, "done");
    const parsed = parse(await readFile(statePath, "utf8"));
    expect(parsed.phase.generator).toBe("done");
    expect(parsed.phase.relationship).toBe("done");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("creates state from the default if missing", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-genst-"));
  try {
    const statePath = await updateGeneratorPhase(dir, "pending");
    const parsed = parse(await readFile(statePath, "utf8"));
    expect(parsed.phase.brain).toBe("done");
    expect(parsed.phase.generator).toBe("pending");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
