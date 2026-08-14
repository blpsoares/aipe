import { expect, test } from "bun:test";
import { composePrompt } from "../prompt";

const base = {
  personaBody: "You are Joaquim, the embark fullstack specialist.",
  specSlice: "## Scope\nFix the token store.\n## Acceptance\nTests green.",
  worktree: "/w/.worktrees/j1-joaquim",
  packagePath: null,
  branch: "aipe/j1/joaquim",
  journeyId: "j1",
  workspace: "/w",
  fqid: "embark",
  intensity: "normal" as const,
};

test("the prompt carries persona, spec slice and the return contract", () => {
  const p = composePrompt(base);
  expect(p).toContain("You are Joaquim");
  expect(p).toContain("Fix the token store.");
  expect(p).toContain("aipe journey record");
  expect(p).toContain("--journey j1");
  expect(p).toContain("/w/.worktrees/j1-joaquim");
  expect(p).toContain("aipe/j1/joaquim");
});

test("ultracode appears if and only if the intensity says so", () => {
  expect(composePrompt(base)).not.toContain("ultracode");
  expect(composePrompt({ ...base, intensity: "ultracode" })).toContain("ultracode");
});

test("the prompt names no harness-specific slash command", () => {
  const p = composePrompt({ ...base, intensity: "ultracode" });
  // A slash command is a standalone token — e.g. `/verify-before-done` — bounded
  // by whitespace/start on the left and whitespace/end on the right. The naive
  // `/(^|\s)\/[a-z][a-z-]+/` (no right boundary) also flags the *first* segment
  // of any absolute path that happens to start with a plain lowercase word
  // (e.g. " /workspace/foo"), because it doesn't require the match to end at a
  // word boundary — it only fails on this fixture by luck, since the worktree
  // here is "/w/..." and "w" alone is too short to satisfy `[a-z][a-z-]+`. The
  // lookahead below makes the assertion precise about what it actually forbids:
  // a lone slash-word, not a path segment followed by more path.
  expect(p).not.toMatch(/(^|\s)\/[a-z][a-z-]+(?=$|\s)/);
});

test("the containment rule is stated, not only enforced", () => {
  const p = composePrompt(base);
  expect(p).toContain("must not open");
  expect(p).toContain("agentop session list");
});

test("a monorepo package narrows the stated lane", () => {
  const p = composePrompt({ ...base, packagePath: "packages/api", fqid: "embark/api" });
  expect(p).toContain("packages/api");
});
