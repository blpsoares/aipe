import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse } from "yaml";
import type { PersonaRegistryEntry } from "./types";

const ROLES = new Set(["coordinator", "dev-fullstack", "qa"]);

function isEntry(value: unknown): value is PersonaRegistryEntry {
  if (typeof value !== "object" || value === null) return false;
  const r = value as Record<string, unknown>;
  return typeof r.name === "string" && r.name.length > 0 && typeof r.role === "string" && ROLES.has(r.role);
}

// Reads the durable persona roster (coordinator + every hired persona) written
// by /hire-specialists. Missing or malformed → empty roster.
export async function readPersonas(workspaceDir: string): Promise<PersonaRegistryEntry[]> {
  const path = join(workspaceDir, ".aipe", "personas.yaml");
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = parse(raw);
  } catch {
    return [];
  }
  if (typeof parsed !== "object" || parsed === null) return [];
  const list = (parsed as Record<string, unknown>).personas;
  if (!Array.isArray(list)) return [];
  // Normalize legacy rosters (no fqid/module) so downstream code sees null,
  // not undefined; fqid falls back to the repo for whole-repo personas.
  return list.filter(isEntry).map((e) => ({
    ...e,
    module: e.module ?? null,
    fqid: e.fqid ?? (e.repo ?? null),
    path: e.path ?? null,
  }));
}
