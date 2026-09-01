// R4 of the approved spec-writer design: DISPATCH REFUSES an unapproved spec.
//
// The rule "do not dispatch until `--show` reports approved=true" existed only
// as prose in skills/operate/SKILL.md — a coordinator instruction, not a gate.
// `dispatchCommand` read the orientation FILE (refusing missing/empty) but never
// looked at `approved` at all, so an unapproved spec dispatched normally.
//
// Sharper, and the reason this is a refusal and not a warning: dispatch already
// DETECTS post-approval drift, sets `approved:false` for it, prints a NOTE — and
// then hands out the prompt anyway, in the same breath. That is the Lawson
// incident mechanised: the spec was amended to v3 after dispatch and the
// specialist worked from v2. The code knew and proceeded.
//
// The gate that works is the one that REFUSES (the evidence gate proves it), so
// these tests are about refusal, and about refusing BEFORE any side effect: no
// prompt file written, no agentop session started.
import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dispatchCommand } from "../cli";
import { recordDispatch, setJourneySpec, startJourney } from "../../journey/ledger";
import { hashOrientationContent } from "../../journey/spec";
import type { AgentopRunner } from "../types";

const ORIENTATION = "## embark\nFix it.\n";

async function fixture(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "aipe-dispatch-approval-"));
  await mkdir(join(dir, "embark", ".claude", "skills", "joaquim"), { recursive: true });
  await writeFile(join(dir, "embark", ".claude", "skills", "joaquim", "SKILL.md"), "---\nname: joaquim\n---\n\nYou are Joaquim.\n", "utf8");
  await mkdir(join(dir, ".aipe", "journeys", "j1"), { recursive: true });
  await writeFile(join(dir, ".aipe", "journeys", "j1", "orientation.md"), ORIENTATION, "utf8");
  await startJourney(dir, "j1");
  await recordDispatch(dir, "j1", {
    repo: "embark", specialist: "Joaquim", branch: "aipe/j1/joaquim",
    worktree: join(dir, ".worktrees", "j1-joaquim"), status: "dispatched",
    mode: "session", intensity: "ultracode", harness: "claude-code",
  });
  return dir;
}

// Records the ledger's spec at a given approval state, baselined on the file
// that is actually on disk (so "unapproved" is the ONLY thing under test).
async function withSpec(dir: string, approved: boolean): Promise<void> {
  await setJourneySpec(dir, "j1", {
    path: join(".aipe", "journeys", "j1", "orientation.md"),
    version: 1,
    approved,
    contentHash: hashOrientationContent(ORIENTATION),
  });
}

// Fails loudly if dispatch ever reaches agentop: a refusal that still started a
// session is not a refusal. `--version` is allowed (the probe runs first).
const forbiddenRunner: AgentopRunner = async (args) => {
  if (args[0] === "--version") return { code: 0, stdout: "agentop v1.9.0", stderr: "" };
  throw new Error("agentop was invoked — dispatch must refuse BEFORE starting any session");
};

async function promptsWritten(dir: string): Promise<string[]> {
  try {
    return await readdir(join(dir, ".aipe", "journeys", "j1", "prompts"));
  } catch {
    return [];
  }
}

test("an UNAPPROVED spec is refused — no prompt written, no session started", async () => {
  const dir = await fixture();
  await withSpec(dir, false);
  const r = await dispatchCommand({ workspace: dir, journeyId: "j1", runner: forbiddenRunner });
  expect(r.code).toBe(1);
  expect(r.lines.join("\n")).toContain("not approved");
  expect(await promptsWritten(dir)).toHaveLength(0);
});

test("a spec that DRIFTED after approval is refused, not dispatched with a NOTE", async () => {
  const dir = await fixture();
  await withSpec(dir, true);
  // the coordinator edits orientation.md directly after approval — the Lawson
  // incident. Dispatch detects this (it bumps the version and un-approves); the
  // point of this test is that it must also STOP.
  await writeFile(join(dir, ".aipe", "journeys", "j1", "orientation.md"), `${ORIENTATION}\n## new section\nAmended.\n`, "utf8");
  const r = await dispatchCommand({ workspace: dir, journeyId: "j1", runner: forbiddenRunner });
  expect(r.code).toBe(1);
  expect(r.lines.join("\n")).toContain("re-approval");
  expect(await promptsWritten(dir)).toHaveLength(0);
});

test("an APPROVED spec dispatches normally — the gate refuses, it does not block", async () => {
  const dir = await fixture();
  await withSpec(dir, true);
  const okRunner: AgentopRunner = async (args) => {
    if (args[0] === "--version") return { code: 0, stdout: "agentop v1.9.0", stderr: "" };
    const sessions = args
      .filter((_, i) => args[i - 1] === "--session")
      .map((flag, i) => {
        const m = /^[^@]+@(.+): @.+$/.exec(flag);
        if (!m) throw new Error(`okRunner: could not parse --session flag: ${flag}`);
        return { id: `s-${i + 1}`, harness: "claude", cwd: m[1] };
      });
    return { code: 0, stdout: JSON.stringify({ sessions }), stderr: "" };
  };
  const r = await dispatchCommand({ workspace: dir, journeyId: "j1", runner: okRunner });
  expect(r.code).toBe(0);
  expect(await promptsWritten(dir)).toContain("embark.md");
});

// A ledger with no `spec` record at all predates the Orientation Spec (legacy
// fixtures, hand-built journeys). Those must keep dispatching: the gate demands
// approval of a spec that EXISTS, it does not retroactively invent one.
test("a ledger with no spec record still dispatches — no retroactive demand", async () => {
  const dir = await fixture();
  const okRunner: AgentopRunner = async (args) => {
    if (args[0] === "--version") return { code: 0, stdout: "agentop v1.9.0", stderr: "" };
    return { code: 0, stdout: JSON.stringify({ sessions: [{ id: "s-1", harness: "claude", cwd: join(dir, ".worktrees", "j1-joaquim") }] }), stderr: "" };
  };
  const r = await dispatchCommand({ workspace: dir, journeyId: "j1", runner: okRunner });
  expect(r.code).toBe(0);
});
