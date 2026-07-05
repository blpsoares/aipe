// Installs the AIPe Claude Code integration into a project folder, purely
// project-scoped (no marketplace/global plugin): a SessionStart hook in
// .claude/settings.json that calls the on-PATH `aipe session-context`, plus
// the onboarding skills under .claude/skills/. Skill contents are embedded in
// the binary as text imports, so the compiled `aipe` has no external files.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import contextBrainSkill from "../../skills/context-brain/SKILL.md" with { type: "text" };
import makeWorkspaceSkill from "../../skills/make-workspace/SKILL.md" with { type: "text" };
import relationshipSkill from "../../skills/relationship/SKILL.md" with { type: "text" };
import hireSpecialistsSkill from "../../skills/hire-specialists/SKILL.md" with { type: "text" };
import operateSkill from "../../skills/operate/SKILL.md" with { type: "text" };
import toolboxSkill from "../../skills/toolbox/SKILL.md" with { type: "text" };
import addRepoSkill from "../../skills/aipe-add-repo/SKILL.md" with { type: "text" };

const SKILLS: Record<string, string> = {
  "context-brain": contextBrainSkill,
  "make-workspace": makeWorkspaceSkill,
  relationship: relationshipSkill,
  "hire-specialists": hireSpecialistsSkill,
  operate: operateSkill,
  toolbox: toolboxSkill,
  "aipe-add-repo": addRepoSkill,
};

const SESSION_START_HOOK = {
  matcher: "startup|resume|clear|compact",
  hooks: [
    {
      type: "command",
      command: 'aipe session-context --workspace "$CLAUDE_PROJECT_DIR"',
    },
  ],
};

interface Settings {
  hooks?: { SessionStart?: unknown[]; [k: string]: unknown };
  [k: string]: unknown;
}

async function readSettings(path: string): Promise<Settings> {
  try {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") return parsed as Settings;
  } catch {
    // missing or malformed → start fresh
  }
  return {};
}

function hasAipeHook(list: unknown[]): boolean {
  return list.some((entry) => JSON.stringify(entry).includes("aipe session-context"));
}

export async function installClaudeCode(workspace: string): Promise<number> {
  const claudeDir = join(workspace, ".claude");
  const settingsPath = join(claudeDir, "settings.json");

  await mkdir(claudeDir, { recursive: true });

  // 1. merge the SessionStart hook into settings.json (idempotent)
  const settings = await readSettings(settingsPath);
  settings.hooks ??= {};
  const sessionStart = Array.isArray(settings.hooks.SessionStart) ? settings.hooks.SessionStart : [];
  if (!hasAipeHook(sessionStart)) sessionStart.push(SESSION_START_HOOK);
  settings.hooks.SessionStart = sessionStart;
  await writeFile(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");

  // 2. write the onboarding skills
  for (const [name, body] of Object.entries(SKILLS)) {
    const dir = join(claudeDir, "skills", name);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "SKILL.md"), body, "utf8");
  }

  console.log(`aipe: installed the Claude Code integration into ${claudeDir}`);
  console.log("aipe:  - .claude/settings.json (SessionStart hook → aipe session-context)");
  console.log(`aipe:  - .claude/skills/ (${Object.keys(SKILLS).length} AIPe skills)`);
  return 0;
}
