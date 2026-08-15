import { expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { grantCommand, guardCommand, run } from "../cli";
import { consumeGrant } from "../grants";

async function ws(): Promise<string> {
  return mkdtemp(join(tmpdir(), "aipe-session-grant-"));
}

async function captureRun(args: string[]): Promise<{ code: number; out: string[] }> {
  const original = console.log;
  const out: string[] = [];
  console.log = (...a: unknown[]) => {
    out.push(a.join(" "));
  };
  try {
    const code = await run(args);
    return { code, out };
  } finally {
    console.log = original;
  }
}

test("a successful grant is consumable exactly `count` times", async () => {
  const dir = await ws();
  const { code, lines } = await grantCommand({
    workspace: dir, journeyId: "j1", sessionId: "s1", count: 3,
  });
  expect(code).toBe(0);
  expect(lines).toEqual([
    "OK grant journey=j1 session=s1 count=3",
    "NOTE grant: cannot take effect yet — agentop does not stamp AGENTOP_SESSION_ID into the specialist's environment, so this quota cannot be consumed until that lands. Do not treat this OK as the specialist being authorised.",
  ]);

  expect(await consumeGrant(dir, "j1", "s1")).toBe(true);
  expect(await consumeGrant(dir, "j1", "s1")).toBe(true);
  expect(await consumeGrant(dir, "j1", "s1")).toBe(true);
  expect(await consumeGrant(dir, "j1", "s1")).toBe(false);
});

test("a second grant for the same journey/session errors with a non-zero exit and does not widen the quota", async () => {
  const dir = await ws();
  const first = await grantCommand({ workspace: dir, journeyId: "j1", sessionId: "s1", count: 2 });
  expect(first.code).toBe(0);

  const second = await grantCommand({ workspace: dir, journeyId: "j1", sessionId: "s1", count: 5 });
  expect(second.code).toBe(1);
  expect(second.lines).toEqual([
    'ERROR grant: a grant already exists for journey "j1", session "s1" — issueGrant must not be called twice for the same (journey, session) pair',
  ]);

  // Exactly the first grant's 2 tokens survive — never the sum, never replaced.
  expect(await consumeGrant(dir, "j1", "s1")).toBe(true);
  expect(await consumeGrant(dir, "j1", "s1")).toBe(true);
  expect(await consumeGrant(dir, "j1", "s1")).toBe(false);
});

test("a non-numeric --count is rejected and grants nothing", async () => {
  const dir = await ws();
  const { code, lines } = await grantCommand({
    workspace: dir, journeyId: "j1", sessionId: "s1", count: Number("abc"),
  });
  expect(code).toBe(1);
  expect(lines).toEqual(["ERROR count: --count must be a positive number, got NaN"]);
  expect(await consumeGrant(dir, "j1", "s1")).toBe(false);
});

test("a negative --count is rejected and grants nothing", async () => {
  const dir = await ws();
  const { code, lines } = await grantCommand({
    workspace: dir, journeyId: "j1", sessionId: "s1", count: -1,
  });
  expect(code).toBe(1);
  expect(lines).toEqual(["ERROR count: --count must be a positive number, got -1"]);
  expect(await consumeGrant(dir, "j1", "s1")).toBe(false);
});

test("a --count of 0 is rejected and grants nothing (it looks granted, isn't)", async () => {
  const dir = await ws();
  const { code, lines } = await grantCommand({
    workspace: dir, journeyId: "j1", sessionId: "s1", count: 0,
  });
  expect(code).toBe(1);
  expect(lines).toEqual(["ERROR count: --count must be a positive number, got 0"]);
  expect(await consumeGrant(dir, "j1", "s1")).toBe(false);
});

test("`aipe session grant` with no flags is rejected with a missing --journey error", async () => {
  const { code, out } = await captureRun(["grant"]);
  expect(code).toBe(1);
  expect(out).toEqual(["ERROR journey: --journey <id> is required"]);
});

test("`aipe session grant` missing --session-id is rejected", async () => {
  const dir = await ws();
  const { code, out } = await captureRun(["grant", "--journey", "j1", "--workspace", dir]);
  expect(code).toBe(1);
  expect(out).toEqual(["ERROR session-id: --session-id <id> is required"]);
});

test("`aipe session grant` missing --count is rejected", async () => {
  const dir = await ws();
  const { code, out } = await captureRun([
    "grant", "--journey", "j1", "--session-id", "s1", "--workspace", dir,
  ]);
  expect(code).toBe(1);
  expect(out).toEqual(["ERROR count: --count <n> is required"]);
});

test("`aipe session grant` end to end via run() issues a working grant", async () => {
  const dir = await ws();
  const { code, out } = await captureRun([
    "grant", "--journey", "j1", "--session-id", "s1", "--count", "1", "--workspace", dir,
  ]);
  expect(code).toBe(0);
  expect(out).toEqual([
    "OK grant journey=j1 session=s1 count=1",
    "NOTE grant: cannot take effect yet — agentop does not stamp AGENTOP_SESSION_ID into the specialist's environment, so this quota cannot be consumed until that lands. Do not treat this OK as the specialist being authorised.",
  ]);
  expect(await consumeGrant(dir, "j1", "s1")).toBe(true);
});

test("help text advertises grant", async () => {
  const { code, out } = await captureRun(["--help"]);
  expect(code).toBe(0);
  expect(out.join("\n")).toContain(
    "grant    --journey <id> --session-id <id> --count <n> [--workspace <dir>]",
  );
});

// The proof the valve is actually wired: grantCommand issues a quota, and the
// SAME guardCommand a real containment hook calls now allows exactly that
// many spawns and denies the next one — not just that issueGrant was called.
test("round trip: a grant issued via grantCommand lets guardCommand allow exactly that many spawns, then deny", async () => {
  const dir = await ws();
  const grant = await grantCommand({ workspace: dir, journeyId: "j1", sessionId: "s1", count: 1 });
  expect(grant.code).toBe(0);

  const env = {
    AIPE_ROLE: "specialist",
    AIPE_WORKSPACE: dir,
    AIPE_JOURNEY: "j1",
    AGENTOP_SESSION_ID: "s1",
  };
  const payload = JSON.stringify({
    tool_name: "Bash",
    tool_input: { command: "agentop session claude -p x" },
  });

  const allowed = await guardCommand(payload, env);
  expect(allowed.code).toBe(0);
  expect(allowed.stdout).toBe("");

  const denied = await guardCommand(payload, env);
  expect(denied.code).toBe(0);
  const out = JSON.parse(denied.stdout);
  expect(out.hookSpecificOutput.permissionDecision).toBe("deny");
  expect(out.hookSpecificOutput.permissionDecisionReason).toBe(
    "Opening agentop sessions is not permitted for a specialist. Ask the coordinator for a grant if a sub-session is genuinely required.",
  );
});
