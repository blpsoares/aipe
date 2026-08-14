import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { codexAdapter, ensureCodexHooks } from "../codex";
import { getAdapter, hasAdapter } from "../registry";
import { isContainable } from "../types";

test("codex is registered but NOT containable — session dispatch cannot govern it", () => {
  expect(hasAdapter("codex")).toBe(true);
  expect(getAdapter("codex").id).toBe("codex");
  // Codex requires a human to interactively `/hooks`-trust a non-managed hook
  // before it loads; AIPe's session dispatch is fully non-interactive, so a
  // Codex PreToolUse hook is present on disk but never trusted → inert. See
  // the block comment at codexAdapter.containmentHook()'s definition.
  expect(isContainable(codexAdapter)).toBe(false);
  expect(codexAdapter.containmentHook()).toBeNull();
});

test("its agentopHarness is the agentop-facing name, distinct from the AIPe adapter id", () => {
  expect(codexAdapter.agentopHarness).toBe("codex");
});

// The PreToolUse hook is still written to `.codex/hooks.json` by
// `installIntegration` (it stays present so a human trusting it later via
// `/hooks` doesn't require a re-install) — it's only the containability
// ACCESSOR that reports null. These tests exercise that on-disk rendering
// via `installIntegration`/`ensureCodexHooks`, not via `containmentHook()`.

test("installIntegration renders a PreToolUse Bash matcher running the guard", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-codex-"));
  try {
    await codexAdapter.installIntegration(dir);
    const config = JSON.parse(await readFile(join(dir, ".codex", "hooks.json"), "utf8"));
    const merged = JSON.stringify(config);
    expect(merged).toContain("PreToolUse");
    expect(merged).toContain("Bash");
    expect(merged).toContain("aipe session guard");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// Golden fixture — exact rendered shape, not a substring check. A silently
// malformed hook config is the worst failure here: it looks installed and
// denies nothing (even though, per the finding above, Codex never actually
// trusts it without a human running `/hooks`).
test("golden fixture: the exact rendered .codex/hooks.json for a fresh install", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-codex-"));
  try {
    await codexAdapter.installIntegration(dir);
    const config = JSON.parse(await readFile(join(dir, ".codex", "hooks.json"), "utf8"));
    expect(config.hooks.PreToolUse).toEqual([
      {
        matcher: "Bash",
        hooks: [{ type: "command", command: "aipe session guard" }],
      },
    ]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// Mutation test: a fixture that no longer contains the real guard command
// (e.g. a typo'd command, or the containment entry silently dropped) MUST
// fail the golden-fixture assertion above. Proves the test can actually
// catch a broken hook, not just a well-formed one.
test("mutation: a broken/typo'd rendered hook fails the golden-fixture shape", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-codex-"));
  try {
    await codexAdapter.installIntegration(dir);
    const rendered = JSON.parse(await readFile(join(dir, ".codex", "hooks.json"), "utf8"));
    const broken = JSON.parse(JSON.stringify(rendered));
    broken.hooks.PreToolUse[0].hooks[0].command = "aipe session gaurd"; // typo
    expect(() =>
      expect(broken.hooks.PreToolUse).toEqual([
        {
          matcher: "Bash",
          hooks: [{ type: "command", command: "aipe session guard" }],
        },
      ]),
    ).toThrow();

    // Restore: the untouched original still matches.
    expect(rendered.hooks.PreToolUse).toEqual([
      {
        matcher: "Bash",
        hooks: [{ type: "command", command: "aipe session guard" }],
      },
    ]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("merging is idempotent and preserves foreign keys", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-codex-"));
  try {
    await mkdir(join(dir, ".codex"), { recursive: true });
    await writeFile(join(dir, ".codex", "hooks.json"), JSON.stringify({ someOtherSetting: 1 }), "utf8");
    await ensureCodexHooks(dir);
    const once = JSON.parse(await readFile(join(dir, ".codex", "hooks.json"), "utf8"));
    expect(once.someOtherSetting).toBe(1);

    await ensureCodexHooks(dir);
    const twice = JSON.parse(await readFile(join(dir, ".codex", "hooks.json"), "utf8"));
    expect(twice).toEqual(once);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("preserves a user's own unrelated PreToolUse entry and appends containment", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-codex-"));
  try {
    const userEntry = { matcher: "Write", hooks: [{ type: "command", command: "my-own-linter" }] };
    await mkdir(join(dir, ".codex"), { recursive: true });
    await writeFile(join(dir, ".codex", "hooks.json"), JSON.stringify({ hooks: { PreToolUse: [userEntry] } }), "utf8");

    await ensureCodexHooks(dir);
    const merged = JSON.parse(await readFile(join(dir, ".codex", "hooks.json"), "utf8"));
    const preToolUse = merged.hooks.PreToolUse;
    expect(preToolUse).toHaveLength(2);
    expect(preToolUse[0]).toEqual(userEntry);
    expect(preToolUse[1].hooks[0].command).toBe("aipe session guard");

    await ensureCodexHooks(dir);
    const mergedAgain = JSON.parse(await readFile(join(dir, ".codex", "hooks.json"), "utf8"));
    expect(mergedAgain.hooks.PreToolUse).toHaveLength(2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
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

// Pins the tier hierarchy per learn.chatgpt.com/codex/models: gpt-5.6-sol is
// the current flagship ("strongest capability … complex coding … research")
// → `frontier`; gpt-5.5 is explicitly "Previous-generation frontier model" →
// the strong-but-cheaper `reasoning` tier. A regression that swaps these two
// back (as the tiers were before this fix) must fail here.
test("model tiers resolve to real codex model ids, frontier as the flagship and reasoning as previous-gen", () => {
  expect(codexAdapter.resolveModel("fast")).toEqual({ id: "gpt-5.6-luna", label: "GPT-5.6 Luna" });
  expect(codexAdapter.resolveModel("standard")).toEqual({ id: "gpt-5.6-terra", label: "GPT-5.6 Terra" });
  expect(codexAdapter.resolveModel("reasoning")).toEqual({ id: "gpt-5.5", label: "GPT-5.5" });
  expect(codexAdapter.resolveModel("frontier")).toEqual({ id: "gpt-5.6-sol", label: "GPT-5.6 Sol" });
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
