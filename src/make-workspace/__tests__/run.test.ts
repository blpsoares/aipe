import { expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse, stringify } from "yaml";
import { makeWorkspace } from "../run";
import type { Inspector, Cloner } from "../clone";
import type { BrainFile } from "../types";

const brain: BrainFile = {
  context: { name: "opvibes", coordinator: "Nicolas" },
  repos: [
    { name: "embark", url: "git@github.com:opvibes/embark.git", path: "./embark" },
    { name: "prontuario", url: "git@github.com:opvibes/prontuario.git", path: "./prontuario" },
  ],
};

async function ws(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "aipe-run-"));
  await mkdir(join(dir, ".aipe"), { recursive: true });
  await writeFile(join(dir, ".aipe", "brain.yaml"), stringify(brain), "utf8");
  await writeFile(
    join(dir, ".aipe", "state.yaml"),
    stringify({ phase: { brain: "done", workspace: "pending", relationship: "pending", generator: "pending" } }),
    "utf8",
  );
  return dir;
}

test("todos clonam → phase done e state.workspace=done", async () => {
  const dir = await ws();
  try {
    const inspect: Inspector = async () => ({ exists: false, isGitRepo: false });
    const clone: Cloner = async () => ({ ok: true });
    const result = await makeWorkspace(dir, { inspect, clone });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.phase).toBe("done");
      expect(result.results.map((r) => r.status)).toEqual(["cloned", "cloned"]);
    }
    const state = parse(await readFile(join(dir, ".aipe", "state.yaml"), "utf8"));
    expect(state.phase.workspace).toBe("done");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("um erro → phase pending e state.workspace=pending", async () => {
  const dir = await ws();
  try {
    const inspect: Inspector = async () => ({ exists: false, isGitRepo: false });
    const clone: Cloner = async (url) =>
      url.includes("prontuario") ? { ok: false, message: "Permission denied" } : { ok: true };
    const result = await makeWorkspace(dir, { inspect, clone });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.phase).toBe("pending");
    const state = parse(await readFile(join(dir, ".aipe", "state.yaml"), "utf8"));
    expect(state.phase.workspace).toBe("pending");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("brain ausente → ok:false, state não é tocado", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-run-"));
  try {
    const inspect: Inspector = async () => ({ exists: false, isGitRepo: false });
    const clone: Cloner = async () => ({ ok: true });
    const result = await makeWorkspace(dir, { inspect, clone });
    expect(result.ok).toBe(false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("brain.yaml não é modificado pela execução", async () => {
  const dir = await ws();
  try {
    const before = await readFile(join(dir, ".aipe", "brain.yaml"), "utf8");
    const inspect: Inspector = async () => ({ exists: false, isGitRepo: false });
    const clone: Cloner = async () => ({ ok: true });
    await makeWorkspace(dir, { inspect, clone });
    const after = await readFile(join(dir, ".aipe", "brain.yaml"), "utf8");
    expect(after).toBe(before);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
