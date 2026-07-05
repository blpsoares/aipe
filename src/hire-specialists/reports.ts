import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { PersonaReport } from "./types";

const ROLES = new Set(["dev-fullstack", "qa"]);

function isValidReport(value: unknown): value is PersonaReport {
  if (typeof value !== "object" || value === null) return false;
  const r = value as Record<string, unknown>;
  return (
    typeof r.repo === "string" &&
    r.repo.trim().length > 0 &&
    typeof r.role === "string" &&
    ROLES.has(r.role) &&
    typeof r.name === "string" &&
    r.name.trim().length > 0 &&
    typeof r.body === "string" &&
    r.body.trim().length > 0
  );
}

export async function readReports(reportsDir: string): Promise<PersonaReport[]> {
  let files: string[];
  try {
    files = await readdir(reportsDir);
  } catch {
    return [];
  }

  const reports: PersonaReport[] = [];
  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    try {
      const raw = await readFile(join(reportsDir, file), "utf8");
      const parsed: unknown = JSON.parse(raw);
      if (isValidReport(parsed)) reports.push(parsed);
    } catch {
      // malformed report file: treated as a missing (repo, role) pair
    }
  }
  return reports;
}
