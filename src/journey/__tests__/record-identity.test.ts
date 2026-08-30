// D3 (j-20260830-w0) — "changing status requires redeclaring identity". Before
// this fix, `aipe journey record --status merged` on an EXISTING dispatch
// still demanded --branch and --worktree be retyped, and a typo there would
// either silently corrupt the record or fork a duplicate row — exactly what
// happened on 2026-08-28 (the coordinator recorded the wrong branch and was
// only caught by luck). Updating an existing dispatch now identifies it by
// journey + repo + unit + specialist + task and inherits branch/worktree from
// the record; a value that IS passed and diverges is a hard error, never a
// silent upsert.
import { expect, test } from "bun:test";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "yaml";
import { run } from "../cli";

async function ws(): Promise<string> {
  return mkdtemp(join(tmpdir(), "aipe-record-identity-"));
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

test("updating an existing dispatch's status works WITHOUT redeclaring --branch/--worktree", async () => {
  const dir = await ws();
  await run(["start", "--workspace", dir, "--id", "j1"]);
  await run([
    "record", "--workspace", dir, "--journey", "j1",
    "--repo", "aipe", "--specialist", "Jesse",
    "--branch", "aipe/j1/jesse__console-reconcile", "--worktree", "/w/console-reconcile",
  ]);

  const { code, output } = await capture(() =>
    run([
      "record", "--workspace", dir, "--journey", "j1",
      "--repo", "aipe", "--specialist", "Jesse",
      "--status", "delivered",
      "--evidence-cmd", "bun test", "--evidence-summary", "all green",
    ]),
  );
  expect(code).toBe(0);
  expect(output).toContain("OK aipe Jesse delivered");

  const ledger = parse(await readFile(join(dir, ".aipe", "journeys", "j1.yaml"), "utf8")) as {
    dispatches: { branch: string; worktree: string; status: string }[];
  };
  expect(ledger.dispatches).toHaveLength(1);
  expect(ledger.dispatches[0]!.status).toBe("delivered");
  // The identity fields were INHERITED from the original record, not lost.
  expect(ledger.dispatches[0]!.branch).toBe("aipe/j1/jesse__console-reconcile");
  expect(ledger.dispatches[0]!.worktree).toBe("/w/console-reconcile");
});

test("passing a DIVERGENT --branch on an existing dispatch is REJECTED — never silently recorded, never forked into a new row", async () => {
  const dir = await ws();
  await run(["start", "--workspace", dir, "--id", "j1"]);
  await run([
    "record", "--workspace", dir, "--journey", "j1",
    "--repo", "aipe", "--specialist", "Jesse",
    "--branch", "aipe/j1/jesse__console-reconcile", "--worktree", "/w/console-reconcile",
  ]);

  const { code, output } = await capture(() =>
    run([
      "record", "--workspace", dir, "--journey", "j1",
      "--repo", "aipe", "--specialist", "Jesse",
      "--branch", "aipe/j1/jesse__redesign-build", "--worktree", "/w/console-reconcile",
      "--status", "delivered",
      "--evidence-cmd", "bun test", "--evidence-summary", "all green",
    ]),
  );
  expect(code).toBe(1);
  expect(output).toContain("REJECT branch-mismatch");
  expect(output).toContain("aipe/j1/jesse__console-reconcile");
  expect(output).toContain("aipe/j1/jesse__redesign-build");

  const ledger = parse(await readFile(join(dir, ".aipe", "journeys", "j1.yaml"), "utf8")) as {
    dispatches: { branch: string; status: string }[];
  };
  // Untouched: no second row, no corrupted branch on the first.
  expect(ledger.dispatches).toHaveLength(1);
  expect(ledger.dispatches[0]!.branch).toBe("aipe/j1/jesse__console-reconcile");
  expect(ledger.dispatches[0]!.status).toBe("dispatched");
});

test("passing a DIVERGENT --worktree on an existing dispatch is REJECTED the same way", async () => {
  const dir = await ws();
  await run(["start", "--workspace", dir, "--id", "j1"]);
  await run([
    "record", "--workspace", dir, "--journey", "j1",
    "--repo", "aipe", "--specialist", "Jesse",
    "--branch", "aipe/j1/jesse", "--worktree", "/w/right",
  ]);

  const { code, output } = await capture(() =>
    run([
      "record", "--workspace", dir, "--journey", "j1",
      "--repo", "aipe", "--specialist", "Jesse",
      "--worktree", "/w/wrong",
      "--status", "delivered",
      "--evidence-cmd", "bun test", "--evidence-summary", "all green",
    ]),
  );
  expect(code).toBe(1);
  expect(output).toContain("REJECT worktree-mismatch");
});

test("a genuinely NEW dispatch (no existing record) still requires --branch and --worktree", async () => {
  const dir = await ws();
  await run(["start", "--workspace", dir, "--id", "j1"]);
  const { code, output } = await capture(() =>
    run(["record", "--workspace", dir, "--journey", "j1", "--repo", "aipe", "--specialist", "Jesse"]),
  );
  expect(code).toBe(1);
  expect(output).toContain("ERROR args: --branch and --worktree are required");
});

test("--journey/--repo/--specialist are always required, even before identity resolution", async () => {
  const dir = await ws();
  await run(["start", "--workspace", dir, "--id", "j1"]);
  const { code, output } = await capture(() => run(["record", "--workspace", dir, "--journey", "j1"]));
  expect(code).toBe(1);
  expect(output).toContain("ERROR args: --journey, --repo and --specialist are required");
});

test("matching --branch/--worktree on an existing dispatch (no divergence) still works exactly as before", async () => {
  const dir = await ws();
  await run(["start", "--workspace", dir, "--id", "j1"]);
  await run([
    "record", "--workspace", dir, "--journey", "j1",
    "--repo", "aipe", "--specialist", "Jesse",
    "--branch", "aipe/j1/jesse", "--worktree", "/w/right",
  ]);
  const { code } = await capture(() =>
    run([
      "record", "--workspace", dir, "--journey", "j1",
      "--repo", "aipe", "--specialist", "Jesse",
      "--branch", "aipe/j1/jesse", "--worktree", "/w/right",
      "--status", "delivered",
      "--evidence-cmd", "bun test", "--evidence-summary", "all green",
    ]),
  );
  expect(code).toBe(0);
});

// Identity is scoped by TASK too (j-20260826-uv): two dispatches sharing a
// unit but on DIFFERENT tasks must never be confused for one another when
// inheriting branch/worktree.
test("identity is scoped by --task — a status update for one task never inherits another task's branch/worktree", async () => {
  const dir = await ws();
  await run(["start", "--workspace", dir, "--id", "j1"]);
  await run([
    "record", "--workspace", dir, "--journey", "j1",
    "--repo", "aipe", "--specialist", "Jesse", "--task", "task-a",
    "--branch", "aipe/j1/task-a", "--worktree", "/w/task-a",
  ]);

  const { code, output } = await capture(() =>
    run(["record", "--workspace", dir, "--journey", "j1", "--repo", "aipe", "--specialist", "Jesse", "--task", "task-b"]),
  );
  expect(code).toBe(1);
  expect(output).toContain("ERROR args: --branch and --worktree are required");
});
