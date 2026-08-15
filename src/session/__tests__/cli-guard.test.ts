import { expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { guardCommand } from "../cli";
import { issueGrant } from "../grants";

const payload = (command: string) =>
  JSON.stringify({ tool_name: "Bash", tool_input: { command } });

test("a coordinator is never blocked", async () => {
  const r = await guardCommand(payload("agentop session batch --task t"), {});
  expect(r.code).toBe(0);
  expect(r.stdout).toBe("");
});

test("a specialist without a grant is denied, with a reason", async () => {
  const r = await guardCommand(payload("agentop session claude -p x"), {
    AIPE_ROLE: "specialist",
  });
  expect(r.code).toBe(0);
  const out = JSON.parse(r.stdout);
  expect(out.hookSpecificOutput.permissionDecision).toBe("deny");
  expect(out.hookSpecificOutput.permissionDecisionReason).toContain("not permitted");
});

// Gemini's BeforeTool hook reads a TOP-LEVEL `decision`/`reason` pair, never
// `hookSpecificOutput.permissionDecision` (see src/harness/gemini.ts's header
// comment). Both shapes must be present in the SAME payload so one guard
// binary contains every harness it's wired into, exit code 0 throughout.
test("a deny also carries Gemini's top-level decision/reason shape, alongside Claude/Codex's", async () => {
  const r = await guardCommand(payload("agentop session claude -p x"), {
    AIPE_ROLE: "specialist",
  });
  expect(r.code).toBe(0);
  const out = JSON.parse(r.stdout);
  expect(out.decision).toBe("deny");
  expect(out.reason).toContain("not permitted");
});

test("a specialist with a grant is allowed, and the grant is spent", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-guardcli-"));
  await issueGrant(dir, "j1", "s1", 1);
  const env = {
    AIPE_ROLE: "specialist",
    AIPE_WORKSPACE: dir,
    AIPE_JOURNEY: "j1",
    AGENTOP_SESSION_ID: "s1",
  };
  const first = await guardCommand(payload("agentop session claude -p x"), env);
  expect(first.stdout).toBe("");

  const second = await guardCommand(payload("agentop session claude -p y"), env);
  expect(JSON.parse(second.stdout).hookSpecificOutput.permissionDecision).toBe("deny");
});

test("killing a session is denied even with a grant", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-guardcli-"));
  await issueGrant(dir, "j1", "s1", 5);
  const r = await guardCommand(payload("agentop session kill other"), {
    AIPE_ROLE: "specialist",
    AIPE_WORKSPACE: dir,
    AIPE_JOURNEY: "j1",
    AGENTOP_SESSION_ID: "s1",
  });
  expect(JSON.parse(r.stdout).hookSpecificOutput.permissionDecisionReason).toContain("kill");
});

test("an unparseable payload fails open, never blocking real work", async () => {
  const r = await guardCommand("not json", { AIPE_ROLE: "specialist" });
  expect(r.code).toBe(0);
  expect(r.stdout).toBe("");
});

test("an unverifiable grant (unsafe journey id) is denied, not a crash", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-guardcli-"));
  const r = await guardCommand(payload("agentop session claude -p x"), {
    AIPE_ROLE: "specialist",
    AIPE_WORKSPACE: dir,
    AIPE_JOURNEY: "../escape",
    AGENTOP_SESSION_ID: "s1",
  });
  expect(r.code).toBe(0);
  const out = JSON.parse(r.stdout);
  expect(out.hookSpecificOutput.permissionDecision).toBe("deny");
});
