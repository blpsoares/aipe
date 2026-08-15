// NOTE on a deliberate deviation from the plan's sketch: the task brief's
// Step 2 example test read `copilotAdapter.containmentHook()!.merge({})`,
// which presumes containmentHook() is non-null. Re-verifying Copilot CLI's
// own docs (see the header comment in ../copilot.ts) found a default-on
// directory-trust confirmation prompt that a freshly created AIPe worktree
// does not satisfy, and no official confirmation that it's safely skipped
// under AIPe's fully non-interactive dispatch — the same shape of problem
// that ruled Codex out, so copilotAdapter.containmentHook() returns null
// here too. This file tests the RENDERED on-disk hook (written by
// installIntegration/ensureCopilotHooks regardless, exactly as Codex's file
// does for the same reason) rather than calling containmentHook()!.merge(),
// which would be a type error against a `ContainmentHook | null` return.
import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { copilotAdapter, ensureCopilotHooks } from "../copilot";
import { getAdapter, hasAdapter } from "../registry";
import { isContainable } from "../types";

test("copilot is registered but NOT containable — its directory-trust prompt is default-on and AIPe dispatch is non-interactive", () => {
  expect(hasAdapter("copilot")).toBe(true);
  expect(getAdapter("copilot").id).toBe("copilot");
  expect(isContainable(copilotAdapter)).toBe(false);
  expect(copilotAdapter.containmentHook()).toBeNull();
});

test("its agentopHarness is the agentop-facing name, distinct from the AIPe adapter id", () => {
  expect(copilotAdapter.agentopHarness).toBe("copilot");
});

// The preToolUse hook is still written to `.github/hooks/aipe.json` by
// `installIntegration` (it stays present so a later resolution of the
// directory-trust question doesn't require a re-install) — only the
// containability ACCESSOR reports null.

