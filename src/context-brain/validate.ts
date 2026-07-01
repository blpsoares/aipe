import type { ContextInput, ValidationError, ValidationResult } from "./types";

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const GIT_URL = /^(git@[\w.-]+:[\w./-]+\.git|https?:\/\/[\w.-]+\/[\w./-]+?(?:\.git)?)$/;

export function validateContext(input: ContextInput): ValidationResult {
  const errors: ValidationError[] = [];

  const name = input.context?.name?.trim() ?? "";
  if (!name) {
    errors.push({ field: "context.name", message: "nome do contexto é obrigatório" });
  } else if (!SLUG.test(name)) {
    errors.push({ field: "context.name", message: "use minúsculas, números e hífens (vira aipe-<nome>)" });
  }

  if (!input.context?.coordinator?.trim()) {
    errors.push({ field: "context.coordinator", message: "nome do coordenador é obrigatório" });
  }

  const repos = input.repos ?? [];
  if (repos.length === 0) {
    errors.push({ field: "repos", message: "informe ao menos um repositório" });
  }

  const seenNames = new Set<string>();
  const seenPaths = new Set<string>();
  repos.forEach((repo, i) => {
    const at = `repos[${i}]`;
    const rName = repo.name?.trim() ?? "";
    if (!rName) {
      errors.push({ field: `${at}.name`, message: "nome do repo é obrigatório" });
    } else if (seenNames.has(rName)) {
      errors.push({ field: `${at}.name`, message: `nome duplicado: ${rName}` });
    } else {
      seenNames.add(rName);
    }

    const url = repo.url?.trim() ?? "";
    if (!url) {
      errors.push({ field: `${at}.url`, message: "url é obrigatória" });
    } else if (!GIT_URL.test(url)) {
      errors.push({ field: `${at}.url`, message: `url inválida: ${url}` });
    }

    const path = repo.path?.trim() ?? "";
    if (!path) {
      errors.push({ field: `${at}.path`, message: "path é obrigatório" });
    } else if (!path.startsWith("./")) {
      errors.push({ field: `${at}.path`, message: "path deve ser relativo ao workspace (começar com ./)" });
    } else if (seenPaths.has(path)) {
      errors.push({ field: `${at}.path`, message: `path duplicado: ${path}` });
    } else {
      seenPaths.add(path);
    }
  });

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}
