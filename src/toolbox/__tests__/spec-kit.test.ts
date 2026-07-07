import { expect, test } from "bun:test";
import { mkdtemp, readdir, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SPEC_KIT_FILES } from "../spec-kit-assets";
import { materializeSpecKit, toClaudeCommand } from "../spec-kit";

test("vendored assets include commands, templates and scripts", () => {
  const keys = Object.keys(SPEC_KIT_FILES);
  expect(keys).toContain("commands/plan.md");
  expect(keys).toContain("templates/spec-template.md");
  expect(keys).toContain("scripts/bash/setup-plan.sh");
});

test("toClaudeCommand leaves no unresolved placeholder in any command", () => {
  for (const [rel, content] of Object.entries(SPEC_KIT_FILES)) {
    if (!rel.startsWith("commands/")) continue;
    const out = toClaudeCommand(content);
    expect(out).not.toContain("{SCRIPT}");
    expect(out).not.toContain("{ARGS}");
    expect(out).not.toMatch(/__SPECKIT_COMMAND_[A-Z]+__/);
  }
  // plan resolves its script from the frontmatter into a .specify/ path
  const plan = toClaudeCommand(SPEC_KIT_FILES["commands/plan.md"]!);
  expect(plan).toContain(".specify/scripts/bash/setup-plan.sh");
  expect(plan).toContain("$ARGUMENTS");
  // a command that references sibling commands resolves them to /speckit.<name>
  expect(toClaudeCommand(SPEC_KIT_FILES["commands/specify.md"]!)).toContain("/speckit.");
});

test("materializeSpecKit writes .specify + .claude/commands, scripts executable", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sk-"));
  const files = await materializeSpecKit(dir);
  expect(files.length).toBe(Object.keys(SPEC_KIT_FILES).length);

  const sh = join(dir, ".specify", "scripts", "bash", "setup-plan.sh");
  expect((await stat(sh)).mode & 0o111).toBeGreaterThan(0); // executable bit

  await readFile(join(dir, ".specify", "templates", "spec-template.md"), "utf8");

  const cmds = await readdir(join(dir, ".claude", "commands"));
  expect(cmds).toContain("speckit.plan.md");
  expect(cmds.every((c) => c.startsWith("speckit.") && c.endsWith(".md"))).toBe(true);
});
