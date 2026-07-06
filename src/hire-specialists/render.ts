import { claudeCodeAdapter } from "../harness/claude-code";
import type { PersonaReport } from "./types";

export function personaSlug(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-+|-+$)/g, "");
}

// Renders a persona's Claude Code SKILL.md. The frontmatter/description shape
// lives in the Claude Code adapter (the format is harness-specific); this keeps
// the published .aipe/personas/ source in that canonical format for rehydrate.
export function renderSkillMd(report: PersonaReport, stack: string[]): string {
  return claudeCodeAdapter.wrapPersona(report.body, {
    slug: personaSlug(report.name),
    role: report.role,
    repo: report.repo,
    module: report.module ?? null,
    stack,
  });
}
