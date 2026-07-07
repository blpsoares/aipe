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

export const FLOW_SKILLS: Record<string, string> = {
  "context-brain": contextBrainSkill,
  "make-workspace": makeWorkspaceSkill,
  relationship: relationshipSkill,
  "hire-specialists": hireSpecialistsSkill,
  operate: operateSkill,
  toolbox: toolboxSkill,
  "aipe-add-repo": addRepoSkill,
};
