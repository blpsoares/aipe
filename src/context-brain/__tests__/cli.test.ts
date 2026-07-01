import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CLI = join(import.meta.dir, "..", "cli.ts");

async function runCli(inputJson: unknown, workspace: string) {
  const inputPath = join(workspace, "input.json");
  await writeFile(inputPath, JSON.stringify(inputJson), "utf8");
  const proc = Bun.spawn(["bun", CLI, "--input", inputPath, "--workspace", workspace], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const exitCode = await proc.exited;
  const stdout = await new Response(proc.stdout).text();
  return { exitCode, stdout };
}

test("CLI grava os arquivos e sai com 0 em input válido", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-"));
  try {
    const { exitCode, stdout } = await runCli(
      {
        context: { name: "opvibes", coordinator: "Nicolas" },
        repos: [{ name: "embark", url: "git@github.com:opvibes/embark.git", path: "./embark" }],
      },
      dir,
    );
    expect(exitCode).toBe(0);
    expect(stdout).toContain("OK brain=");
    expect(stdout).toContain("OK state=");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("CLI sai com 1 e imprime erros em input inválido", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-"));
  try {
    const { exitCode, stdout } = await runCli(
      { context: { name: "opvibes", coordinator: "Nicolas" }, repos: [] },
      dir,
    );
    expect(exitCode).toBe(1);
    expect(stdout).toContain("ERRO repos:");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
