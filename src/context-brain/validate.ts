import type { ContextInput, ValidationError, ValidationResult } from "./types";

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
// Accepts remote git URLs (ssh scp-like or http(s)) AND local repos — a `file://`
// URL or an absolute filesystem path — because `make-workspace` clones fine from a
// local path (`git clone <path> <dest>`). Local-only repos are a first-class case.
const REPO_URL =
  /^(git@[\w.-]+:[\w./-]+\.git|https?:\/\/[\w.-]+\/[\w./-]+?(?:\.git)?|file:\/\/\/?\S+|\/\S+)$/;
const RELATIVE_PATH = /^\.\/[^/]+(?:\/[^/]+)*$/;

function isValidRelativePath(path: string): boolean {
  if (!RELATIVE_PATH.test(path)) return false;
  const segments = path.slice(2).split("/");
  return segments.every((segment) => segment !== "..");
}

export function validateContext(input: ContextInput): ValidationResult {
  const errors: ValidationError[] = [];

  const name = input.context?.name?.trim() ?? "";
  if (!name) {
    errors.push({ field: "context.name", message: "context name is required" });
  } else if (!SLUG.test(name)) {
    errors.push({ field: "context.name", message: "use lowercase letters, numbers and hyphens (becomes aipe-<name>)" });
  }

  if (!input.context?.coordinator?.trim()) {
    errors.push({ field: "context.coordinator", message: "coordinator name is required" });
  }

  const repos = input.repos ?? [];
  if (repos.length === 0) {
    errors.push({ field: "repos", message: "provide at least one repository" });
  }

  const seenNames = new Set<string>();
  const seenPaths = new Set<string>();
  repos.forEach((repo, i) => {
    const at = `repos[${i}]`;
    const rName = repo.name?.trim() ?? "";
    if (!rName) {
      errors.push({ field: `${at}.name`, message: "repo name is required" });
    } else if (seenNames.has(rName)) {
      errors.push({ field: `${at}.name`, message: `duplicate name: ${rName}` });
    } else {
      seenNames.add(rName);
    }

    const url = repo.url?.trim() ?? "";
    if (!url) {
      errors.push({ field: `${at}.url`, message: "url is required" });
    } else if (!REPO_URL.test(url)) {
      errors.push({ field: `${at}.url`, message: `invalid url (use git@…, https://…, file://… or an absolute local path): ${url}` });
    }

    const path = repo.path?.trim() ?? "";
    if (!path) {
      errors.push({ field: `${at}.path`, message: "path is required" });
    } else if (!isValidRelativePath(path)) {
      errors.push({
        field: `${at}.path`,
        message: "path must be relative to the workspace (start with ./ and have no empty segments or ..)",
      });
    } else if (seenPaths.has(path)) {
      errors.push({ field: `${at}.path`, message: `duplicate path: ${path}` });
    } else {
      seenPaths.add(path);
    }
  });

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}
