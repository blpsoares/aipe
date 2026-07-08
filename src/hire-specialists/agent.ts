// Persona agent-type generation. A hired persona is a *skill*
// (`<repo>/.claude/skills/<slug>/SKILL.md`), but a skill is not an *agent type*,
// so the coordinator can only dispatch the generic agent — and the subagent shows
// up as "claude" instead of the persona's real name. To fix that we also emit an
// **agent type** per persona at `<repo>/.claude/agents/<slug>.md`, whose
// frontmatter `name:` is the persona's real display name. The coordinator can then
// dispatch `subagent_type: "<slug>"` and the real name appears in the fleet.
import { personaSlug } from "./render";
import type { PersonaRole } from "./types";

const ROLE_LABEL: Record<PersonaRole, string> = {
  "dev-fullstack": "Fullstack specialist",
  qa: "QA specialist",
};

// Strip a leading YAML frontmatter block (--- … ---) from a SKILL.md, returning
// the persona-identity body that the agent type reuses verbatim.
export function extractBody(md: string): string {
  const m = md.match(/^﻿?---\r?\n[\s\S]*?\r?\n---\r?\n?/);
  return (m ? md.slice(m[0].length) : md).trim();
}

// Read the `name:` field of a SKILL.md frontmatter (the slug), used only as a
// last-resort label when a display name isn't otherwise known.
export function frontmatterName(md: string): string | null {
  const m = md.match(/^﻿?---\r?\n([\s\S]*?)\r?\n---/);
  if (!m || !m[1]) return null;
  const line = m[1].split(/\r?\n/).find((l) => /^name\s*:/.test(l));
  if (!line) return null;
  return line.replace(/^name\s*:\s*/, "").trim() || null;
}

export interface AgentSpec {
  name: string; // persona display name, e.g. "Brand"
  role: PersonaRole;
  repo: string;
  stack: string[];
  body: string; // persona identity (SKILL.md body)
}

// Render the `.claude/agents/<slug>.md` agent-type file for a persona. The file's
// basename is the slug (the dispatch id); the frontmatter `name` is the real
// display name so the fleet shows "Brand", not "claude".
export function renderAgentMd(spec: AgentSpec): string {
  const slug = personaSlug(spec.name);
  const stackLabel = spec.stack.length > 0 ? spec.stack.join(", ") : "unknown stack";
  const description = `${ROLE_LABEL[spec.role]} for the ${spec.repo} repo (${stackLabel}). Dispatch as subagent_type "${slug}"; scoped strictly to ${spec.repo}. The coordinator hands it a briefing; it reports back through the coordinator.`;
  return `---\nname: ${spec.name}\ndescription: ${description}\n---\n\n${spec.body.trim()}\n`;
}
