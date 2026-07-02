import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse } from "yaml";
import type { BrainFile, RepoEntry } from "./types";

export type ReadBrainResult =
  | { ok: true; brain: BrainFile }
  | { ok: false; error: string };

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

function validateRepo(repo: unknown, index: number): string | null {
  if (typeof repo !== "object" || repo === null) return `repos[${index}]: esperado objeto`;
  const r = repo as Record<string, unknown>;
  if (!isNonEmptyString(r.name)) return `repos[${index}].name: obrigatório`;
  if (!isNonEmptyString(r.url)) return `repos[${index}].url: obrigatório`;
  if (!isNonEmptyString(r.path)) return `repos[${index}].path: obrigatório`;
  return null;
}

export async function readBrain(workspaceDir: string): Promise<ReadBrainResult> {
  const brainPath = join(workspaceDir, ".aipe", "brain.yaml");
  let raw: string;
  try {
    raw = await readFile(brainPath, "utf8");
  } catch {
    return { ok: false, error: `brain.yaml não encontrado em ${brainPath}. Rode /context-brain primeiro.` };
  }

  let parsed: unknown;
  try {
    parsed = parse(raw);
  } catch {
    return { ok: false, error: "brain.yaml: YAML inválido" };
  }

  if (typeof parsed !== "object" || parsed === null) {
    return { ok: false, error: "brain.yaml: esperado um objeto" };
  }
  const obj = parsed as Record<string, unknown>;

  const context = obj.context as Record<string, unknown> | undefined;
  if (!context || !isNonEmptyString(context.name) || !isNonEmptyString(context.coordinator)) {
    return { ok: false, error: "brain.yaml: context.name/context.coordinator obrigatórios" };
  }

  if (!Array.isArray(obj.repos) || obj.repos.length === 0) {
    return { ok: false, error: "brain.yaml: repos ausente ou vazio" };
  }
  for (let i = 0; i < obj.repos.length; i++) {
    const err = validateRepo(obj.repos[i], i);
    if (err) return { ok: false, error: `brain.yaml: ${err}` };
  }

  return { ok: true, brain: { context: context as BrainFile["context"], repos: obj.repos as RepoEntry[] } };
}
