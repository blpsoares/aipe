import { expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "../cli";
import { loadReport } from "../load";
import type { AgentopRunner } from "../../session/types";

// agentop is never installed under test — the probe fails, so liveness degrades
// to source:"none" and the command still works (item 6).
const noAgentop: AgentopRunner = async () => ({ code: 1, stdout: "", stderr: "not found" });

async function ws(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "aipe-status-"));
  await mkdir(join(dir, ".aipe", "journeys"), { recursive: true });
  // A real workspace always has a brain.yaml (written at onboarding, before any
  // journey exists), which is what `looksLikeWorkspace` keys on. The fixture
  // seeds a minimal one so it reflects a genuine workspace; tests that care
  // about specific brain contents overwrite it via writeBrain.
  await writeBrain(dir, "context:\n  name: blpsoares\n  coordinator: Heisenberg\nrepos:\n  - name: aipe\n    url: https://x/y.git\n    path: ./aipe\n");
  return dir;
}

async function writeBrain(dir: string, body: string): Promise<void> {
  await writeFile(join(dir, ".aipe", "brain.yaml"), body, "utf8");
}

async function writeLedger(dir: string, id: string, body: string): Promise<void> {
  await writeFile(join(dir, ".aipe", "journeys", `${id}.yaml`), body, "utf8");
}

function capture(): { spy: (s: string) => void; lines: string[] } {
  const lines: string[] = [];
  return { spy: (s: string) => lines.push(s), lines };
}

async function withStdout<T>(fn: () => Promise<T>): Promise<{ out: string; result: T }> {
  const cap = capture();
  const orig = console.log;
  console.log = cap.spy as typeof console.log;
  try {
    const result = await fn();
    return { out: cap.lines.join("\n"), result };
  } finally {
    console.log = orig;
  }
}

test("a real but empty workspace (brain, no journeys) reports no journeys, exit 0", async () => {
  // The legitimate empty case: a genuine workspace that simply has no journeys
  // yet. This must keep working exactly as before (spec v2 acceptance).
  const dir = await ws();
  const { out, result } = await withStdout(() => run(["--workspace", dir, "--json"], { runner: noAgentop }));
  expect(result).toBe(0);
  const parsed = JSON.parse(out);
  expect(parsed.journeys).toEqual([]);
  expect(parsed.units).toEqual([]);
});

test("a non-workspace directory fails loud (table), not an empty report", async () => {
  // The bug: from a dir that is not an AIPe workspace, status printed an empty
  // report and exited 0 — indistinguishable from a real empty workspace. The
  // coordinator runs `aipe status` in chat; from the wrong dir it would report
  // "nothing to do" as truth. Now it must refuse and exit non-zero.
  const dir = await mkdtemp(join(tmpdir(), "aipe-not-ws-"));
  const { out, result } = await withStdout(() => run(["--workspace", dir], { runner: noAgentop }));
  expect(result).not.toBe(0);
  expect(out).toContain("workspace");
  // it must NOT print the empty legit report
  expect(out).not.toContain("JOURNEYS");
});

test("--json on a non-workspace fails loud, not an empty JSON report", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-not-ws-json-"));
  const { out, result } = await withStdout(() => run(["--workspace", dir, "--json"], { runner: noAgentop }));
  expect(result).not.toBe(0);
  // the honest failure must not be an empty-but-valid report a caller would trust
  let parsedEmptyReport = false;
  try {
    const parsed = JSON.parse(out);
    parsedEmptyReport =
      Array.isArray(parsed.journeys) && parsed.journeys.length === 0 && Array.isArray(parsed.units);
  } catch {
    parsedEmptyReport = false;
  }
  expect(parsedEmptyReport).toBe(false);
});

test("a malformed ledger is skipped, not crashed on (item 6)", async () => {
  const dir = await ws();
  await writeLedger(dir, "j-bad", ":\n  this: is: not: valid: yaml: [");
  await writeLedger(dir, "j-ok", "id: j-ok\ndispatches:\n  - repo: aipe\n    specialist: Jesse\n    branch: b\n    worktree: w\n    status: dispatched\n");
  const report = await loadReport(dir, { scope: "all", runner: noAgentop });
  expect(report.journeys.map((j) => j.id)).toEqual(["j-ok"]);
});

test("a journey with zero dispatches works and says so plainly (item 6)", async () => {
  const dir = await ws();
  await writeLedger(dir, "j-empty", "id: j-empty\ndispatches: []\nspec:\n  path: p\n  version: 1\n  approved: true\n");
  const { out, result } = await withStdout(() =>
    run(["--workspace", dir, "--journey", "j-empty"], { runner: noAgentop, stdout: { isTTY: false }, env: {} }),
  );
  expect(result).toBe(0);
  expect(out).toContain("j-empty");
  expect(out).toContain("1 — ONDE O TRABALHO ESTÁ");
  expect(out).toContain("3 — PRECISA DE VOCÊ"); // always rendered, even empty
});

test("--journey on an unknown id says so, exit 0 (no crash)", async () => {
  const dir = await ws();
  const { out, result } = await withStdout(() => run(["--workspace", dir, "--journey", "nope"], { runner: noAgentop }));
  expect(result).toBe(0);
  expect(out).toContain('No journey "nope"');
});

test("--help prints help and exits 0", async () => {
  const { out, result } = await withStdout(() => run(["--help"], { runner: noAgentop }));
  expect(result).toBe(0);
  expect(out).toContain("aipe status");
  expect(out).toContain("--json");
});

test("the follow-preference is read from the brain and surfaced in --json", async () => {
  const dir = await ws();
  await writeBrain(
    dir,
    "context:\n  name: blpsoares\n  coordinator: Heisenberg\n  statusUpdates:\n    auto: true\n    format: compact\nrepos:\n  - name: aipe\n    url: https://x/y.git\n    path: ./aipe\n",
  );
  const { out } = await withStdout(() => run(["--workspace", dir, "--all", "--json"], { runner: noAgentop }));
  expect(JSON.parse(out).pref).toEqual({ auto: true, format: "compact" });
});

test("--compact overrides the saved detailed preference for this render only", async () => {
  const dir = await ws();
  await writeBrain(dir, "context:\n  name: blpsoares\n  coordinator: Heisenberg\n  statusUpdates:\n    auto: true\n    format: detailed\nrepos:\n  - name: aipe\n    url: https://x/y.git\n    path: ./aipe\n");
  await writeLedger(dir, "j-1", "id: j-1\ndispatches:\n  - repo: aipe\n    specialist: Jesse\n    branch: aipe/j-1/jesse\n    worktree: w\n    status: dispatched\n");
  const { out } = await withStdout(() =>
    run(["--workspace", dir, "--all", "--compact"], { runner: noAgentop, stdout: { isTTY: false }, env: {} }),
  );
  // compact drops the one wide free-text column
  expect(out).not.toContain("DESCRIÇÃO");
  // the brain on disk is untouched (still says detailed) — override is per-render
  const brainNow = await Bun.file(join(dir, ".aipe", "brain.yaml")).text();
  expect(brainNow).toContain("format: detailed");
});
