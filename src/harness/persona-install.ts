// Installing a persona into a repo, in whatever shape the workspace's harness
// actually reads.
//
// Two call sites need this — `/hire-specialists` (first install) and
// `aipe rehydrate` (restore from .aipe/personas/) — and they used to do it by
// hand, both hardcoding `.claude/skills/`, `.claude/agents/` and the Claude
// Code SessionStart hook. That is why picking Gemini produced a workspace whose
// specialists were installed where Gemini never looks: the workspace
// integration went through the adapter seam and the per-repo integration did
// not. One function, so the two paths cannot drift again.
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { HarnessAdapter } from "./types";

export interface PersonaPayload {
  /** The persona skill body, already wrapped for this harness. */
  skill: string;
  /**
   * The persona's agent-type body. Written only when the harness HAS an agent
   * concept (`agentTarget` non-null) — see the note there: writing it anyway
   * would look installed and be inert.
   */
  agent?: string;
}

/**
 * Writes one persona into `repoAbs` and makes sure that repo delivers AIPe
 * awareness on session start. Returns the repo-relative paths written, so
 * callers can report exactly what landed for the chosen harness.
 */
export async function installPersonaIntoRepo(
  adapter: HarnessAdapter,
  repoAbs: string,
  slug: string,
  payload: PersonaPayload,
): Promise<string[]> {
  const written: string[] = [];

  const skillTarget = adapter.personaTarget(slug);
  const skillDir = join(repoAbs, skillTarget.relDir);
  await mkdir(skillDir, { recursive: true });
  await writeFile(join(skillDir, skillTarget.filename), payload.skill, "utf8");
  written.push(join(skillTarget.relDir, skillTarget.filename));

  const agentTarget = adapter.agentTarget(slug);
  if (agentTarget && payload.agent !== undefined) {
    const agentDir = join(repoAbs, agentTarget.relDir);
    await mkdir(agentDir, { recursive: true });
    await writeFile(join(agentDir, agentTarget.filename), payload.agent, "utf8");
    written.push(join(agentTarget.relDir, agentTarget.filename));
  }

  await adapter.ensureStartupHook(repoAbs);
  return written;
}

/**
 * Pure: the repo-relative directory a persona's skill lives in for this
 * harness. What `personas.yaml` records, so the roster points at the files that
 * were actually written rather than at a hardcoded `.claude/skills/`.
 */
export function personaSkillDir(adapter: HarnessAdapter, slug: string): string {
  return adapter.personaTarget(slug).relDir;
}

/**
 * Human-readable description of where this harness keeps persona files, for the
 * awareness text a session is given.
 *
 * Derived by asking the adapter about a sentinel slug and removing it, so it
 * can never drift from where `installPersonaIntoRepo` actually writes — the
 * previous version was a hardcoded ".claude/skills/ and .claude/agents/"
 * sentence that stayed true for exactly one harness. Harnesses that put the
 * slug in the FILENAME (generic: `.aipe-personas/<slug>.md`) have no slug in
 * the directory, so the sentinel simply does not appear and the dir is used
 * as-is.
 */
export function personaLocations(adapter: HarnessAdapter): { skillDir: string; agentDir: string | null } {
  const SENTINEL = "__slug__";
  const strip = (relDir: string): string => {
    const cleaned = relDir.split(/[\\/]/).filter((seg) => seg !== SENTINEL);
    return `${cleaned.join("/")}/`;
  };
  const agent = adapter.agentTarget(SENTINEL);
  return {
    skillDir: strip(adapter.personaTarget(SENTINEL).relDir),
    agentDir: agent ? strip(agent.relDir) : null,
  };
}
