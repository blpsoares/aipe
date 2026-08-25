import { expect, test } from "bun:test";
import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { claudeCodeAdapter } from "../claude-code";
import { codexAdapter } from "../codex";
import { copilotAdapter } from "../copilot";
import { geminiAdapter } from "../gemini";
import { genericAdapter } from "../generic";
import { installPersonaIntoRepo, personaLocations, personaSkillDir } from "../persona-install";
import { getAdapter, hasAdapter } from "../registry";
import { FLOW_SKILLS, renderFlowSkills, renderSkillBody } from "../skills";
import type { HarnessAdapter } from "../types";
import { HARNESSES } from "../../start/start";

const ALL: HarnessAdapter[] = [claudeCodeAdapter, codexAdapter, geminiAdapter, copilotAdapter, genericAdapter];

// The invariant that makes multi-harness real rather than nominal: `getAdapter`
// falls back to Claude Code for an unknown id, so a harness offered in the
// picker with no adapter does not fail — it silently installs the WRONG
// integration under another harness's name.
test("every harness offered as supported has its own adapter", () => {
  const supported = HARNESSES.filter((h) => h.status === "supported");
  expect(supported.length).toBeGreaterThan(1); // not a Claude-only picker
  for (const h of supported) {
    expect(hasAdapter(h.id)).toBe(true);
    expect(getAdapter(h.id).id).toBe(h.id); // not the silent claude-code fallback
  }
});

test("a harness still marked coming-soon has no adapter — that IS what the flag means", () => {
  for (const h of HARNESSES.filter((h) => h.status === "coming-soon")) {
    expect(hasAdapter(h.id)).toBe(false);
  }
});

test("codex, gemini and copilot deliberately SHARE .agents/skills/", () => {
  // Not an accident to be deduped: `.agents/` is the cross-harness convention
  // these three follow, so one persona file serves all of them. Claude Code
  // (.claude/) and generic (.aipe-personas/) are the ones that differ.
  const shared = [codexAdapter, geminiAdapter, copilotAdapter].map((a) => a.personaTarget("p").relDir);
  expect(new Set(shared).size).toBe(1);
  expect(shared[0]).toBe(join(".agents", "skills", "p"));
  expect(claudeCodeAdapter.personaTarget("p").relDir).not.toBe(shared[0]);
  expect(genericAdapter.personaTarget("p").relDir).not.toBe(shared[0]);
});

test("each harness's own config/containment path is distinct", () => {
  // The skills may be shared; the file that tells a harness how to BEHAVE
  // must not be, or installing one harness would rewrite another's config.
  const configs = ALL.map((a) => a.containmentHook()?.relPath).filter((p): p is string => !!p);
  expect(new Set(configs).size).toBe(configs.length);
});

test("every adapter answers every member of the seam", async () => {
  for (const a of ALL) {
    expect(typeof a.id).toBe("string");
    expect(typeof a.label).toBe("string");
    expect(a.personaTarget("p").filename.length).toBeGreaterThan(0);
    expect(a.flowSkillTarget("f").filename.length).toBeGreaterThan(0);
    expect(a.mcpConfigPath("workspace").length).toBeGreaterThan(0);
    expect(a.mcpConfigPath("repo", "r").startsWith("r")).toBe(true);
    expect(Array.isArray(a.integrationPaths())).toBe(true);
    expect(typeof a.ensureStartupHook).toBe("function");
    // Only Claude Code has a subagent concept; the rest must say so with null
    // rather than writing a file the harness never reads.
    expect(a.agentTarget("p") === null || typeof a.agentTarget("p")!.relDir === "string").toBe(true);
  }
  expect(claudeCodeAdapter.agentTarget("p")).not.toBeNull();
  for (const a of [codexAdapter, geminiAdapter, copilotAdapter, genericAdapter]) {
    expect(a.agentTarget("p")).toBeNull();
  }
});

test("integrationPaths never claims .aipe — that is AIPe's directory, not a harness's", () => {
  for (const a of ALL) {
    for (const p of a.integrationPaths()) expect(p.split("/")[0]).not.toBe(".aipe");
  }
});

