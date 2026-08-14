import { expect, test } from "bun:test";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { claudeCodeAdapter } from "../../harness/claude-code";
import { genericAdapter } from "../../harness/generic";
import { isContainable } from "../../harness/types";

test("claude-code is containable and renders the PreToolUse hook", () => {
  const hook = claudeCodeAdapter.containmentHook();
  expect(hook).not.toBeNull();
  expect(hook!.relPath).toBe(join(".claude", "settings.json"));
  expect(hook!.merge({})).toEqual({
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

test("merging is idempotent and preserves foreign settings", () => {
  const hook = claudeCodeAdapter.containmentHook()!;
  const once = hook.merge({ model: "opus", hooks: { SessionStart: [{ matcher: "startup" }] } });
  const twice = hook.merge(once);
  expect(twice).toEqual(once);
  expect((twice as any).model).toBe("opus");
  expect((twice as any).hooks.SessionStart).toHaveLength(1);
  expect((twice as any).hooks.PreToolUse).toHaveLength(1);
});

test("the generic adapter is not containable", () => {
  expect(genericAdapter.containmentHook()).toBeNull();
  expect(isContainable(genericAdapter)).toBe(false);
  expect(isContainable(claudeCodeAdapter)).toBe(true);
});

test("installIntegration writes the containment hook to disk", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-containment-"));
  await claudeCodeAdapter.installIntegration(dir);
  const settings = JSON.parse(await readFile(join(dir, ".claude", "settings.json"), "utf8"));
  expect(settings.hooks.PreToolUse[0].hooks[0].command).toBe("aipe session guard");
  expect(JSON.stringify(settings.hooks.SessionStart)).toContain("aipe session-context");
});

test("preserves user's own unrelated PreToolUse entry and appends containment", () => {
  const hook = claudeCodeAdapter.containmentHook()!;
  const userEntry = {
    matcher: "Write",
    hooks: [{ type: "command", command: "my-own-linter" }],
  };
  const withUserEntry = {
    hooks: { PreToolUse: [userEntry] },
  };
  const merged = hook.merge(withUserEntry);
  const preToolUse = (merged as any).hooks.PreToolUse;
  expect(preToolUse).toHaveLength(2);
  expect(preToolUse[0]).toEqual(userEntry);
  expect(preToolUse[1].hooks[0].command).toBe("aipe session guard");

  // Merging again should be idempotent and still have exactly 2 elements
  const mergedAgain = hook.merge(merged);
  const preToolUseAgain = (mergedAgain as any).hooks.PreToolUse;
  expect(preToolUseAgain).toHaveLength(2);
});
