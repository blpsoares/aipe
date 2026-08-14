import { expect, test } from "bun:test";
import { validateBatch } from "../law";
import { buildSessionContext, parseBatch } from "../cli";
import type { PersonaRegistryEntry } from "../types";

const roster: PersonaRegistryEntry[] = [
  { name: "Joaquim", role: "dev-fullstack", repo: "embark", path: "./embark/.claude/skills/joaquim" },
  { name: "Marina", role: "qa", repo: "embark", path: "./embark/.claude/skills/marina" },
  { name: "Pedro", role: "dev-fullstack", repo: "prontuario", path: "./prontuario/.claude/skills/pedro" },
];
const repos = ["embark", "prontuario"];
const ctx = { agentopOk: true, containableHarnesses: ["claude-code"] };

test("a session-mode batch passes when agentop is ok and the harness is containable", () => {
  const v = validateBatch(
    [{ repo: "embark", specialist: "Joaquim", mode: "session", harness: "claude-code" }],
    repos,
    roster,
    ctx,
  );
  expect(v.ok).toBe(true);
});

test("session mode is rejected when agentop is unavailable", () => {
  const v = validateBatch(
    [{ repo: "embark", specialist: "Joaquim", mode: "session" }],
    repos,
    roster,
    { agentopOk: false, containableHarnesses: ["claude-code"] },
  );
  expect(v.ok).toBe(false);
  expect(v.ok === false && v.rejects).toContain("agentop-unavailable");
});

test("subagent mode is unaffected by agentop being unavailable", () => {
  const v = validateBatch(
    [{ repo: "embark", specialist: "Joaquim" }],
    repos,
    roster,
    { agentopOk: false, containableHarnesses: [] },
  );
  expect(v.ok).toBe(true);
});

test("a non-containable harness is rejected", () => {
  const v = validateBatch(
    [{ repo: "embark", specialist: "Joaquim", mode: "session", harness: "kimi" }],
    repos,
    roster,
    ctx,
  );
  expect(v.ok === false && v.rejects).toContain("harness-not-containable kimi");
});

test("more than four session-mode units is rejected, while 16 subagents pass", () => {
  const five = ["a", "b", "c", "d", "e"].map((p) => ({
    repo: "embark",
    package: p,
    specialist: "Joaquim",
    mode: "session" as const,
    harness: "claude-code",
  }));
  const v = validateBatch(five, repos, roster, ctx);
  expect(v.ok === false && v.rejects).toContain("session-cap-exceeded 5");

  const sixteen = Array.from({ length: 16 }, (_, i) => ({
    repo: "embark",
    package: `p${i}`,
    specialist: "Joaquim",
  }));
  const subagentVerdict = validateBatch(sixteen, repos, roster, ctx);
  expect(subagentVerdict.ok).toBe(true);
});

// The two caps are enforced independently against their own counts: the total
// batch size (mode-agnostic) against MAX_CONCURRENT, and the session-mode
// subset against SESSION_MAX_CONCURRENT. A batch can trip one without the
// other.
test("a mixed batch trips the overall cap without tripping the session cap", () => {
  const sessionEntries = ["s1", "s2", "s3"].map((p) => ({
    repo: "embark",
    package: p,
    specialist: "Joaquim",
    mode: "session" as const,
    harness: "claude-code",
  }));
  const subagentEntries = Array.from({ length: 14 }, (_, i) => ({
    repo: "embark",
    package: `a${i}`,
    specialist: "Joaquim",
  }));
  const batch = [...sessionEntries, ...subagentEntries];
  expect(batch).toHaveLength(17);

  const v = validateBatch(batch, repos, roster, ctx);
  expect(v.ok).toBe(false);
  const rejects = v.ok === false ? v.rejects : [];
  expect(rejects).toContain("cap-exceeded 17");
  expect(rejects.some((r) => r.startsWith("session-cap-exceeded"))).toBe(false);
});

