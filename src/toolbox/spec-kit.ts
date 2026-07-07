// Materializes the vendored Spec Kit into a repo — the same layout `specify
// init --integration claude` produces, but from embedded assets (no uv/Python/
// network). Scripts + templates go under `.specify/`; each command template is
// transformed into a Claude Code slash command under `.claude/commands/`.
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { SPEC_KIT_FILES } from "./spec-kit-assets";

// The `{SCRIPT}` a command runs comes from its own frontmatter `sh:` line
// (`sh: scripts/bash/<x>.sh <args>`); materialized scripts live under `.specify/`.
function scriptFromFrontmatter(content: string): string | null {
  const m = content.match(/^\s*sh:\s*(scripts\/bash\/[^\n]+?)\s*$/m);
  return m ? (m[1] ?? null) : null;
}

// Transform a generic command template into a Claude Code slash command:
// resolve the script path, keep the user input as $ARGUMENTS, and turn the
// cross-command references into `/speckit.<name>`.
export function toClaudeCommand(content: string): string {
  const sh = scriptFromFrontmatter(content);
  let out = content;
  if (sh) out = out.split("{SCRIPT}").join(`.specify/${sh}`);
  out = out.split("{ARGS}").join("$ARGUMENTS");
  out = out.replace(/__SPECKIT_COMMAND_([A-Z]+)__/g, (_m, name: string) => `/speckit.${name.toLowerCase()}`);
  return out;
}

// Writes `.specify/` (scripts + templates) and `.claude/commands/speckit.*.md`
// into the repo. Idempotent (overwrites). Returns the files written.
export async function materializeSpecKit(repoAbsDir: string): Promise<string[]> {
  const written: string[] = [];
  for (const [rel, content] of Object.entries(SPEC_KIT_FILES)) {
    if (rel.startsWith("commands/")) {
      const name = rel.slice("commands/".length).replace(/\.md$/, "");
      const dest = join(repoAbsDir, ".claude", "commands", `speckit.${name}.md`);
      await mkdir(dirname(dest), { recursive: true });
      await writeFile(dest, toClaudeCommand(content), "utf8");
      written.push(dest);
    } else {
      // templates/** and scripts/** live under .specify/, verbatim.
      const dest = join(repoAbsDir, ".specify", rel);
      await mkdir(dirname(dest), { recursive: true });
      await writeFile(dest, content, "utf8");
      if (rel.endsWith(".sh")) await chmod(dest, 0o755);
      written.push(dest);
    }
  }
  return written;
}
