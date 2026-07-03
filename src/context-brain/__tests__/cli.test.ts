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

async function runCliRaw(rawInput: string, workspace: string) {
  const inputPath = join(workspace, "input.json");
  await writeFile(inputPath, rawInput, "utf8");
  const proc = Bun.spawn(["bun", CLI, "--input", inputPath, "--workspace", workspace], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const exitCode = await proc.exited;
  const stdout = await new Response(proc.stdout).text();
  return { exitCode, stdout };
}

test("CLI writes the files and exits 0 on valid input", async () => {
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

test("CLI exits 1 and prints errors on invalid input", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-"));
  try {
    const { exitCode, stdout } = await runCli(
      { context: { name: "opvibes", coordinator: "Nicolas" }, repos: [] },
      dir,
    );
    expect(exitCode).toBe(1);
    expect(stdout).toContain("ERROR repos:");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("CLI exits 1 and prints ERROR input: for malformed JSON", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-"));
  try {
    const { exitCode, stdout } = await runCliRaw("{ not json", dir);
    expect(exitCode).toBe(1);
    expect(stdout).toContain("ERROR input:");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("CLI exits 1 and prints ERROR input: for top-level null JSON", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-"));
  try {
    const { exitCode, stdout } = await runCliRaw("null", dir);
    expect(exitCode).toBe(1);
    expect(stdout).toContain("ERROR input:");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
