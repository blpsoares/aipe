import { expect, test } from "bun:test";
import { composePrompt } from "../prompt";

const base = {
  personaBody: "You are Joaquim, the embark fullstack specialist.",
  specSlice: "## Scope\nFix the token store.\n## Acceptance\nTests green.",
  worktree: "/w/.worktrees/j1-joaquim",
  packagePath: null,
  branch: "aipe/j1/joaquim",
  repo: "aipe",
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
  // All three blocks (delivered, escalated, redirected) must emit --repo correctly
  expect((p.match(/--repo aipe/g) || []).length).toBe(3);
});

test("ultracode appears if and only if the intensity says so", () => {
  expect(composePrompt(base)).not.toContain("ultracode");
  expect(composePrompt({ ...base, intensity: "ultracode" })).toContain("ultracode");
});

test("the prompt names no harness-specific slash command", () => {
  const p = composePrompt({ ...base, intensity: "ultracode" });
  // A slash command is a standalone token — e.g. `/verify-before-done` — that
  // can be preceded by start-of-string, whitespace, a backtick, `(`, or `[`
  // (the realistic ways it shows up in markdown-flavored prose: inline, in a
  // sentence, backtick-wrapped, or parenthesized), and that ends where a path
  // would keep going. `(^|\s)\/[a-z][a-z-]+(?=$|\s)` — requiring the *right*
  // side to be exactly end-of-string or whitespace — missed a command
  // followed by punctuation or a closing backtick (e.g.
  // "`/verify-before-done`," or "/verify-before-done."), which is exactly how
  // one would leak into this prose. The distinguishing feature of a path
  // segment, not the command itself, is that it continues with another `/` or
  // more word characters; a negative lookahead for `[\w/-]` expresses that
  // directly and lets any other terminator (space, punctuation, backtick,
  // end-of-string) count as the command ending. Short absolute paths like
  // "/tmp" are still indistinguishable from a slash command by this rule and
  // will be flagged — an acceptable false positive here, since a missed real
  // slash command is the failure mode that matters.
  expect(p).not.toMatch(/(^|[\s`(\[])\/[a-z][a-z-]+(?![\w/-])/);
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
