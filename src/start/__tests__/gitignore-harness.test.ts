import { expect, test } from "bun:test";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { claudeCodeAdapter } from "../../harness/claude-code";
import { copilotAdapter } from "../../harness/copilot";
import { geminiAdapter } from "../../harness/gemini";
import { genericAdapter } from "../../harness/generic";
import { scaffoldWorkspace, unignoreLines } from "../scaffold";
import { allowlistFor, BASE_ALLOWLIST, existingAllowlist } from "../../make-workspace/publish";

test("unignoreLines admits directories with a trailing slash and files without", () => {
  expect(unignoreLines([".claude"])).toEqual(["!/.claude/"]);
  expect(unignoreLines(["AGENTS.md"])).toEqual(["!/AGENTS.md"]);
});

test("only the FIRST path segment can be un-ignored", () => {
  // git cannot re-admit `.github/hooks/` while `/.github` itself is excluded
  // by the `/*` rule, so the top-level segment is what must be listed.
  expect(unignoreLines([".github/hooks", ".agents"])).toEqual(["!/.github/", "!/.agents/"]);
});

test("unignoreLines dedupes segments that repeat", () => {
  expect(unignoreLines([".agents/skills", ".agents/other"])).toEqual(["!/.agents/"]);
});

test("the scaffolded .gitignore publishes the chosen harness, not a hardcoded .claude", async () => {
  // The regression: a Gemini workspace whose .gitignore only re-admits
  // `.claude/` publishes with no integration at all, and rehydrates into
  // nothing on the next machine.
  const dir = await mkdtemp(join(tmpdir(), "aipe-gi-gemini-"));
  await scaffoldWorkspace(dir, geminiAdapter);
  const gi = await readFile(join(dir, ".gitignore"), "utf8");
  expect(gi).toContain("!/.aipe/");
  expect(gi).toContain("!/.gemini/");
  expect(gi).toContain("!/.agents/");
  expect(gi).not.toContain("!/.claude/");
});

test("the scaffolded README names the harness that was actually chosen", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-readme-copilot-"));
  await scaffoldWorkspace(dir, copilotAdapter);
  const readme = await readFile(join(dir, "README.md"), "utf8");
  expect(readme).toContain("Copilot CLI");
  expect(readme).toContain(".github/hooks");
  expect(readme).not.toContain(".claude/");
});

test("the publish allowlist follows the harness", () => {
  expect(allowlistFor(claudeCodeAdapter)).toEqual([...BASE_ALLOWLIST, ".claude"]);
  expect(allowlistFor(geminiAdapter)).toEqual([...BASE_ALLOWLIST, ".gemini", ".agents"]);
  expect(allowlistFor(genericAdapter)).toEqual([...BASE_ALLOWLIST, "AGENTS.md"]);
  // `.aipe/` is published for every harness and is never a harness's own path.
  for (const a of [claudeCodeAdapter, geminiAdapter, genericAdapter]) {
    expect(allowlistFor(a)).toContain(".aipe");
  }
});

test("the allowlist is filtered to what exists, so `git add` cannot fail on a missing path", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-allow-"));
  await scaffoldWorkspace(dir, geminiAdapter);
  // Scaffolding writes .gitignore + README.md but no .gemini/ yet — that is
  // the harness install's job, and it may legitimately not have run.
  const found = await existingAllowlist(dir, geminiAdapter);
  expect(found).toContain(".gitignore");
  expect(found).toContain("README.md");
  expect(found).not.toContain(".gemini");
});
