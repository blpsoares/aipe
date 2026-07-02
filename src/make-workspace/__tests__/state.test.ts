import { expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse, stringify } from "yaml";
import { updateWorkspacePhase } from "../state";

test("atualiza workspace preservando as outras fases", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-st-"));
  try {
    await mkdir(join(dir, ".aipe"), { recursive: true });
    await writeFile(
      join(dir, ".aipe", "state.yaml"),
      stringify({ phase: { brain: "done", workspace: "pending", relationship: "pending", generator: "pending" } }),
      "utf8",
    );

    const statePath = await updateWorkspacePhase(dir, "done");
    const parsed = parse(await readFile(statePath, "utf8"));
    expect(parsed.phase.workspace).toBe("done");
    expect(parsed.phase.brain).toBe("done");
    expect(parsed.phase.relationship).toBe("pending");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("cria state a partir do default se ausente", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-st-"));
  try {
    const statePath = await updateWorkspacePhase(dir, "pending");
    const parsed = parse(await readFile(statePath, "utf8"));
    expect(parsed.phase.brain).toBe("done");
    expect(parsed.phase.workspace).toBe("pending");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
