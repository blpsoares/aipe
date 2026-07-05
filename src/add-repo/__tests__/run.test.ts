import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse, stringify } from "yaml";
import { addRepo } from "../run";
import type { BrainFile } from "../../context-brain/types";

async function ws(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "aipe-add-"));
  const brain: BrainFile = {
    context: { name: "opvibes", coordinator: "Nicolas" },
    repos: [{ name: "embark", url: "u1", path: "./embark", stack: ["typescript"] }],
  };
  await mkdir(join(dir, ".aipe"), { recursive: true });
  await writeFile(join(dir, ".aipe", "brain.yaml"), stringify(brain), "utf8");
  await writeFile(
    join(dir, ".aipe", "state.yaml"),
    stringify({ phase: { brain: "done", workspace: "done", relationship: "done", specialists: "done" } }),
    "utf8",
  );
  return dir;
}

test("addRepo appends to brain and marks relationship+specialists pending", async () => {
  const dir = await ws();
  try {
    const result = await addRepo(dir, { name: "prontuario", url: "u2", path: "./prontuario", stack: ["python"] });
    expect(result.ok).toBe(true);

    const brain = parse(await readFile(join(dir, ".aipe", "brain.yaml"), "utf8"));
    expect(brain.repos.map((r: { name: string }) => r.name)).toEqual(["embark", "prontuario"]);
    expect(brain.repos[1].stack).toEqual(["python"]);

    const state = parse(await readFile(join(dir, ".aipe", "state.yaml"), "utf8"));
    expect(state.phase.relationship).toBe("pending");
    expect(state.phase.specialists).toBe("pending");
    expect(state.phase.workspace).toBe("done"); // clone is incremental, not reset
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("addRepo rejects duplicate name and duplicate path", async () => {
  const dir = await ws();
  try {
    expect((await addRepo(dir, { name: "embark", url: "u", path: "./x" })).ok).toBe(false);
    expect((await addRepo(dir, { name: "other", url: "u", path: "embark" })).ok).toBe(false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("addRepo errors without a brain", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-add-"));
  try {
    expect((await addRepo(dir, { name: "x", url: "u", path: "./x" })).ok).toBe(false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
