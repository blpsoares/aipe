import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile } from "node:fs/promises";
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

// item 5 (j-20260829-dp): the jane/Jane split is fixed at WRITE time. Recording
// `jane`+`blpsoares/agentistics` then `Jane`+`agentistics` on the SAME task must
// leave ONE ledger unit, not two — the identity is normalized before the upsert.
test("journey record normalizes repo+specialist so jane/Jane collapse to one unit", async () => {
  const dir = await ws();
  await Bun.write(join(dir, ".aipe", "personas.yaml"), "personas:\n  - name: Jane\n    role: dev-fullstack\n    repo: agentistics\n");
  await run(["start", "--workspace", dir, "--id", "j1"]);
  // the coordinator's write: canonical name, bare repo
  await run(["record", "--workspace", dir, "--journey", "j1", "--repo", "agentistics", "--specialist", "Jane", "--task", "web-ui", "--branch", "aipe/j1/web--jane", "--worktree", "w"]);
  // the specialist's self-registration: slug name, org-prefixed repo
  await run(["record", "--workspace", dir, "--journey", "j1", "--repo", "blpsoares/agentistics", "--specialist", "jane", "--task", "web-ui", "--branch", "aipe/j1/web--jane", "--worktree", "w"]);
  const ledger = parse(await readFile(join(dir, ".aipe", "journeys", "j1.yaml"), "utf8")) as { dispatches: { specialist: string; repo: string }[] };
  expect(ledger.dispatches.length).toBe(1);
  expect(ledger.dispatches[0]!.specialist).toBe("Jane");
  expect(ledger.dispatches[0]!.repo).toBe("agentistics");
});

// The migration reaches an existing duplicate, keeping a merged unit immutable.
test("journey dedupe collapses an on-disk duplicate stuck behind a merged unit", async () => {
  const dir = await ws();
  await Bun.write(join(dir, ".aipe", "personas.yaml"), "personas:\n  - name: Jane\n    role: dev-fullstack\n    repo: agentistics\n");
  await run(["start", "--workspace", dir, "--id", "j1"]);
  // a merged unit (immutable) + a stuck lowercase/org-prefixed dispatched dup on the same branch
  await run(["record", "--workspace", dir, "--journey", "j1", "--repo", "agentistics", "--specialist", "Jane", "--task", "web", "--branch", "aipe/j1/web--jane", "--worktree", "w", "--status", "merged"]);
  await run(["record", "--workspace", dir, "--journey", "j1", "--repo", "blpsoares/agentistics", "--specialist", "jane", "--branch", "aipe/j1/web--jane", "--worktree", "w"]);
  let ledger = parse(await readFile(join(dir, ".aipe", "journeys", "j1.yaml"), "utf8")) as { dispatches: { specialist: string; status: string }[] };
  expect(ledger.dispatches.length).toBe(2); // the dup slipped in (different key before migration)
  const { output } = await capture(() => run(["dedupe", "--workspace", dir]));
  expect(output).toContain("MERGED journey=j1");
  ledger = parse(await readFile(join(dir, ".aipe", "journeys", "j1.yaml"), "utf8")) as { dispatches: { specialist: string; status: string }[] };
  expect(ledger.dispatches.length).toBe(1);
  expect(ledger.dispatches[0]!.status).toBe("merged"); // the merged unit survived, immutable
});

// "nothing searched" ≠ "nothing found": run from a directory that is not a
// workspace (no .aipe/). dedupe must NOT print a zero-count success line the
// operator could read as "all clean" — it must say it found nowhere to look
// and fail visibly. Reverting the guard makes this exit 0 with journeys-changed=0.
test("journey dedupe outside a workspace refuses loudly instead of a false zero", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-not-a-workspace-")); // bare dir, no .aipe/
  const { code, output } = await capture(() => run(["dedupe", "--workspace", dir]));
  expect(code).toBe(1);
  // Must never be mistakable for "nothing to do":
  expect(output).not.toContain("journeys-changed");
  expect(output).not.toContain("STATE dedupe");
  // Must name what it could not resolve:
  expect(output).toContain("ERROR workspace");
  expect(output).toContain(dir);
});

// The guard must not over-trip: a real workspace (.aipe/ present) that simply
// has no journeys yet is a legitimate "nothing found" — exit 0, zero count,
// and it names the workspace it acted on.
test("journey dedupe in a workspace with no journeys is a legitimate zero (exit 0)", async () => {
  const dir = await ws();
  await mkdir(join(dir, ".aipe"), { recursive: true });
  const { code, output } = await capture(() => run(["dedupe", "--workspace", dir]));
  expect(code).toBe(0);
  expect(output).toContain("journeys-changed=0");
  expect(output).toContain(`workspace=${dir}`);
});

// Same defect, worse blast radius: reconcile MUTATES state (marks units merged),
// so a false zero from a non-workspace directory reads as "checked every PR,
// nothing to merge". Run from a bare dir (no .aipe/) it must refuse loudly, not
// print `STATE reconcile checked=0 merged=0` and exit 0. Reverting the guard
// makes this exit 0 with a checked= count.
test("journey reconcile outside a workspace refuses loudly instead of a false zero", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-not-a-workspace-")); // bare dir, no .aipe/
  const { code, output } = await capture(() => run(["reconcile", "--workspace", dir]));
  expect(code).toBe(1);
  // Must never be mistakable for "nothing to reconcile":
  expect(output).not.toContain("checked=");
  expect(output).not.toContain("STATE reconcile");
  // Must name what it could not resolve:
  expect(output).toContain("ERROR workspace");
  expect(output).toContain(dir);
});

// The guard must not over-trip: a real workspace (.aipe/ present) with no
// journeys is a legitimate zero — exit 0 — and, because reconcile changes state,
// it names the workspace it acted on so a wrong target is caught by eye.
test("journey reconcile in a workspace with no journeys is a legitimate zero that names the workspace", async () => {
  const dir = await ws();
  await mkdir(join(dir, ".aipe"), { recursive: true });
  const { code, output } = await capture(() => run(["reconcile", "--workspace", dir]));
  expect(code).toBe(0);
  expect(output).toContain("checked=0");
  expect(output).toContain(`workspace=${dir}`);
});

// Point 3 — a state-changing operation says which workspace it acted on, so a
// wrong target is caught by eye at the moment of the write.
test("journey record names the workspace it wrote to", async () => {
  const dir = await ws();
  await run(["start", "--workspace", dir, "--id", "j1"]);
  const { code, output } = await capture(() =>
    run([
      "record", "--workspace", dir, "--journey", "j1",
      "--repo", "aipe", "--specialist", "Jesse", "--branch", "b", "--worktree", "w",
    ]),
  );
  expect(code).toBe(0);
  expect(output).toContain("OK aipe Jesse dispatched");
  expect(output).toContain(`WORKSPACE ${dir}`);
});
