import { expect, test } from "bun:test";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initContextBrain } from "../init";
import type { ContextInput } from "../types";

const valid: ContextInput = {
  context: { name: "opvibes", coordinator: "Nicolas" },
  repos: [{ name: "embark", url: "git@github.com:opvibes/embark.git", path: "./embark" }],
};

test("input inválido retorna erros e não grava nada", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-"));
  try {
    const r = await initContextBrain({ ...valid, repos: [] }, dir);
    expect(r.ok).toBe(false);
    await expect(stat(join(dir, ".aipe"))).rejects.toThrow();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("input válido grava os arquivos e retorna os paths", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-"));
  try {
    const r = await initContextBrain(valid, dir);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect((await stat(r.brainPath)).isFile()).toBe(true);
      expect((await stat(r.statePath)).isFile()).toBe(true);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
