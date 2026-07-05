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
  if (typeof repo !== "object" || repo === null) return `repos[${index}]: expected object`;
  const r = repo as Record<string, unknown>;
  if (!isNonEmptyString(r.name)) return `repos[${index}].name: required`;
  if (!isNonEmptyString(r.url)) return `repos[${index}].url: required`;
  if (!isNonEmptyString(r.path)) return `repos[${index}].path: required`;
  if (r.modules !== undefined) {
    if (!Array.isArray(r.modules)) return `repos[${index}].modules: expected array`;
    const seen = new Set<string>();
    for (let j = 0; j < r.modules.length; j++) {
      const m = r.modules[j];
      if (typeof m !== "object" || m === null) return `repos[${index}].modules[${j}]: expected object`;
      const mo = m as Record<string, unknown>;
      if (!isNonEmptyString(mo.name)) return `repos[${index}].modules[${j}].name: required`;
      if (!isNonEmptyString(mo.path)) return `repos[${index}].modules[${j}].path: required`;
      if (seen.has(mo.name)) return `repos[${index}].modules[${j}].name: duplicate "${mo.name}"`;
      seen.add(mo.name);
    }
  }
  return null;
}

export async function readBrain(workspaceDir: string): Promise<ReadBrainResult> {
  const brainPath = join(workspaceDir, ".aipe", "brain.yaml");
  let raw: string;
  try {
    raw = await readFile(brainPath, "utf8");
  } catch {
    return { ok: false, error: `brain.yaml not found at ${brainPath}. Run /context-brain first.` };
  }

  let parsed: unknown;
  try {
    parsed = parse(raw);
  } catch {
    return { ok: false, error: "brain.yaml: invalid YAML" };
  }

  if (typeof parsed !== "object" || parsed === null) {
    return { ok: false, error: "brain.yaml: expected an object" };
  }
  const obj = parsed as Record<string, unknown>;

  const context = obj.context as Record<string, unknown> | undefined;
  if (!context || !isNonEmptyString(context.name) || !isNonEmptyString(context.coordinator)) {
    return { ok: false, error: "brain.yaml: context.name/context.coordinator required" };
  }

  if (!Array.isArray(obj.repos) || obj.repos.length === 0) {
    return { ok: false, error: "brain.yaml: repos missing or empty" };
  }
  for (let i = 0; i < obj.repos.length; i++) {
    const err = validateRepo(obj.repos[i], i);
    if (err) return { ok: false, error: `brain.yaml: ${err}` };
  }

  return { ok: true, brain: { context: context as unknown as BrainFile["context"], repos: obj.repos as RepoEntry[] } };
}
