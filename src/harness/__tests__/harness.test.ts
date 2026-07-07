import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { claudeCodeAdapter } from "../claude-code";
import { genericAdapter } from "../generic";
import { DEFAULT_HARNESS, getAdapter, readHarness, resolveAdapter, writeHarness } from "../registry";
import type { PersonaMeta } from "../types";

const meta: PersonaMeta = { slug: "ana", role: "dev-fullstack", repo: "prontuario", package: "api", stack: ["hono"] };

test("getAdapter resolves known ids and falls back to Claude Code", () => {
  expect(getAdapter("claude-code").id).toBe("claude-code");
  expect(getAdapter("generic").id).toBe("generic");
  expect(getAdapter(undefined).id).toBe(DEFAULT_HARNESS);
  expect(getAdapter("nonexistent").id).toBe("claude-code");
});

test("claude-code adapter: SessionStart hook delivery + SKILL.md persona", () => {
  const delivery = claudeCodeAdapter.startupDelivery("awareness");
  expect(delivery.mode).toBe("hook");
  const target = claudeCodeAdapter.personaTarget("ana");
  expect(target).toEqual({ relDir: join(".claude", "skills", "ana"), filename: "SKILL.md" });
  const file = claudeCodeAdapter.wrapPersona("You are Ana.", meta);
  expect(file).toContain("name: ana");
  expect(file).toContain("for the prontuario/api package (hono).");
  expect(file.startsWith("---\n")).toBe(true);
});

test("generic adapter: file delivery + AGENTS-style persona (no frontmatter)", () => {
  const delivery = genericAdapter.startupDelivery("live awareness text");
  expect(delivery.mode).toBe("file");
  if (delivery.mode === "file") {
    expect(delivery.path).toBe("AGENTS.md");
    expect(delivery.content).toContain("live awareness text");
  }
  const target = genericAdapter.personaTarget("ana");
  expect(target).toEqual({ relDir: ".aipe-personas", filename: "ana.md" });
  const file = genericAdapter.wrapPersona("You are Ana.", meta);
  expect(file).toContain("# ana");
  expect(file).toContain("prontuario/api");
  expect(file.startsWith("---")).toBe(false); // no Claude Code frontmatter
});

test("claude-code installIntegration writes the hook + skills", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-hn-"));
  try {
    const report = await claudeCodeAdapter.installIntegration(dir);
    expect(report.files.length).toBeGreaterThan(0);
    const settings = JSON.parse(await readFile(join(dir, ".claude", "settings.json"), "utf8"));
    expect(settings.hooks.SessionStart[0].hooks[0].command).toContain("aipe session-context");
    const skill = await readFile(join(dir, ".claude", "skills", "operate", "SKILL.md"), "utf8");
    expect(skill).toContain("name:");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("generic installIntegration writes AGENTS.md + flows", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-hn-"));
  try {
    await genericAdapter.installIntegration(dir);
    const agents = await readFile(join(dir, "AGENTS.md"), "utf8");
    expect(agents).toContain("aipe session-context");
    expect(agents).toContain("context-brain");
    const flow = await readFile(join(dir, ".aipe", "flows", "operate.md"), "utf8");
    expect(flow).toContain("name:");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("writeHarness/readHarness round-trip; unknown id → default", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-hn-"));
  try {
    expect(await readHarness(dir)).toBe(DEFAULT_HARNESS); // absent
    await writeHarness(dir, "generic");
    expect(await readHarness(dir)).toBe("generic");
    expect((await resolveAdapter(dir)).id).toBe("generic");
    await mkdir(join(dir, ".aipe"), { recursive: true });
    await writeFile(join(dir, ".aipe", "harness"), "bogus\n", "utf8");
    expect(await readHarness(dir)).toBe(DEFAULT_HARNESS); // unknown → default
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
