import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stringify } from "yaml";
import { run } from "../cli";
import type { BrainFile } from "../../context-brain/types";

async function ws(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "aipe-disp-"));
  const brain: BrainFile = {
    context: { name: "opvibes", coordinator: "Nicolas" },
    repos: [
      { name: "embark", url: "git@github.com:o/embark.git", path: "./embark" },
      { name: "prontuario", url: "git@github.com:o/prontuario.git", path: "./prontuario" },
    ],
  };
  await mkdir(join(dir, ".aipe"), { recursive: true });
  await writeFile(join(dir, ".aipe", "brain.yaml"), stringify(brain), "utf8");
  await writeFile(
    join(dir, ".aipe", "personas.yaml"),
    stringify({
      personas: [
        { name: "Nicolas", role: "coordinator", repo: null, path: null },
        { name: "Joaquim", role: "dev-fullstack", repo: "embark", path: "./embark/.claude/skills/joaquim" },
        { name: "Pedro", role: "dev-fullstack", repo: "prontuario", path: "./prontuario/.claude/skills/pedro" },
      ],
    }),
    "utf8",
  );
  return dir;
}

async function writeBatch(dir: string, batch: unknown): Promise<string> {
  const p = join(dir, "batch.json");
  await writeFile(p, JSON.stringify(batch), "utf8");
  return p;
}

test("validate returns 0 for a lawful batch", async () => {
  const dir = await ws();
  try {
    const batch = await writeBatch(dir, [
      { repo: "embark", specialist: "Joaquim" },
      { repo: "prontuario", specialist: "Pedro" },
    ]);
    const code = await run(["validate", "--input", batch, "--workspace", dir]);
    expect(code).toBe(0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("validate returns 1 for a same-repo collision", async () => {
  const dir = await ws();
  try {
    const batch = await writeBatch(dir, [
      { repo: "embark", specialist: "Joaquim" },
      { repo: "embark", specialist: "Joaquim" },
    ]);
    const code = await run(["validate", "--input", batch, "--workspace", dir]);
    expect(code).toBe(1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
