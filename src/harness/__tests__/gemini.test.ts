import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureGeminiHooks, geminiAdapter } from "../gemini";
import { getAdapter, hasAdapter } from "../registry";
import { isContainable } from "../types";

test("gemini is registered and IS containable — folder trust is off by default, and its hook-identity warning does not block execution", () => {
  expect(hasAdapter("gemini")).toBe(true);
  expect(getAdapter("gemini").id).toBe("gemini");
  expect(isContainable(geminiAdapter)).toBe(true);
  expect(geminiAdapter.containmentHook()).not.toBeNull();
});

test("its agentopHarness is the agentop-facing name, distinct from the AIPe adapter id", () => {
  expect(geminiAdapter.agentopHarness).toBe("gemini");
});

test("gemini's hook uses its own event name (BeforeTool, not PreToolUse) and its own matcher (run_shell_command, not Bash)", () => {
  const merged = JSON.stringify(geminiAdapter.containmentHook()!.merge({}));
  expect(merged).toContain("BeforeTool");
  expect(merged).not.toContain("PreToolUse");
  expect(merged).toContain("run_shell_command");
  expect(merged).not.toContain('"Bash"');
  expect(merged).toContain("aipe session guard");
});

// Golden fixture — exact rendered shape, not a substring check. A silently
// malformed hook config is the worst failure here: it looks installed and
// denies nothing.
test("golden fixture: containmentHook().merge({}) renders the exact BeforeTool entry", () => {
  const merged = geminiAdapter.containmentHook()!.merge({});
  expect(merged).toEqual({
    hooks: {
      BeforeTool: [
        {
          matcher: "run_shell_command",
          hooks: [{ type: "command", command: "aipe session guard" }],
        },
      ],
    },
  });
});

// Mutation test: a fixture that no longer contains the real guard command
// (e.g. a typo'd command, or a matcher regressed back to "Bash") MUST fail
// the golden-fixture assertion above. Proves the test can actually catch a
// broken hook, not just recognize a well-formed one.
test("mutation: a broken/typo'd rendered hook fails the golden-fixture shape", () => {
  const merged = geminiAdapter.containmentHook()!.merge({});
  const broken = JSON.parse(JSON.stringify(merged));
  broken.hooks.BeforeTool[0].hooks[0].command = "aipe session gaurd"; // typo
  expect(() =>
    expect(broken.hooks.BeforeTool).toEqual([
      {
        matcher: "run_shell_command",
        hooks: [{ type: "command", command: "aipe session guard" }],
      },
    ]),
  ).toThrow();

  const brokenMatcher = JSON.parse(JSON.stringify(merged));
  brokenMatcher.hooks.BeforeTool[0].matcher = "Bash"; // wrong tool name for gemini
  expect(() =>
    expect(brokenMatcher.hooks.BeforeTool).toEqual([
      {
        matcher: "run_shell_command",
        hooks: [{ type: "command", command: "aipe session guard" }],
      },
    ]),
  ).toThrow();

  // Restore: the untouched original still matches.
  expect(merged).toEqual({
    hooks: {
      BeforeTool: [
        {
          matcher: "run_shell_command",
          hooks: [{ type: "command", command: "aipe session guard" }],
        },
      ],
    },
  });
});

test("merging is idempotent and preserves foreign settings", () => {
  const hook = geminiAdapter.containmentHook()!;
  const once = hook.merge({ model: "gemini-3-pro-preview", hooks: { SessionStart: [{ matcher: "*" }] } });
  const twice = hook.merge(once);
  expect(twice).toEqual(once);
  expect((twice as any).model).toBe("gemini-3-pro-preview");
  expect((twice as any).hooks.SessionStart).toHaveLength(1);
  expect((twice as any).hooks.BeforeTool).toHaveLength(1);
});

test("preserves a user's own unrelated BeforeTool entry and appends containment", () => {
  const hook = geminiAdapter.containmentHook()!;
  const userEntry = { matcher: "write_file", hooks: [{ type: "command", command: "my-own-linter" }] };
  const merged = hook.merge({ hooks: { BeforeTool: [userEntry] } });
  const beforeTool = (merged as any).hooks.BeforeTool;
  expect(beforeTool).toHaveLength(2);
  expect(beforeTool[0]).toEqual(userEntry);
  expect(beforeTool[1].hooks[0].command).toBe("aipe session guard");

  const mergedAgain = hook.merge(merged);
  expect((mergedAgain as any).hooks.BeforeTool).toHaveLength(2);
});

test("a persona is wrapped with frontmatter the harness reads", () => {
  const wrapped = geminiAdapter.wrapPersona("You are Joaquim.", {
    slug: "joaquim", role: "dev-fullstack", repo: "embark", package: null, stack: ["ts"],
  });
  expect(wrapped.startsWith("---\n")).toBe(true);
  expect(wrapped).toContain("name: joaquim");
  expect(wrapped).toContain("You are Joaquim.");
});

test("persona and flow-skill targets live under .agents/skills/ (cross-tool convention, nothing gemini-native documented)", () => {
  expect(geminiAdapter.personaTarget("joaquim")).toEqual({
    relDir: join(".agents", "skills", "joaquim"),
    filename: "SKILL.md",
  });
  expect(geminiAdapter.flowSkillTarget("operate")).toEqual({
    relDir: join(".agents", "skills", "operate"),
    filename: "SKILL.md",
  });
});

