import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { RepoReport } from "./types";

function isValidReport(value: unknown): value is RepoReport {
  if (typeof value !== "object" || value === null) return false;
  const r = value as Record<string, unknown>;
  return typeof r.repo === "string" && Array.isArray(r.stack) && Array.isArray(r.relations);
}

export async function readReports(reportsDir: string): Promise<RepoReport[]> {
  let files: string[];
  try {
    files = await readdir(reportsDir);
  } catch {
    return [];
  }

  const reports: RepoReport[] = [];
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
