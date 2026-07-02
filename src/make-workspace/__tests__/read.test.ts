import { expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stringify } from "yaml";
import { readBrain } from "../read";
import type { BrainFile } from "../types";

const brain: BrainFile = {
  context: { name: "opvibes", coordinator: "Nicolas" },
  repos: [{ name: "embark", url: "git@github.com:opvibes/embark.git", path: "./embark" }],
};

async function makeWorkspaceDir(brainContent?: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "aipe-mw-"));
  if (brainContent !== undefined) {
    await mkdir(join(dir, ".aipe"), { recursive: true });
    await writeFile(join(dir, ".aipe", "brain.yaml"), brainContent, "utf8");
  }
  return dir;
}

test("lê e valida um brain.yaml bem formado", async () => {
  const dir = await makeWorkspaceDir(stringify(brain));
  try {
    const result = await readBrain(dir);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.brain.context.name).toBe("opvibes");
      expect(result.brain.repos.length).toBe(1);
      expect(result.brain.repos[0]!.url).toBe("git@github.com:opvibes/embark.git");
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("erro quando brain.yaml não existe", async () => {
  const dir = await makeWorkspaceDir();
  try {
    const result = await readBrain(dir);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("brain.yaml");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("erro quando YAML é malformado", async () => {
  const dir = await makeWorkspaceDir(": : : não é yaml :");
  try {
    const result = await readBrain(dir);
    expect(result.ok).toBe(false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("erro quando repos está ausente ou vazio", async () => {
  const dir = await makeWorkspaceDir(stringify({ context: { name: "x", coordinator: "y" }, repos: [] }));
  try {
    const result = await readBrain(dir);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("repos");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
