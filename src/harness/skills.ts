// The onboarding + operation flow texts, embedded in the binary as text imports
// so the compiled `aipe` has no external files. Shared by every harness adapter:
// Claude Code installs them as .claude/skills/<name>/SKILL.md; a file-based
// harness inlines them into its own flow surface.
import contextBrainSkill from "../../skills/context-brain/SKILL.md" with { type: "text" };
import makeWorkspaceSkill from "../../skills/make-workspace/SKILL.md" with { type: "text" };
import relationshipSkill from "../../skills/relationship/SKILL.md" with { type: "text" };
import hireSpecialistsSkill from "../../skills/hire-specialists/SKILL.md" with { type: "text" };
import operateSkill from "../../skills/operate/SKILL.md" with { type: "text" };
import toolboxSkill from "../../skills/toolbox/SKILL.md" with { type: "text" };
import addRepoSkill from "../../skills/aipe-add-repo/SKILL.md" with { type: "text" };
import handoffSkill from "../../skills/handoff/SKILL.md" with { type: "text" };

export const FLOW_SKILLS: Record<string, string> = {
  "context-brain": contextBrainSkill,
  "make-workspace": makeWorkspaceSkill,
  relationship: relationshipSkill,
  "hire-specialists": hireSpecialistsSkill,
  operate: operateSkill,
  toolbox: toolboxSkill,
  "aipe-add-repo": addRepoSkill,
  handoff: handoffSkill,
};

// ---------------------------------------------------------------------------
// Harness-neutral flow skills
//
// The skill bodies are prose the coordinator reads, and they name real paths:
// "read that repo's persona body from <repo>/.claude/skills/<slug>/SKILL.md".
// Embedded verbatim, that sentence is installed into EVERY harness — so a
// Gemini workspace's own operate skill sent the coordinator to a directory
// that does not exist there. The paths are tokens, resolved per adapter at
// install time.
// ---------------------------------------------------------------------------

import type { HarnessAdapter } from "./types";

/** Placeholders the skill markdown may use. Keep in sync with skills/**\/SKILL.md. */
export const SKILL_TOKENS = {
  /** A persona's file inside its repo, with a literal `<slug>`. */
  personaFile: "{{PERSONA_FILE}}",
  /** A named skill's file, with a literal `<name>`. */
  skillFile: "{{SKILL_FILE}}",
  /** The directory a named skill lives in, with a literal `<name>`. */
  skillDir: "{{SKILL_DIR}}",
} as const;

/** Pure: resolve the three path tokens for one adapter. */
export function skillTokenValues(adapter: HarnessAdapter): Record<string, string> {
  const persona = adapter.personaTarget("<slug>");
  const skill = adapter.flowSkillTarget("<name>");
  const toPosix = (p: string) => p.split(/[\\/]/).join("/");
  return {
    [SKILL_TOKENS.personaFile]: `${toPosix(persona.relDir)}/${persona.filename}`,
    [SKILL_TOKENS.skillFile]: `${toPosix(skill.relDir)}/${skill.filename}`,
    [SKILL_TOKENS.skillDir]: `${toPosix(skill.relDir)}/`,
  };
}

/** Pure: substitute every token in one body. */
export function renderSkillBody(body: string, adapter: HarnessAdapter): string {
  let out = body;
  for (const [token, value] of Object.entries(skillTokenValues(adapter))) {
    out = out.split(token).join(value);
  }
  return out;
}

/** The flow skills as THIS harness should read them. */
export function renderFlowSkills(adapter: HarnessAdapter): Record<string, string> {
  return Object.fromEntries(Object.entries(FLOW_SKILLS).map(([n, b]) => [n, renderSkillBody(b, adapter)]));
}
