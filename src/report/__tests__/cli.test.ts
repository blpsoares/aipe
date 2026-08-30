import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeLedger } from "../../journey/ledger";
import { run } from "../cli";
import type { JourneyLedger } from "../../journey/types";

let dir: string;
const logs: string[] = [];
const origLog = console.log;

const J: JourneyLedger[] = [
  {
    id: "j-20260801-aa",
    dispatches: [
      { repo: "aipe", task: "t1", specialist: "Jesse", branch: "b", worktree: "w", status: "merged", pr: "PR1", model: "claude-opus-4-8" },
      { repo: "aipe", task: "t1", specialist: "jesse", branch: "b", worktree: "w", status: "verified", pr: "PR1", model: "claude-opus-4-8" },
    ],
  },
  {
    id: "j-20260802-bb",
    dispatches: [
      { repo: "agentistics", task: "t2", specialist: "Viola", branch: "b", worktree: "w", status: "dispatched", pr: "PR2" },
    ],
  },
];

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "aipe-report-"));
  for (const j of J) await writeLedger(dir, j);
  logs.length = 0;
  console.log = (...a: unknown[]) => logs.push(a.join(" "));
});
afterEach(async () => {
  console.log = origLog;
  await rm(dir, { recursive: true, force: true });
});

const out = () => logs.join("\n");

test("default: readable table with the four metrics and honesty footer", async () => {
  const code = await run(["--workspace", dir]);
  expect(code).toBe(0);
  const o = out();
  expect(o).toContain("Entregas");
  expect(o).toContain("Aprovadas pela QA");
  expect(o).toContain("PRs mergeados");
  expect(o).toContain("Honestidade sobre o dado");
  // Jesse/jesse merged as one person
  expect(o).toContain("uma pessoa");
});

test("--json emits a parseable ReportResult", async () => {
  const code = await run(["--workspace", dir, "--json"]);
  expect(code).toBe(0);
  const parsed = JSON.parse(out());
  expect(parsed.overall.deliveries).toBe(1); // t1 (t2 is only dispatched)
  expect(parsed.totalDispatches).toBe(3);
  expect(parsed.honesty.noEnvelope).toBe(1); // PR2 row has no envelope
});

test("--csv emits a header + one row per group", async () => {
  const code = await run(["--workspace", dir, "--group-by", "repo", "--csv"]);
  expect(code).toBe(0);
  const lines = out().trim().split("\n");
  expect(lines[0]).toBe("repo,entregas,aprovadas_qa,prs_mergeados,prs_mergeados_derivados,prs_abertos");
  expect(lines.some((l) => l.startsWith("aipe,"))).toBe(true);
  expect(lines.some((l) => l.startsWith("agentistics,"))).toBe(true);
});

test("--repo filter narrows the set", async () => {
  await run(["--workspace", dir, "--repo", "agentistics", "--json"]);
  const parsed = JSON.parse(out());
  expect(parsed.totalDispatches).toBe(1);
  expect(parsed.overall.deliveries).toBe(0);
});

test("empty combination prints 'nada aqui', exit 0", async () => {
  const code = await run(["--workspace", dir, "--repo", "nope"]);
  expect(code).toBe(0);
  expect(out()).toContain("nada aqui");
});

test("an unknown --group-by dimension is rejected with exit 1", async () => {
  const code = await run(["--workspace", dir, "--group-by", "banana"]);
  expect(code).toBe(1);
  expect(out().toLowerCase()).toContain("group-by");
});
