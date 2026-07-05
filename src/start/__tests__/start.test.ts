import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findHarness, HARNESSES, renderHarnessList, slugify } from "../start";
import { installClaudeCode } from "../install";
import { run } from "../cli";

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
  expect(slugify("Eletromídia")).toBe("eletromidia");
  expect(slugify("  Op Vibes  ")).toBe("op-vibes");
});

test("run --harness --name creates aipe-<slug>/ with the integration", async () => {
  const parent = await mkdtemp(join(tmpdir(), "aipe-start-run-"));
  try {
    const code = await run(["--harness", "claude-code", "--name", "Eletromídia", "--dir", parent]);
    expect(code).toBe(0);
    const settings = JSON.parse(await readFile(join(parent, "aipe-eletromidia", ".claude", "settings.json"), "utf8"));
    expect(settings.hooks.SessionStart[0].hooks[0].command).toContain("aipe session-context");
    const skill = await readFile(join(parent, "aipe-eletromidia", ".claude", "skills", "make-workspace", "SKILL.md"), "utf8");
    expect(skill).toContain("name: make-workspace");
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test("run --harness cursor (coming soon) exits non-zero without creating a folder", async () => {
  const code = await run(["--harness", "cursor", "--name", "x", "--dir", "/tmp"]);
  expect(code).toBe(1);
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
