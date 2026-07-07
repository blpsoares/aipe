// A fully-qualified node id in the relationship graph. Either `repo` (the whole
// repo — a single-module repo, identical to the pre-module model) or
// `repo/module` (a module inside a monorepo). The module segment may itself
// contain slashes (`apps/web`), so parsing splits on the FIRST slash only.

export interface ParsedFqid {
  repo: string;
  module: string | null;
}

export function makeFqid(repo: string, module?: string | null): string {
  const r = repo.trim();
  const m = module?.trim();
  return m && m.length > 0 ? `${r}/${m}` : r;
}

export function parseFqid(fqid: string): ParsedFqid {
  const trimmed = fqid.trim();
  const slash = trimmed.indexOf("/");
  if (slash < 0) return { repo: trimmed, module: null };
  return { repo: trimmed.slice(0, slash), module: trimmed.slice(slash + 1) };
}

export function repoOf(fqid: string): string {
  return parseFqid(fqid).repo;
}
