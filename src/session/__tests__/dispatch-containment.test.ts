// End-to-end proof for the two CRITICAL merge blockers found by whole-branch
// review: (1) nothing ever set AIPE_ROLE=specialist, so decide() always took
// the "allow" branch; (2) the containment hook was merged into the workspace
// root / repo root, never into the worktree the dispatched session actually
// runs in. The fix carries the role LITERALLY in the guard command baked
// into the worktree's own hook (`aipe session guard --role specialist`) —
// never via an env var agentop cannot inject.
//
// Every prior test used a fake runner accepting any argv and never exercised
// a real worktree-shaped path, so these tests deliberately drive the WHOLE
// chain: dispatchCommand → hook file on disk in the worktree → guardCommand
// fed that exact hook's command → denied. Also covers IMPORTANT 5: a unit
// whose adapter has a real agentop harness name but no containment hook
// (codex) must be refused before anything is written or started.
import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dispatchCommand, guardCommand } from "../cli";
import { readLedger, recordDispatch, startJourney } from "../../journey/ledger";
import type { AgentopRunner } from "../types";

async function fixture(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "aipe-sess-containment-"));
  await mkdir(join(dir, "embark", ".claude", "skills", "joaquim"), { recursive: true });
  await writeFile(
    join(dir, "embark", ".claude", "skills", "joaquim", "SKILL.md"),
    "---\nname: joaquim\n---\n\nYou are Joaquim.\n",
    "utf8",
  );
  await mkdir(join(dir, ".aipe", "journeys", "j1"), { recursive: true });
  await writeFile(join(dir, ".aipe", "journeys", "j1", "orientation.md"), "## embark\nFix it.\n", "utf8");
  await startJourney(dir, "j1");
  return dir;
}

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

test("dispatchCommand writes the containment hook into the unit's real worktree, with the guard command and specialist role baked in — and that exact hook denies a specialist's session spawn", async () => {
  const dir = await fixture();
  // The worktree-shaped directory a real `aipe worktree create` would have
  // already made before dispatch runs (dispatchCommand does not create
  // worktrees itself — see src/worktree/run.ts — only writes into one that
  // exists).
  const worktree = join(dir, ".worktrees", "j1-joaquim");
  await mkdir(worktree, { recursive: true });
  await recordDispatch(dir, "j1", {
    repo: "embark", specialist: "Joaquim", branch: "aipe/j1/joaquim",
    worktree, status: "dispatched", mode: "session", intensity: "normal", harness: "claude-code",
  });

  const r = await dispatchCommand({ workspace: dir, journeyId: "j1", runner: okRunner });
  expect(r.code).toBe(0);
  expect((await readLedger(dir, "j1"))!.dispatches[0]!.sessionId).toBe("s-1");

  // 1. The containment hook file exists IN THE WORKTREE — not the workspace
  //    root, not the repo root — with the guard command and the specialist
  //    role in it.
  const settingsPath = join(worktree, ".claude", "settings.json");
  const settings = JSON.parse(await readFile(settingsPath, "utf8"));
  expect(settings.hooks.PreToolUse).toEqual([
    { matcher: "Bash", hooks: [{ type: "command", command: "aipe session guard --role specialist" }] },
  ]);

  // The PE's own workspace root must NOT have been touched by this — only
  // the worktree gets a role-baked hook.
  await expect(readFile(join(dir, ".claude", "settings.json"), "utf8")).rejects.toThrow();

  // 2. Drive guardCommand with EXACTLY the invocation the worktree's own
  //    hook would run: extract the command from the config just written
  //    (not a hardcoded literal), parse its `--role` value out of it, and
  //    prove an `agentop session claude` attempt from this worktree is
  //    denied.
  const hookCommand: string = settings.hooks.PreToolUse[0].hooks[0].command;
  expect(hookCommand.startsWith("aipe session guard")).toBe(true);
  const roleMatch = /--role\s+(\S+)/.exec(hookCommand);
  expect(roleMatch).not.toBeNull();
  const role = roleMatch![1]!;
  expect(role).toBe("specialist");

  const payload = JSON.stringify({ tool_name: "Bash", tool_input: { command: "agentop session claude -p x" } });
  const denied = await guardCommand(payload, {}, role);
  expect(denied.code).toBe(0);
  const out = JSON.parse(denied.stdout);
  expect(out.hookSpecificOutput.permissionDecision).toBe("deny");
  expect(out.hookSpecificOutput.permissionDecisionReason).toBe(
    "Opening agentop sessions is not permitted for a specialist. Ask the coordinator for a grant if a sub-session is genuinely required.",
  );

  // `agentop session kill` from that same worktree, with that same role, is
  // an unconditional deny too — never granted, unlike a plain spawn.
  const killPayload = JSON.stringify({ tool_name: "Bash", tool_input: { command: "agentop session kill other" } });
  const killDenied = await guardCommand(killPayload, {}, role);
  const killOut = JSON.parse(killDenied.stdout);
  expect(killOut.hookSpecificOutput.permissionDecisionReason).toBe("a specialist must not kill sessions");
});

