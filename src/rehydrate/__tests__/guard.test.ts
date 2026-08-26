import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "../cli";

test("rehydrate refuses a directory that is not an AIPe workspace", async () => {
  // The harm this prevents: run from $HOME, rehydrate writes the coordinator
  // flow-skills into ~/.claude/skills/ — the user's GLOBAL harness config,
  // loaded by every session on the machine.
  const dir = await mkdtemp(join(tmpdir(), "aipe-rh-guard-"));
  try {
    const code = await run(["--workspace", dir]);
    expect(code).toBe(1);
    // and it wrote nothing at all
    expect(await readdir(dir)).toEqual([]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a bare .aipe/ with no marker is still refused", async () => {
  // ~/.aipe (the machine state dir) is exactly this shape.
  const dir = await mkdtemp(join(tmpdir(), "aipe-rh-bare-"));
  try {
    await mkdir(join(dir, ".aipe"), { recursive: true });
    await writeFile(join(dir, ".aipe", "workspaces.json"), "{}", "utf8");
    expect(await run(["--workspace", dir])).toBe(1);
    expect(await readdir(dir)).toEqual([".aipe"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a real workspace is rehydrated as before", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-rh-ok-"));
  try {
    await mkdir(join(dir, ".aipe"), { recursive: true });
    await writeFile(join(dir, ".aipe", "harness"), "claude-code\n", "utf8");
    expect(await run(["--workspace", dir])).toBe(0);
    expect(await readdir(dir)).toContain(".claude");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