test("copilot's hook uses its own event name (lowercase preToolUse) and runs the guard", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-copilot-"));
  try {
    await copilotAdapter.installIntegration(dir);
    const config = JSON.parse(await readFile(join(dir, ".github", "hooks", "aipe.json"), "utf8"));
    const merged = JSON.stringify(config);
    expect(merged).toContain("preToolUse");
    expect(merged).not.toContain("PreToolUse");
    expect(merged).toContain("aipe session guard");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// Golden fixture — exact rendered shape, not a substring check. A silently
// malformed hook config is the worst failure here: it looks installed and
// denies nothing (even though, per the finding above, Copilot never actually
// clears its directory-trust gate without a human, under AIPe's dispatch).
test("golden fixture: the exact rendered .github/hooks/aipe.json for a fresh install", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-copilot-"));
  try {
    await copilotAdapter.installIntegration(dir);
    const config = JSON.parse(await readFile(join(dir, ".github", "hooks", "aipe.json"), "utf8"));
    expect(config.version).toBe(1);
    expect(config.hooks.preToolUse).toEqual([
      { type: "command", bash: "aipe session guard", matcher: "bash" },
    ]);
    expect(config.hooks.sessionStart).toEqual([
      { type: "command", bash: "aipe session-context" },
    ]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// Mutation test: a fixture that no longer contains the real guard command
// (e.g. a typo'd command, or the containment entry silently dropped) MUST
// fail the golden-fixture assertion above.
test("mutation: a broken/typo'd rendered hook fails the golden-fixture shape", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-copilot-"));
  try {
    await copilotAdapter.installIntegration(dir);
    const rendered = JSON.parse(await readFile(join(dir, ".github", "hooks", "aipe.json"), "utf8"));
    const broken = JSON.parse(JSON.stringify(rendered));
    broken.hooks.preToolUse[0].bash = "aipe session gaurd"; // typo
    expect(() =>
      expect(broken.hooks.preToolUse).toEqual([
        { type: "command", bash: "aipe session guard", matcher: "bash" },
      ]),
    ).toThrow();

    // Restore: the untouched original still matches.
    expect(rendered.hooks.preToolUse).toEqual([
      { type: "command", bash: "aipe session guard", matcher: "bash" },
    ]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("merging is idempotent and preserves foreign keys", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-copilot-"));
  try {
    await mkdir(join(dir, ".github", "hooks"), { recursive: true });
    await writeFile(join(dir, ".github", "hooks", "aipe.json"), JSON.stringify({ someOtherSetting: 1 }), "utf8");
    await ensureCopilotHooks(dir);
    const once = JSON.parse(await readFile(join(dir, ".github", "hooks", "aipe.json"), "utf8"));
    expect(once.someOtherSetting).toBe(1);

    await ensureCopilotHooks(dir);
    const twice = JSON.parse(await readFile(join(dir, ".github", "hooks", "aipe.json"), "utf8"));
    expect(twice).toEqual(once);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("preserves a user's own unrelated preToolUse entry and appends containment", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-copilot-"));
  try {
    const userEntry = { type: "command", bash: "my-own-linter", matcher: "edit" };
    await mkdir(join(dir, ".github", "hooks"), { recursive: true });
    await writeFile(
      join(dir, ".github", "hooks", "aipe.json"),
      JSON.stringify({ hooks: { preToolUse: [userEntry] } }),
      "utf8",
    );

    await ensureCopilotHooks(dir);
    const merged = JSON.parse(await readFile(join(dir, ".github", "hooks", "aipe.json"), "utf8"));
    const preToolUse = merged.hooks.preToolUse;
    expect(preToolUse).toHaveLength(2);
    expect(preToolUse[0]).toEqual(userEntry);
    expect(preToolUse[1].bash).toBe("aipe session guard");

    await ensureCopilotHooks(dir);
    const mergedAgain = JSON.parse(await readFile(join(dir, ".github", "hooks", "aipe.json"), "utf8"));
    expect(mergedAgain.hooks.preToolUse).toHaveLength(2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a persona is wrapped with frontmatter the harness reads", () => {
  const wrapped = copilotAdapter.wrapPersona("You are Joaquim.", {
    slug: "joaquim", role: "dev-fullstack", repo: "embark", package: null, stack: ["ts"],
  });
  expect(wrapped.startsWith("---\n")).toBe(true);
  expect(wrapped).toContain("name: joaquim");
  expect(wrapped).toContain("You are Joaquim.");
});

test("persona and flow-skill targets live under .agents/skills/ (cross-tool convention, nothing copilot-native documented)", () => {
  expect(copilotAdapter.personaTarget("joaquim")).toEqual({
    relDir: join(".agents", "skills", "joaquim"),
    filename: "SKILL.md",
  });
  expect(copilotAdapter.flowSkillTarget("operate")).toEqual({
    relDir: join(".agents", "skills", "operate"),
    filename: "SKILL.md",
  });
});

test("startupDelivery is hook-mode (Copilot documents a sessionStart hook)", () => {
  const delivery = copilotAdapter.startupDelivery("awareness");
  expect(delivery.mode).toBe("hook");
  if (delivery.mode === "hook") {
    expect(delivery.command).toBe("aipe session-context");
  }
});

test("mcpConfigPath is .mcp.json (Copilot CLI reads Claude Code's config surfaces directly)", () => {
  expect(copilotAdapter.mcpConfigPath("workspace")).toBe(".mcp.json");
  expect(copilotAdapter.mcpConfigPath("repo", "embark")).toBe(join("embark", ".mcp.json"));
});

// Pins the tier hierarchy per CLI-specific docs (cli-best-practices and
// cli-programmatic-reference, not the generic cross-client supported-models
// table): claude-opus-4.5 is the documented CLI default AND flagship → the
// frontier tier; claude-sonnet-4.5 is the balanced everyday tier → standard;
// claude-haiku-4.5 is the docs' own "fast, lower cost" pick → fast;
// gpt-5.3-codex is the docs' "more powerful... for complex tasks" pick →
// reasoning.
test("model tiers resolve to real copilot model ids, and an unknown tier returns null", () => {
  expect(copilotAdapter.resolveModel("fast")).toEqual({ id: "claude-haiku-4.5", label: "Claude Haiku 4.5" });
  expect(copilotAdapter.resolveModel("standard")).toEqual({ id: "claude-sonnet-4.5", label: "Claude Sonnet 4.5" });
  expect(copilotAdapter.resolveModel("reasoning")).toEqual({ id: "gpt-5.3-codex", label: "GPT-5.3 Codex" });
  expect(copilotAdapter.resolveModel("frontier")).toEqual({ id: "claude-opus-4.5", label: "Claude Opus 4.5" });
  expect(copilotAdapter.resolveModel("nonsense")).toBeNull();
});

test("installIntegration writes the hooks file + skills, and is idempotent", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-copilot-"));
  try {
    await copilotAdapter.installIntegration(dir);
    const config = JSON.parse(await readFile(join(dir, ".github", "hooks", "aipe.json"), "utf8"));
    expect(config.hooks.preToolUse[0].bash).toBe("aipe session guard");
    expect(config.hooks.sessionStart[0].bash).toBe("aipe session-context");
    const skill = await readFile(join(dir, ".agents", "skills", "operate", "SKILL.md"), "utf8");
    expect(skill).toContain("name:");

    // Idempotent: installing twice must not duplicate either hook entry.
    await copilotAdapter.installIntegration(dir);
    const again = JSON.parse(await readFile(join(dir, ".github", "hooks", "aipe.json"), "utf8"));
    expect(again.hooks.preToolUse).toHaveLength(1);
    expect(again.hooks.sessionStart).toHaveLength(1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// Error classes: absent, empty, malformed JSON, and `hooks: null` must all
// behave as "start fresh", never throw and never silently produce a
// malformed config.
test("ensureCopilotHooks tolerates an absent, empty, or malformed aipe.json", async () => {
  for (const content of [undefined, "", "not json{{{", "42"]) {
    const dir = await mkdtemp(join(tmpdir(), "aipe-copilot-"));
    try {
      if (content !== undefined) {
        await mkdir(join(dir, ".github", "hooks"), { recursive: true });
        await writeFile(join(dir, ".github", "hooks", "aipe.json"), content, "utf8");
      }
      await ensureCopilotHooks(dir);
      const config = JSON.parse(await readFile(join(dir, ".github", "hooks", "aipe.json"), "utf8"));
      expect(config.hooks.preToolUse[0].bash).toBe("aipe session guard");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

test("ensureCopilotHooks tolerates hooks: null in an existing file", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-copilot-"));
  try {
    await mkdir(join(dir, ".github", "hooks"), { recursive: true });
    await writeFile(join(dir, ".github", "hooks", "aipe.json"), JSON.stringify({ hooks: null }), "utf8");
    await ensureCopilotHooks(dir);
    const config = JSON.parse(await readFile(join(dir, ".github", "hooks", "aipe.json"), "utf8"));
    expect(config.hooks.preToolUse[0].bash).toBe("aipe session guard");
    expect(config.hooks.sessionStart[0].bash).toBe("aipe session-context");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