test("a codex-harness unit is refused before anything is written or started, and no session runs", async () => {
  const dir = await fixture();
  const worktree = join(dir, ".worktrees", "j1-joaquim");
  await mkdir(worktree, { recursive: true });
  await recordDispatch(dir, "j1", {
    repo: "embark", specialist: "Joaquim", branch: "aipe/j1/joaquim",
    worktree, status: "dispatched", mode: "session", intensity: "normal", harness: "codex",
  });

  const mustNotStartASession: AgentopRunner = async (args) => {
    if (args[0] === "--version") return { code: 0, stdout: "agentop v1.9.0", stderr: "" };
    throw new Error(`dispatchCommand must not have invoked agentop with: ${args.join(" ")}`);
  };

  const r = await dispatchCommand({ workspace: dir, journeyId: "j1", runner: mustNotStartASession });
  expect(r.code).toBe(1);
  expect(r.lines).toEqual([
    "ERROR harness: embark uses codex, which is not containable — not session-dispatchable",
  ]);

  expect((await readLedger(dir, "j1"))!.dispatches[0]!.sessionId).toBeUndefined();
  // No prompt file (the audit trail of what a specialist was told) ...
  await expect(readdir(join(dir, ".aipe", "journeys", "j1", "prompts"))).rejects.toThrow();
  // ... and no containment hook written into the worktree either — refusing
  // must happen before ANY of dispatchCommand's writes, not just before
  // startBatch.
  await expect(readFile(join(worktree, ".claude", "settings.json"), "utf8")).rejects.toThrow();
});

// Part 2 (sibling caller) — the session dispatch path resolves each unit's own
// harness via getAdapter, which falls back to claude-code for an UNKNOWN id. A
// present-but-unregistered harness ("factory-droid" — real name, no adapter)
// must be refused before anything is written or started, exactly like a codex
// unit is: otherwise it would silently start as claude-code, defeating the very
// "approved for one harness must not start on another" invariant. (Reverting the
// hasAdapter guard makes this dispatch as claude-code → this test fails.)
test("an unknown-harness unit is refused before anything is written or started, and no session runs", async () => {
  const dir = await fixture();
  const worktree = join(dir, ".worktrees", "j1-joaquim");
  await mkdir(worktree, { recursive: true });
  await recordDispatch(dir, "j1", {
    repo: "embark", specialist: "Joaquim", branch: "aipe/j1/joaquim",
    worktree, status: "dispatched", mode: "session", intensity: "normal", harness: "factory-droid",
  });

  const mustNotStartASession: AgentopRunner = async (args) => {
    if (args[0] === "--version") return { code: 0, stdout: "agentop v1.9.0", stderr: "" };
    throw new Error(`dispatchCommand must not have invoked agentop with: ${args.join(" ")}`);
  };

  const r = await dispatchCommand({ workspace: dir, journeyId: "j1", runner: mustNotStartASession });
  expect(r.code).toBe(1);
  expect(r.lines).toEqual([
    'ERROR harness: embark uses "factory-droid", which has no adapter registered — not session-dispatchable',
  ]);

  expect((await readLedger(dir, "j1"))!.dispatches[0]!.sessionId).toBeUndefined();
});
