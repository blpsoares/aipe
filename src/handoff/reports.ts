import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { isValidModule, isValidRelation } from "../relationship/reports";
import type { HandoffRepoReport } from "./types";

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
