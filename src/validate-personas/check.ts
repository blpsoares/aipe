import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { personaSlug } from "../hire-specialists/render";
import { readPersonas } from "../hire-specialists/read-personas";

export interface PersonaCheck {
  name: string;
  fqid: string | null;
  repo: string | null;
  path: string | null;
  ok: boolean;
  issues: string[];
}

export interface ReadinessResult {
  results: PersonaCheck[];
  ready: number;
  total: number;
}

export interface Frontmatter {
  name?: string;
  description?: string;
}

// Extracts a leading `--- ... ---` YAML-ish frontmatter block. Deliberately
// minimal (no yaml dep needed): the persona files we write are flat `key: value`
// pairs. Returns null when there is no closing delimiter.
export function parseFrontmatter(text: string): Frontmatter | null {
  if (!text.startsWith("---")) return null;
  const rest = text.slice(3);
  const end = rest.indexOf("\n---");
  if (end < 0) return null;
  const block = rest.slice(0, end);
  const fm: Frontmatter = {};
  for (const line of block.split("\n")) {
    const m = line.match(/^([A-Za-z][\w-]*):\s*(.*)$/);
    if (!m) continue;
    const key = m[1];
    const value = (m[2] ?? "").trim();
    if (key === "name") fm.name = value;
    else if (key === "description") fm.description = value;
  }
  return fm;
}

async function checkOne(workspaceDir: string, persona: {
  name: string;
  fqid: string | null;
  repo: string | null;
  path: string | null;
}): Promise<PersonaCheck> {
  const issues: string[] = [];
  const slug = personaSlug(persona.name);

  if (!persona.path) {
    issues.push("no path recorded in personas.yaml");
    return { ...persona, ok: false, issues };
  }

  // Path shape: must live at .claude/skills/<slug>
  const expectedTail = join(".claude", "skills", slug);
  if (!persona.path.replace(/\/+$/, "").endsWith(expectedTail)) {
    issues.push(`path does not end with .claude/skills/${slug}`);
  }

  const skillFile = join(workspaceDir, persona.path, "SKILL.md");
  let text: string;
  try {
    text = await readFile(skillFile, "utf8");
  } catch {
    issues.push("SKILL.md is missing on disk");
    return { ...persona, ok: false, issues };
  }

  const fm = parseFrontmatter(text);
  if (!fm) {
    issues.push("frontmatter block is missing or unterminated");
    return { ...persona, ok: false, issues };
  }
  if (fm.name !== slug) {
    issues.push(`frontmatter \`name\` is "${fm.name ?? ""}", expected "${slug}"`);
  }
  if (!fm.description || fm.description.trim().length === 0) {
    issues.push("frontmatter `description` is empty");
  }

  return { ...persona, ok: issues.length === 0, issues };
}

// Checks every hired persona's static load-order preconditions. The coordinator
// is skipped (no repo skill — it's injected by the SessionStart hook).
export async function checkPersonaReadiness(workspaceDir: string): Promise<ReadinessResult> {
  const roster = await readPersonas(workspaceDir);
  const personas = roster.filter((p) => p.role !== "coordinator");

  const results: PersonaCheck[] = [];
  for (const p of personas) {
    results.push(await checkOne(workspaceDir, { name: p.name, fqid: p.fqid, repo: p.repo, path: p.path }));
  }
  return { results, ready: results.filter((r) => r.ok).length, total: results.length };
}
