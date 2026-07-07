// A fully-qualified node id in the relationship graph. Either `repo` (the whole
// repo — a single-package repo, identical to the pre-package model) or
// `repo/package` (a package inside a monorepo). The package segment may itself
// contain slashes (`apps/web`), so parsing splits on the FIRST slash only.

export interface ParsedFqid {
  repo: string;
  package: string | null;
}

export function makeFqid(repo: string, pkg?: string | null): string {
  const r = repo.trim();
  const m = pkg?.trim();
  return m && m.length > 0 ? `${r}/${m}` : r;
}

export function parseFqid(fqid: string): ParsedFqid {
  const trimmed = fqid.trim();
  const slash = trimmed.indexOf("/");
  if (slash < 0) return { repo: trimmed, package: null };
  return { repo: trimmed.slice(0, slash), package: trimmed.slice(slash + 1) };
}

export function repoOf(fqid: string): string {
  return parseFqid(fqid).repo;
}
