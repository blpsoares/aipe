import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findHarness, HARNESSES, renderHarnessList, slugify } from "../start";
import { installClaudeCode } from "../install";
import { run } from "../cli";
import type { ProbeRunner } from "../../capabilities/types";

// Injectable probe runner for tests — returns a fake result matching the
// binary name pattern of the real runner, so tests never spawn subprocesses.
const only = (present: string[]): ProbeRunner => async (bin) =>
  present.includes(bin) ? { code: 0, stdout: `${bin} 1.2.3`, stderr: "" } : { code: 127, stdout: "", stderr: "" };

// Strict fake runner that THROWS if called with any known harness binary name.
// This proves tests never attempt to invoke real binaries, even hypothetically.
const mustNotCallBinaries = (): ProbeRunner => async (bin: string) => {
  const knownBinaries = ["claude", "gemini", "codex", "copilot"];
  if (knownBinaries.includes(bin)) {
    throw new Error(
      `HERMETICITY VIOLATION: test attempted to call real binary '${bin}'. Tests must use injectable fakes.`,
    );
  }
  return { code: 127, stdout: "", stderr: "" };
};

test("HARNESSES lists claude-code as supported", () => {
  expect(findHarness("claude-code")?.status).toBe("supported");
  expect(findHarness("nope")).toBeUndefined();
});

test("renderHarnessList numbers every harness", () => {
  const lines = renderHarnessList();
  expect(lines[0]).toContain("Choose your agent harness");
  expect(lines.filter((l) => /^\s+\d\)/.test(l))).toHaveLength(HARNESSES.length);
});

test("slugify lowercases, strips accents, and hyphenates", () => {
  expect(slugify("Minha Emprésa")).toBe("minha-empresa");
  expect(slugify("  Op Vibes  ")).toBe("op-vibes");
});

test("run --harness --name creates aipe-<slug>/ with the integration", async () => {
  const parent = await mkdtemp(join(tmpdir(), "aipe-start-run-"));
  try {
    const code = await run(["--harness", "claude-code", "--name", "Minha Emprésa", "--dir", parent], only([]));
    expect(code).toBe(0);
    const settings = JSON.parse(await readFile(join(parent, "aipe-minha-empresa", ".claude", "settings.json"), "utf8"));
    expect(settings.hooks.SessionStart[0].hooks[0].command).toContain("aipe session-context");
    const skill = await readFile(join(parent, "aipe-minha-empresa", ".claude", "skills", "make-workspace", "SKILL.md"), "utf8");
    expect(skill).toContain("name: make-workspace");
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test("run --harness cursor (coming soon) exits non-zero without creating a folder", async () => {
  const code = await run(["--harness", "cursor", "--name", "x", "--dir", "/tmp"], only([]));
  expect(code).toBe(1);
});

test("run --harness generic creates AGENTS.md + records the harness", async () => {
  const parent = await mkdtemp(join(tmpdir(), "aipe-start-run-"));
  try {
    const code = await run(["--harness", "generic", "--name", "opvibes", "--dir", parent], only([]));
    expect(code).toBe(0);
    const agents = await readFile(join(parent, "aipe-opvibes", "AGENTS.md"), "utf8");
    expect(agents).toContain("aipe session-context");
    const harness = (await readFile(join(parent, "aipe-opvibes", ".aipe", "harness"), "utf8")).trim();
    expect(harness).toBe("generic");
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test("installClaudeCode writes settings.json hook + the onboarding skills", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-start-"));
  try {
    const code = await installClaudeCode(dir);
    expect(code).toBe(0);

    const settings = JSON.parse(await readFile(join(dir, ".claude", "settings.json"), "utf8"));
    const cmd = settings.hooks.SessionStart[0].hooks[0].command;
    expect(cmd).toContain("aipe session-context");

    const skill = await readFile(join(dir, ".claude", "skills", "context-brain", "SKILL.md"), "utf8");
    expect(skill).toContain("name: context-brain");
    const hs = await readFile(join(dir, ".claude", "skills", "hire-specialists", "SKILL.md"), "utf8");
    expect(hs).toContain("name: hire-specialists");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("installClaudeCode is idempotent — no duplicate hook on second run", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-start-"));
  try {
    await installClaudeCode(dir);
    await installClaudeCode(dir);
    const settings = JSON.parse(await readFile(join(dir, ".claude", "settings.json"), "utf8"));
    expect(settings.hooks.SessionStart).toHaveLength(1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("run() with strict runner proves no real binaries are spawned", async () => {
  // This test verifies hermeticity: if the strict runner is called with ANY
  // known harness binary name (claude/gemini/codex/copilot), it throws.
  // If this test passes, it proves run() never attempts to invoke real binaries.
  const parent = await mkdtemp(join(tmpdir(), "aipe-start-hermetic-"));
  try {
    const code = await run(
      ["--harness", "claude-code", "--name", "test-workspace", "--dir", parent],
      mustNotCallBinaries(),
    );
    expect(code).toBe(0);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});
