import { expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse, stringify } from "yaml";
import { updateSpecialistsPhase } from "../state";

test("updates specialists preserving the other phases", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-genst-"));
  try {
    await mkdir(join(dir, ".aipe"), { recursive: true });
    await writeFile(
      join(dir, ".aipe", "state.yaml"),
      stringify({ phase: { brain: "done", workspace: "done", relationship: "done", specialists: "pending" } }),
      "utf8",
    );

    const statePath = await updateSpecialistsPhase(dir, "done");
    const parsed = parse(await readFile(statePath, "utf8"));
    expect(parsed.phase.specialists).toBe("done");
    expect(parsed.phase.relationship).toBe("done");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("creates state from the default if missing", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-genst-"));
  try {
    const statePath = await updateSpecialistsPhase(dir, "pending");
    const parsed = parse(await readFile(statePath, "utf8"));
    expect(parsed.phase.brain).toBe("done");
    expect(parsed.phase.specialists).toBe("pending");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