test("session entries with no session context are rejected as session-context-missing", () => {
  const v = validateBatch(
    [{ repo: "embark", specialist: "Joaquim", mode: "session", harness: "claude-code" }],
    repos,
    roster,
  );
  expect(v.ok).toBe(false);
  expect(v.ok === false && v.rejects).toContain("session-context-missing");
});

test("a subagent-only batch with no session context still validates (backward compat)", () => {
  const v = validateBatch(
    [{ repo: "embark", specialist: "Joaquim" }],
    repos,
    roster,
  );
  expect(v.ok).toBe(true);
});

test("a repeated bad harness is reported exactly once", () => {
  const batch = ["a", "b"].map((p) => ({
    repo: "embark",
    package: p,
    specialist: "Joaquim",
    mode: "session" as const,
    harness: "kimi",
  }));
  const v = validateBatch(batch, repos, roster, ctx);
  expect(v.ok).toBe(false);
  const rejects = v.ok === false ? v.rejects : [];
  expect(rejects.filter((r) => r === "harness-not-containable kimi")).toHaveLength(1);
});

test("two distinct bad harnesses each produce their own reject line", () => {
  const batch = [
    { repo: "embark", package: "a", specialist: "Joaquim", mode: "session" as const, harness: "kimi" },
    { repo: "embark", package: "b", specialist: "Joaquim", mode: "session" as const, harness: "gpt" },
  ];
  const v = validateBatch(batch, repos, roster, ctx);
  expect(v.ok).toBe(false);
  const rejects = v.ok === false ? v.rejects : [];
  expect(rejects).toContain("harness-not-containable kimi");
  expect(rejects).toContain("harness-not-containable gpt");
  expect(rejects.filter((r) => r.startsWith("harness-not-containable"))).toHaveLength(2);
});

test("parseBatch preserves the session envelope", () => {
  const batch = parseBatch([
    { repo: "embark", specialist: "Joaquim", mode: "session", intensity: "ultracode", harness: "claude-code" },
  ]);
  expect(batch![0]).toEqual({
    repo: "embark",
    specialist: "Joaquim",
    mode: "session",
    intensity: "ultracode",
    harness: "claude-code",
  });
});

test("parseBatch rejects an unknown mode rather than silently downgrading it", () => {
  expect(parseBatch([{ repo: "embark", specialist: "Joaquim", mode: "telepathy" }])).toBeNull();
});

test("parseBatch rejects an unknown intensity rather than silently dropping it", () => {
  expect(parseBatch([{ repo: "embark", specialist: "Joaquim", intensity: "turbo" }])).toBeNull();
});

// Codex is registered (KNOWN_HARNESSES still probes it) but its adapter's
// containmentHook() returns null — see src/harness/codex.ts — so it must NOT
// show up as containable here. "generic" is also excluded (no containment
// hook), leaving only "claude-code".
test("buildSessionContext reports only containable harnesses (codex excluded — not containable)", async () => {
  const ctx = await buildSessionContext(async () => ({ code: 0, stdout: "agentop v1.9.0", stderr: "" }));
  expect(ctx.agentopOk).toBe(true);
  expect(ctx.containableHarnesses).toEqual(["claude-code"]);
});

// Pins the new specified behaviour end-to-end: a session-mode batch targeting
// harness: "codex" is REJECTED, since codexAdapter.containmentHook() is null
// and therefore "codex" never appears in containableHarnesses.
test("a session-mode batch targeting harness: codex is rejected as not-containable", async () => {
  const ctx = await buildSessionContext(async () => ({ code: 0, stdout: "agentop v1.9.0", stderr: "" }));
  const v = validateBatch(
    [{ repo: "embark", specialist: "Joaquim", mode: "session", harness: "codex" }],
    repos,
    roster,
    ctx,
  );
  expect(v.ok).toBe(false);
  expect(v.ok === false && v.rejects).toContain("harness-not-containable codex");
});
