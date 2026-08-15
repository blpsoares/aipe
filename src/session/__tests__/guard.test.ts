import { expect, test } from "bun:test";
import { decide } from "../guard";

test("a non-specialist passes everything through", () => {
  expect(decide({ command: "agentop session batch --task x", role: undefined }).action).toBe("allow");
  expect(decide({ command: "agentop session claude -p hi", role: "coordinator" }).action).toBe("allow");
});

test("role comparison is case-insensitive and whitespace-tolerant", () => {
  // "specialist" in various cases and with whitespace must all behave the same
  for (const role of ["specialist", "Specialist", "SPECIALIST", " specialist", "specialist ", " specialist "]) {
    // Capitalize spawn behavior: needs grant
    expect(decide({ command: "agentop session claude -p x", role })).toEqual({
      action: "needs-grant",
      reason: "specialist-session-spawn",
    });
    // Kill is always deny
    expect(decide({ command: "agentop session kill abc", role })).toEqual({
      action: "deny",
      reason: "a specialist must not kill sessions",
    });
  }
  // An unrelated role still passes everything through
  expect(decide({ command: "agentop session claude -p x", role: "coordinator" }).action).toBe("allow");
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

test("the guard is case-insensitive, so kill-deny cannot be dodged with case", () => {
  expect(decide({ command: "AGENTOP SESSION KILL abc", role: "specialist" })).toEqual({
    action: "deny",
    reason: "a specialist must not kill sessions",
  });
  expect(decide({ command: "AGENTOP SESSION CLAUDE", role: "specialist" })).toEqual({
    action: "needs-grant",
    reason: "specialist-session-spawn",
  });
  expect(
    decide({
      command: "agentop session claude -p x; AGENTOP SESSION KILL abc",
      role: "specialist",
    }),
  ).toEqual({ action: "deny", reason: "a specialist must not kill sessions" });
});

test("a mixed-case read-only verb is still allowed", () => {
  expect(decide({ command: "AGENTOP SESSION LIST", role: "specialist" }).action).toBe("allow");
});

test("a flag-shaped token after session is not recognised, so it needs a grant", () => {
  expect(decide({ command: "agentop session --foo claude", role: "specialist" })).toEqual({
    action: "needs-grant",
    reason: "specialist-session-spawn",
  });
});

// Regression for a matchAll parity artifact: when a captured verb is itself
// the literal token `agentop`, a naive consuming capture group eats it, so it
// can't start the next match — and a real `kill` right after can be skipped.
// The lookahead fix leaves the verb's characters available to begin the next
// match, so this must always resolve to deny.
test("a kill hidden behind a repeated agentop-session verb is still caught", () => {
  expect(
    decide({ command: "agentop session agentop session kill x", role: "specialist" }),
  ).toEqual({ action: "deny", reason: "a specialist must not kill sessions" });

  expect(
    decide({
      command: "agentop session claude -p 'ask agentop session agentop session kill x'",
      role: "specialist",
    }),
  ).toEqual({ action: "deny", reason: "a specialist must not kill sessions" });
});

test("repeated agentop-session verbs without a kill still need a grant", () => {
  expect(
    decide({ command: "agentop session agentop session claude", role: "specialist" }),
  ).toEqual({ action: "needs-grant", reason: "specialist-session-spawn" });
});

test("a three-agentop chain in front of kill is still denied (parity check)", () => {
  expect(
    decide({
      command: "agentop session agentop session agentop session kill x",
      role: "specialist",
    }),
  ).toEqual({ action: "deny", reason: "a specialist must not kill sessions" });
});

// Regression: a naive fix that stopped consuming the VERB but still consumed
// the `agentop session ` PREFIX itself could be defeated by repeating a
// prefix token (here, `session`) instead of repeating `agentop`. The scan
// must overlap matches so nothing — not even the matched prefix — can hide a
// later `kill`.
test("a kill hidden behind a repeated 'session' token is still caught", () => {
  expect(
    decide({ command: "agentop session session session kill x", role: "specialist" }),
  ).toEqual({ action: "deny", reason: "a specialist must not kill sessions" });
});

test("repeated 'session' tokens without a kill still need a grant", () => {
  expect(
    decide({ command: "agentop session session claude", role: "specialist" }),
  ).toEqual({ action: "needs-grant", reason: "specialist-session-spawn" });
});

// Regression: `exec` with the `g` flag mutates `lastIndex` on the RegExp
// instance it's called with. If `decide` reused a shared module-level
// global regex, a first call could leave `lastIndex` non-zero, corrupting
// the scan position for a second, unrelated call.
test("two successive calls on the same input give the same answer", () => {
  const input = { command: "agentop session session session kill x", role: "specialist" as const };
  expect(decide(input)).toEqual(decide(input));
  expect(decide(input)).toEqual({ action: "deny", reason: "a specialist must not kill sessions" });
});
