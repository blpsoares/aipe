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

// Finding A (whole-branch review): `journey show`'s open/done tally counted
// neither dispatched/failed/escalated NOR redirected — the whole point of
// `redirected` is to be loud that work is still open and needs the
// coordinator's reconciliation before it ships, so it must count as open.
test("journey show counts a redirected unit as open, not neither open nor done", async () => {
  const dir = await ws();
  await run(["start", "--workspace", dir, "--id", "j1"]);
  await run([
    "record", "--workspace", dir, "--journey", "j1",
    "--repo", "embark", "--specialist", "Joaquim", "--branch", "b", "--worktree", "w",
  ]);
  await run([
    "record", "--workspace", dir, "--journey", "j1",
    "--repo", "embark", "--specialist", "Joaquim", "--branch", "b", "--worktree", "w",
    "--status", "redirected", "--reason", "PE changed direction mid-flight",
  ]);
  const { code, output } = await capture(() => run(["show", "--workspace", dir, "--journey", "j1"]));
  expect(code).toBe(0);
  const lines = output.split("\n");
  expect(lines[0]).toBe("DISPATCH embark Joaquim redirected b -");
  expect(lines[1]).toBe("STATE journey=j1 dispatches=1 open=1 done=0");
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
