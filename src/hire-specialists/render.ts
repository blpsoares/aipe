import type { PersonaReport, PersonaRole } from "./types";

const ROLE_LABEL: Record<PersonaRole, string> = {
  "dev-fullstack": "Fullstack specialist",
  qa: "QA specialist",
};

export function personaSlug(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-+|-+$)/g, "");
}

export function renderSkillMd(report: PersonaReport, stack: string[]): string {
  const slug = personaSlug(report.name);
  const stackLabel = stack.length > 0 ? stack.join(", ") : "unknown stack";
  const module = report.module ?? null;
  // A module persona is scoped to `repo/module`; a whole-repo persona to `repo`.
  const scope = module ? `${report.repo}/${module}` : report.repo;
  const unit = module ? "module" : "repo";
  const description = `${ROLE_LABEL[report.role]} for the ${scope} ${unit} (${stackLabel}). Dispatched by the coordinator for tasks scoped to ${scope}, or worn directly when a session opens inside the ${report.repo} repo.`;

  return `---\nname: ${slug}\ndescription: ${description}\n---\n\n${report.body.trim()}\n`;
}
