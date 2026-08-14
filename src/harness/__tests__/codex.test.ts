import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { codexAdapter, ensureCodexHooks } from "../codex";
import { getAdapter, hasAdapter } from "../registry";
import { isContainable } from "../types";

test("codex is registered and containable", () => {
  expect(hasAdapter("codex")).toBe(true);
  expect(getAdapter("codex").id).toBe("codex");
  expect(isContainable(codexAdapter)).toBe(true);
});

test("its agentopHarness is the agentop-facing name, distinct from the AIPe adapter id", () => {
  expect(codexAdapter.agentopHarness).toBe("codex");
});

test("its containment hook targets a PreToolUse Bash matcher running the guard", () => {
  const hook = codexAdapter.containmentHook()!;
  const merged = JSON.stringify(hook.merge({}));
  expect(merged).toContain("PreToolUse");
  expect(merged).toContain("Bash");
  expect(merged).toContain("aipe session guard");
});

// Golden fixture — exact rendered shape, not a substring check. A silently
// malformed hook config is the worst failure here: it looks installed and
// denies nothing.
test("golden fixture: the exact rendered .codex/hooks.json for a fresh merge", () => {
  const hook = codexAdapter.containmentHook()!;
  expect(hook.relPath).toBe(join(".codex", "hooks.json"));
  expect(hook.merge({})).toEqual({
    hooks: {
      PreToolUse: [
        {
          matcher: "Bash",
          hooks: [{ type: "command", command: "aipe session guard" }],
        },
      ],
    },
  });
});

// Mutation test: a fixture that no longer contains the real guard command
// (e.g. a typo'd command, or the containment entry silently dropped) MUST
// fail the golden-fixture assertion above. Proves the test can actually
// catch a broken hook, not just a well-formed one.
test("mutation: a broken/typo'd rendered hook fails the golden-fixture shape", () => {
  const hook = codexAdapter.containmentHook()!;
  const rendered = hook.merge({}) as any;
  const broken = JSON.parse(JSON.stringify(rendered));
  broken.hooks.PreToolUse[0].hooks[0].command = "aipe session gaurd"; // typo
  expect(() =>
    expect(broken).toEqual({
      hooks: {
        PreToolUse: [
          {
            matcher: "Bash",
            hooks: [{ type: "command", command: "aipe session guard" }],
          },
        ],
      },
    }),
  ).toThrow();

  // Restore: the untouched original still matches.
  expect(rendered).toEqual({
    hooks: {
      PreToolUse: [
        {
          matcher: "Bash",
          hooks: [{ type: "command", command: "aipe session guard" }],
        },
      ],
    },
  });
});

test("merging is idempotent and preserves foreign keys", () => {
  const hook = codexAdapter.containmentHook()!;
  const once = hook.merge({ someOtherSetting: 1 });
  expect(hook.merge(once)).toEqual(once);
  expect((once as any).someOtherSetting).toBe(1);
});

test("preserves a user's own unrelated PreToolUse entry and appends containment", () => {
  const hook = codexAdapter.containmentHook()!;
  const userEntry = { matcher: "Write", hooks: [{ type: "command", command: "my-own-linter" }] };
  const withUserEntry = { hooks: { PreToolUse: [userEntry] } };
  const merged = hook.merge(withUserEntry);
  const preToolUse = (merged as any).hooks.PreToolUse;
  expect(preToolUse).toHaveLength(2);
  expect(preToolUse[0]).toEqual(userEntry);
  expect(preToolUse[1].hooks[0].command).toBe("aipe session guard");

  const mergedAgain = hook.merge(merged);
  expect((mergedAgain as any).hooks.PreToolUse).toHaveLength(2);
});

test("hooks: null (malformed-but-parseable) is treated the same as absent", () => {
  const hook = codexAdapter.containmentHook()!;
  const merged = hook.merge({ hooks: null }) as any;
  expect(merged.hooks.PreToolUse).toHaveLength(1);
  expect(merged.hooks.PreToolUse[0].hooks[0].command).toBe("aipe session guard");
});

test("a persona is wrapped with frontmatter the harness reads", () => {
  const wrapped = codexAdapter.wrapPersona("You are Joaquim.", {
    slug: "joaquim", role: "dev-fullstack", repo: "embark", package: null, stack: ["ts"],
  });
  expect(wrapped.startsWith("---\n")).toBe(true);
  expect(wrapped).toContain("name: joaquim");
  expect(wrapped).toContain("You are Joaquim.");
});