test("ensureStartupHook installs into an arbitrary repo dir, idempotently", async () => {
  for (const a of ALL) {
    const dir = await mkdtemp(join(tmpdir(), `aipe-hook-${a.id}-`));
    await a.ensureStartupHook(dir);
    const first = await readdir(dir);
    expect(first.length).toBeGreaterThan(0); // something was actually written
    await a.ensureStartupHook(dir);
    expect(await readdir(dir)).toEqual(first);
  }
});

test("a persona lands where its harness reads it, and nowhere else", async () => {
  // The regression this whole seam exists for: picking Gemini used to install
  // specialists into .claude/, where Gemini never looks.
  for (const a of ALL) {
    const dir = await mkdtemp(join(tmpdir(), `aipe-persona-${a.id}-`));
    const written = await installPersonaIntoRepo(a, dir, "joaquim", { skill: "SKILL BODY", agent: "AGENT BODY" });

    const target = a.personaTarget("joaquim");
    expect(await readFile(join(dir, target.relDir, target.filename), "utf8")).toBe("SKILL BODY");
    expect(written[0]).toBe(join(target.relDir, target.filename));

    if (a.agentTarget("joaquim") === null) {
      expect(written).toHaveLength(1); // no inert agents/ file
    } else {
      const at = a.agentTarget("joaquim")!;
      expect(await readFile(join(dir, at.relDir, at.filename), "utf8")).toBe("AGENT BODY");
    }

    // Only Claude Code may produce a .claude/ directory.
    const top = await readdir(dir);
    if (a.id !== "claude-code") expect(top).not.toContain(".claude");
  }
});

test("a persona with no agent body writes only the skill", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-persona-skillonly-"));
  const written = await installPersonaIntoRepo(claudeCodeAdapter, dir, "marina", { skill: "S" });
  expect(written).toHaveLength(1);
});

test("personaSkillDir and personaLocations describe where files really go", () => {
  expect(personaSkillDir(claudeCodeAdapter, "joaquim")).toBe(".claude/skills/joaquim");
  expect(personaSkillDir(geminiAdapter, "joaquim")).toBe(".agents/skills/joaquim");

  // The awareness text: derived from the adapter, so it cannot claim
  // ".claude/skills/" to a Gemini session.
  expect(personaLocations(claudeCodeAdapter)).toEqual({ skillDir: ".claude/skills/", agentDir: ".claude/agents/" });
  expect(personaLocations(geminiAdapter)).toEqual({ skillDir: ".agents/skills/", agentDir: null });
  // generic puts the slug in the FILENAME, so no sentinel appears in the dir.
  expect(personaLocations(genericAdapter)).toEqual({ skillDir: ".aipe-personas/", agentDir: null });
});

test("flow-skill path tokens resolve to each harness's real paths", () => {
  const body = "persona at {{PERSONA_FILE}}, skill at {{SKILL_FILE}} in {{SKILL_DIR}}";
  expect(renderSkillBody(body, claudeCodeAdapter)).toBe(
    "persona at .claude/skills/<slug>/SKILL.md, skill at .claude/skills/<name>/SKILL.md in .claude/skills/<name>/",
  );
  expect(renderSkillBody(body, genericAdapter)).toBe(
    "persona at .aipe-personas/<slug>.md, skill at .aipe/flows/<name>.md in .aipe/flows/",
  );
});

test("no flow skill carries a literal harness path any more", () => {
  // The whole point of the tokens: a `.claude/skills/` in the source would be
  // installed verbatim into every other harness.
  for (const [name, body] of Object.entries(FLOW_SKILLS)) {
    expect(`${name}: ${body}`).not.toContain(".claude/skills/");
    expect(`${name}: ${body}`).not.toContain(".claude/agents/");
  }
});

test("rendering leaves no token behind, for any harness", () => {
  for (const a of ALL) {
    for (const [name, body] of Object.entries(renderFlowSkills(a))) {
      expect(`${a.id}/${name}: ${body}`).not.toContain("{{");
    }
  }
});
