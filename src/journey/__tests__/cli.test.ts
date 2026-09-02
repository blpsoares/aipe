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
  // Reaching `merged` now requires the real lifecycle — a delivery and an
  // independent QA pass — so the fixture walks it instead of teleporting the row
  // there. What this test is about is unchanged: the duplicate stuck BEHIND a
  // merged unit.
  const ev = ["--evidence-cmd", "bun test", "--evidence-summary", "green"];
  await run(["record", "--workspace", dir, "--journey", "j1", "--repo", "agentistics", "--specialist", "Jane", "--task", "web", "--branch", "aipe/j1/web--jane", "--worktree", "w", "--status", "delivered", ...ev]);
  await run(["record", "--workspace", dir, "--journey", "j1", "--repo", "agentistics", "--specialist", "Getz", "--task", "web", "--branch", "aipe/j1/web--getz", "--worktree", "wq", "--status", "verified", "--evidence-by", "qa", ...ev]);
  await run(["record", "--workspace", dir, "--journey", "j1", "--repo", "agentistics", "--specialist", "Jane", "--task", "web", "--branch", "aipe/j1/web--jane", "--worktree", "w", "--status", "merged"]);
  await run(["record", "--workspace", dir, "--journey", "j1", "--repo", "blpsoares/agentistics", "--specialist", "jane", "--branch", "aipe/j1/web--jane", "--worktree", "w"]);
  let ledger = parse(await readFile(join(dir, ".aipe", "journeys", "j1.yaml"), "utf8")) as { dispatches: { specialist: string; status: string }[] };
  expect(ledger.dispatches.length).toBe(3); // Jane(merged) + Getz(QA) + the dup that slipped in
  const { output } = await capture(() => run(["dedupe", "--workspace", dir]));
  expect(output).toContain("MERGED journey=j1");
  ledger = parse(await readFile(join(dir, ".aipe", "journeys", "j1.yaml"), "utf8")) as { dispatches: { specialist: string; status: string }[] };
  // The duplicate is gone; the merged unit and the QA row that gated it remain.
  expect(ledger.dispatches.length).toBe(2);
  // #97 — o pouso fecha a unidade inteira: a linha do QA que gateava esta PR
  // deixa de ficar aberta para sempre. Era exatamente isso que enchia a fila
  // "precisa de você" com 20 registros de QA presos em PRs já mescladas.
  expect(ledger.dispatches.map((d) => d.status).sort()).toEqual(["closed", "merged"]);
  expect(ledger.dispatches.some((d) => d.status === "merged")).toBe(true); // immutable, survived
});
