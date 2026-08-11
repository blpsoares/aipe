import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { ModuleEntry, RawRelation, RelationType } from "../relationship/types";
import type { HandoffRepoReport } from "./types";

const RELATION_TYPES: readonly RelationType[] = [
  "imports",
  "published-by",
  "consumes",
  "exposed-by",
  "shares-infra",
];

function isValidRelation(value: unknown): value is RawRelation {
  if (typeof value !== "object" || value === null) return false;
  const r = value as Record<string, unknown>;
  return (
    (r.from === undefined || (typeof r.from === "string" && r.from.length > 0)) &&
    typeof r.to === "string" &&
    r.to.length > 0 &&
    typeof r.type === "string" &&
    (RELATION_TYPES as readonly string[]).includes(r.type) &&
    typeof r.detail === "string" &&
    typeof r.evidence === "string"
  );
}

function isValidModule(value: unknown): value is ModuleEntry {
  if (typeof value !== "object" || value === null) return false;
  const m = value as Record<string, unknown>;
  return (
    typeof m.id === "string" &&
    m.id.trim().length > 0 &&
    (m.stack === undefined || Array.isArray(m.stack)) &&
    (m.description === undefined || typeof m.description === "string")
  );
}

function isValidReport(value: unknown): value is HandoffRepoReport {
  if (typeof value !== "object" || value === null) return false;
  const r = value as Record<string, unknown>;
  return (
    typeof r.repo === "string" &&
    typeof r.purpose === "string" &&
    Array.isArray(r.stack) &&
    (r.modules === undefined || (Array.isArray(r.modules) && r.modules.every(isValidModule))) &&
    Array.isArray(r.relations) &&
    r.relations.every(isValidRelation)
  );
}

export async function readHandoffReports(reportsDir: string): Promise<HandoffRepoReport[]> {
  let files: string[];
  try {
    files = await readdir(reportsDir);
  } catch {
    return [];
  }

  const reports: HandoffRepoReport[] = [];
  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    try {
      const raw = await readFile(join(reportsDir, file), "utf8");
      const parsed: unknown = JSON.parse(raw);
      if (isValidReport(parsed)) reports.push(parsed);
    } catch {
      // malformed report file: treated as a missing report for that repo
    }
  }
  return reports;
}