test("persona and flow-skill targets live under .agents/skills/, not .codex/skills/", () => {
  expect(codexAdapter.personaTarget("joaquim")).toEqual({
    relDir: join(".agents", "skills", "joaquim"),
    filename: "SKILL.md",
  });
  expect(codexAdapter.flowSkillTarget("operate")).toEqual({
    relDir: join(".agents", "skills", "operate"),
    filename: "SKILL.md",
  });
});

test("startupDelivery is hook-mode (Codex documents a SessionStart hook)", () => {
  const delivery = codexAdapter.startupDelivery("awareness");
  expect(delivery.mode).toBe("hook");
  if (delivery.mode === "hook") {
    expect(delivery.command).toBe("aipe session-context");
  }
});

test("mcpConfigPath is .codex/config.toml, not .mcp.json", () => {
  expect(codexAdapter.mcpConfigPath("workspace")).toBe(join(".codex", "config.toml"));
  expect(codexAdapter.mcpConfigPath("repo", "embark")).toBe(join("embark", ".codex", "config.toml"));
});

test("model tiers resolve to real codex model ids", () => {
  expect(codexAdapter.resolveModel("standard")).not.toBeNull();
  expect(codexAdapter.resolveModel("nonsense")).toBeNull();
});

test("installIntegration writes the hooks file + skills, and is idempotent", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-codex-"));
  try {
    await codexAdapter.installIntegration(dir);
    const config = JSON.parse(await readFile(join(dir, ".codex", "hooks.json"), "utf8"));
    expect(config.hooks.PreToolUse[0].hooks[0].command).toBe("aipe session guard");
    expect(config.hooks.SessionStart[0].hooks[0].command).toBe("aipe session-context");
    const skill = await readFile(join(dir, ".agents", "skills", "operate", "SKILL.md"), "utf8");
    expect(skill).toContain("name:");

    // Idempotent: installing twice must not duplicate either hook entry.
    await codexAdapter.installIntegration(dir);
    const again = JSON.parse(await readFile(join(dir, ".codex", "hooks.json"), "utf8"));
    expect(again.hooks.PreToolUse).toHaveLength(1);
    expect(again.hooks.SessionStart).toHaveLength(1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("ensureCodexHooks preserves a foreign hooks.json entry the user already had", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-codex-"));
  try {
    await mkdir(join(dir, ".codex"), { recursive: true });
    await writeFile(
      join(dir, ".codex", "hooks.json"),
      JSON.stringify({ hooks: { PreToolUse: [{ matcher: "Write", hooks: [{ type: "command", command: "my-linter" }] }] } }),
      "utf8",
    );
    await ensureCodexHooks(dir);
    const config = JSON.parse(await readFile(join(dir, ".codex", "hooks.json"), "utf8"));
    expect(config.hooks.PreToolUse).toHaveLength(2);
    expect(config.hooks.PreToolUse[0].hooks[0].command).toBe("my-linter");
    expect(config.hooks.PreToolUse[1].hooks[0].command).toBe("aipe session guard");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// Error classes: absent, empty, malformed JSON, and `hooks: null` must all
// behave as "start fresh", never throw and never silently produce a
// malformed config.
test("ensureCodexHooks tolerates an absent, empty, or malformed hooks.json", async () => {
  for (const content of [undefined, "", "not json{{{", "42"]) {
    const dir = await mkdtemp(join(tmpdir(), "aipe-codex-"));
    try {
      if (content !== undefined) {
        await mkdir(join(dir, ".codex"), { recursive: true });
        await writeFile(join(dir, ".codex", "hooks.json"), content, "utf8");
      }
      await ensureCodexHooks(dir);
      const config = JSON.parse(await readFile(join(dir, ".codex", "hooks.json"), "utf8"));
      expect(config.hooks.PreToolUse[0].hooks[0].command).toBe("aipe session guard");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

test("ensureCodexHooks tolerates hooks: null in an existing file", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-codex-"));
  try {
    await mkdir(join(dir, ".codex"), { recursive: true });
    await writeFile(join(dir, ".codex", "hooks.json"), JSON.stringify({ hooks: null }), "utf8");
    await ensureCodexHooks(dir);
    const config = JSON.parse(await readFile(join(dir, ".codex", "hooks.json"), "utf8"));
    expect(config.hooks.PreToolUse[0].hooks[0].command).toBe("aipe session guard");
    expect(config.hooks.SessionStart[0].hooks[0].command).toBe("aipe session-context");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
