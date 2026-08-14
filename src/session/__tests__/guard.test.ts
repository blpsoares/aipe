import { expect, test } from "bun:test";
import { decide } from "../guard";

test("a non-specialist passes everything through", () => {
  expect(decide({ command: "agentop session batch --task x", role: undefined }).action).toBe("allow");
  expect(decide({ command: "agentop session claude -p hi", role: "coordinator" }).action).toBe("allow");
});

test("a specialist spawning a session needs a grant", () => {
  for (const cmd of [
    "agentop session claude -p 'do the thing'",
    "agentop session codex -p x",
    "agentop session batch --task y --session 'claude: z'",
    "  agentop   session   gemini  -p x",
  ]) {
    expect(decide({ command: cmd, role: "specialist" })).toEqual({
      action: "needs-grant",
      reason: "specialist-session-spawn",
    });
  }
});

test("a specialist may never kill a session", () => {
  expect(decide({ command: "agentop session kill abc", role: "specialist" })).toEqual({
    action: "deny",
    reason: "a specialist must not kill sessions",
  });
});

test("a specialist may read and annotate sessions", () => {
  for (const cmd of [
    "agentop session list --json",
    "agentop session attach abc",
    "agentop session note abc 'progress'",
    "agentop session rename abc 'label'",
  ]) {
    expect(decide({ command: cmd, role: "specialist" }).action).toBe("allow");
  }
});

test("unrelated commands are never the guard's business", () => {
  for (const cmd of ["git status", "bun test", "echo agentop session claude"]) {
    expect(decide({ command: cmd, role: "specialist" }).action).toBe("allow");
  }
});

test("a spawn hidden behind a shell operator is still caught", () => {
  expect(decide({ command: "git status && agentop session claude -p x", role: "specialist" }).action)
    .toBe("needs-grant");
  expect(decide({ command: "true; agentop session batch --task t", role: "specialist" }).action)
    .toBe("needs-grant");
});
