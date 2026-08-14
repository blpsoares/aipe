import { expect, test } from "bun:test";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "yaml";
import { run } from "../cli";

async function ws(): Promise<string> {
  return mkdtemp(join(tmpdir(), "aipe-journey-cli-"));
}

async function capture(fn: () => Promise<number>): Promise<{ code: number; output: string }> {
  const original = console.log;
  const lines: string[] = [];
  console.log = (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  };
  try {
    const code = await fn();
    return { code, output: lines.join("\n") };
  } finally {
    console.log = original;
  }
}

test("journey record rejects an invalid --mode", async () => {
  const dir = await ws();
  await run(["start", "--workspace", dir, "--id", "j1"]);
  const { code, output } = await capture(() =>
    run([
      "record",
      "--workspace", dir,
      "--journey", "j1",
      "--repo", "embark",
      "--specialist", "Joaquim",
      "--branch", "b",
      "--worktree", "w",
      "--mode", "telepathy",
    ]),
  );
  expect(code).toBe(1);
  expect(output).toContain("ERROR mode: --mode must be one of subagent|session");
});

test("journey record rejects an invalid --intensity", async () => {
  const dir = await ws();
  await run(["start", "--workspace", dir, "--id", "j1"]);
  const { code, output } = await capture(() =>
    run([
      "record",
      "--workspace", dir,
      "--journey", "j1",
      "--repo", "embark",
      "--specialist", "Joaquim",
      "--branch", "b",
      "--worktree", "w",
      "--intensity", "extreme",
    ]),
  );
  expect(code).toBe(1);
  expect(output).toContain("ERROR intensity: --intensity must be one of normal|ultracode");
});

test("journey record accepts valid --mode/--intensity/--harness/--session-id and writes them to the ledger", async () => {
  const dir = await ws();
  await run(["start", "--workspace", dir, "--id", "j1"]);
  const code = await run([
    "record",
    "--workspace", dir,
    "--journey", "j1",
    "--repo", "embark",
    "--specialist", "Joaquim",
    "--branch", "b",
    "--worktree", "w",
    "--mode", "session",
    "--intensity", "ultracode",
    "--harness", "claude-code",
    "--session-id", "s-abc",
  ]);
  expect(code).toBe(0);
  const ledger = parse(await readFile(join(dir, ".aipe", "journeys", "j1.yaml"), "utf8"));
  expect(ledger.dispatches[0]).toMatchObject({
    mode: "session",
    intensity: "ultracode",
    harness: "claude-code",
    sessionId: "s-abc",
  });
});
