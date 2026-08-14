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
  for (const cmd of ["git status", "bun test", "echo hello"]) {
    expect(decide({ command: cmd, role: "specialist" }).action).toBe("allow");
  }
});

// The guard is deliberately CONSERVATIVE: it matches the token sequence
// wherever it appears, and does not try to work out whether `agentop` sits in
// command position. Every hiding place below is ordinary shell syntax.
test("a spawn is caught wherever it hides", () => {
  for (const cmd of [
    "git status && agentop session claude -p x",
    "true; agentop session batch --task t",
    "sleep 1 & agentop session claude",
    "if true; then agentop session claude; fi",
    "for i in 1 2 3; do agentop session claude; done",
    "{ agentop session claude; }",
    "(agentop session claude)",
    "sudo agentop session claude",
    'FOO="bar baz" agentop session claude',
    "echo $(agentop session claude)",
    "echo agentop session claude",
  ]) {
    expect(decide({ command: cmd, role: "specialist" }).action).toBe("needs-grant");
  }
});

test("kill wins over a spawn appearing in the same command", () => {
  expect(decide({ command: "agentop session claude -p x; agentop session kill abc", role: "specialist" }))
    .toEqual({ action: "deny", reason: "a specialist must not kill sessions" });
  expect(decide({ command: '{ REASON="a b" agentop session kill abc; }', role: "specialist" }).action)
    .toBe("deny");
});
