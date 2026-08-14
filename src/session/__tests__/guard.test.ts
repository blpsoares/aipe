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

// Regression: a segment can legitimately open with a shell keyword, which used
// to push `agentop` off the `^` anchor and fall through to `allow`. These are
// the two reproductions from the review finding, verbatim.
test("a spawn behind a shell keyword is still caught", () => {
  expect(decide({ command: "if true; then agentop session claude; fi", role: "specialist" })).toEqual({
    action: "needs-grant",
    reason: "specialist-session-spawn",
  });
  expect(
    decide({ command: "for i in 1 2 3; do agentop session claude; done", role: "specialist" }),
  ).toEqual({
    action: "needs-grant",
    reason: "specialist-session-spawn",
  });
});

test("a spawn backgrounded with a bare & is still caught", () => {
  expect(decide({ command: "sleep 1 & agentop session claude", role: "specialist" })).toEqual({
    action: "needs-grant",
    reason: "specialist-session-spawn",
  });
});

test("a spawn via sudo or an env-var prefix is still caught", () => {
  expect(decide({ command: "sudo agentop session claude", role: "specialist" })).toEqual({
    action: "needs-grant",
    reason: "specialist-session-spawn",
  });
  expect(decide({ command: "FOO=1 agentop session claude", role: "specialist" })).toEqual({
    action: "needs-grant",
    reason: "specialist-session-spawn",
  });
});

// Documents the boundary the anchor exists to protect: `agentop` as a mere
// *argument* to an ordinary command must never trip the guard.
test("agentop as an argument to an ordinary command does not trip the guard", () => {
  expect(decide({ command: "echo agentop session claude", role: "specialist" }).action).toBe("allow");
});