test("startupDelivery is hook-mode (Gemini documents a SessionStart hook)", () => {
  const delivery = geminiAdapter.startupDelivery("awareness");
  expect(delivery.mode).toBe("hook");
  if (delivery.mode === "hook") {
    expect(delivery.command).toBe("aipe session-context");
  }
});

test("mcpConfigPath is .gemini/settings.json (mcpServers key lives there, not a separate .mcp.json)", () => {
  expect(geminiAdapter.mcpConfigPath("workspace")).toBe(join(".gemini", "settings.json"));
  expect(geminiAdapter.mcpConfigPath("repo", "embark")).toBe(join("embark", ".gemini", "settings.json"));
});

// Pins the tier hierarchy per geminicli.com/docs/get-started/gemini-3/ and
// reference/configuration/: gemini-3-pro-preview is the flagship ("presented
// as the flagship model for complex operations") → frontier; gemini-2.5-pro
// is its documented fallback → reasoning; gemini-3-flash-preview is the
// balanced tier → standard; gemini-2.5-flash-lite is cheapest/fastest → fast.
test("model tiers resolve to real gemini model ids, and an unknown tier returns null", () => {
  expect(geminiAdapter.resolveModel("fast")).toEqual({ id: "gemini-2.5-flash-lite", label: "Gemini 2.5 Flash-Lite" });
  expect(geminiAdapter.resolveModel("standard")).toEqual({ id: "gemini-3-flash-preview", label: "Gemini 3 Flash" });
  expect(geminiAdapter.resolveModel("reasoning")).toEqual({ id: "gemini-2.5-pro", label: "Gemini 2.5 Pro" });
  expect(geminiAdapter.resolveModel("frontier")).toEqual({ id: "gemini-3-pro-preview", label: "Gemini 3 Pro" });
  expect(geminiAdapter.resolveModel("nonsense")).toBeNull();
});

test("installIntegration writes the hooks file + skills, and is idempotent", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-gemini-"));
  try {
    await geminiAdapter.installIntegration(dir);
    const config = JSON.parse(await readFile(join(dir, ".gemini", "settings.json"), "utf8"));
    expect(config.hooks.BeforeTool[0].hooks[0].command).toBe("aipe session guard");
    expect(config.hooks.BeforeTool[0].matcher).toBe("run_shell_command");
    expect(config.hooks.SessionStart[0].hooks[0].command).toBe("aipe session-context");
    const skill = await readFile(join(dir, ".agents", "skills", "operate", "SKILL.md"), "utf8");
    expect(skill).toContain("name:");

    // Idempotent: installing twice must not duplicate either hook entry.
    await geminiAdapter.installIntegration(dir);
    const again = JSON.parse(await readFile(join(dir, ".gemini", "settings.json"), "utf8"));
    expect(again.hooks.BeforeTool).toHaveLength(1);
    expect(again.hooks.SessionStart).toHaveLength(1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("ensureGeminiHooks preserves a foreign settings.json entry the user already had", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-gemini-"));
  try {
    await mkdir(join(dir, ".gemini"), { recursive: true });
    await writeFile(
      join(dir, ".gemini", "settings.json"),
      JSON.stringify({ hooks: { BeforeTool: [{ matcher: "write_file", hooks: [{ type: "command", command: "my-linter" }] }] } }),
      "utf8",
    );
    await ensureGeminiHooks(dir);
    const config = JSON.parse(await readFile(join(dir, ".gemini", "settings.json"), "utf8"));
    expect(config.hooks.BeforeTool).toHaveLength(2);
    expect(config.hooks.BeforeTool[0].hooks[0].command).toBe("my-linter");
    expect(config.hooks.BeforeTool[1].hooks[0].command).toBe("aipe session guard");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// Error classes: absent, empty, malformed JSON, and `hooks: null` must all
// behave as "start fresh", never throw and never silently produce a
// malformed config.
test("ensureGeminiHooks tolerates an absent, empty, or malformed settings.json", async () => {
  for (const content of [undefined, "", "not json{{{", "42"]) {
    const dir = await mkdtemp(join(tmpdir(), "aipe-gemini-"));
    try {
      if (content !== undefined) {
        await mkdir(join(dir, ".gemini"), { recursive: true });
        await writeFile(join(dir, ".gemini", "settings.json"), content, "utf8");
      }
      await ensureGeminiHooks(dir);
      const config = JSON.parse(await readFile(join(dir, ".gemini", "settings.json"), "utf8"));
      expect(config.hooks.BeforeTool[0].hooks[0].command).toBe("aipe session guard");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

test("ensureGeminiHooks tolerates hooks: null in an existing file", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-gemini-"));
  try {
    await mkdir(join(dir, ".gemini"), { recursive: true });
    await writeFile(join(dir, ".gemini", "settings.json"), JSON.stringify({ hooks: null }), "utf8");
    await ensureGeminiHooks(dir);
    const config = JSON.parse(await readFile(join(dir, ".gemini", "settings.json"), "utf8"));
    expect(config.hooks.BeforeTool[0].hooks[0].command).toBe("aipe session guard");
    expect(config.hooks.SessionStart[0].hooks[0].command).toBe("aipe session-context");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// Installing twice (a second ensureGeminiHooks call against an already-merged
// file) must not duplicate either hook entry.
test("installing twice does not duplicate hooks", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-gemini-"));
  try {
    await ensureGeminiHooks(dir);
    await ensureGeminiHooks(dir);
    const config = JSON.parse(await readFile(join(dir, ".gemini", "settings.json"), "utf8"));
    expect(config.hooks.BeforeTool).toHaveLength(1);
    expect(config.hooks.SessionStart).toHaveLength(1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
