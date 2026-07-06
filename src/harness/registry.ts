import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { claudeCodeAdapter } from "./claude-code";
import { genericAdapter } from "./generic";
import type { HarnessAdapter } from "./types";

const ADAPTERS: Record<string, HarnessAdapter> = {
  "claude-code": claudeCodeAdapter,
  generic: genericAdapter,
};

export const DEFAULT_HARNESS = "claude-code";

// Resolves the adapter for a harness id. Unknown/absent → Claude Code, so every
// pre-adapter workspace (and every existing test) keeps its current behavior.
export function getAdapter(id: string | null | undefined): HarnessAdapter {
  return ADAPTERS[id ?? DEFAULT_HARNESS] ?? claudeCodeAdapter;
}

export function hasAdapter(id: string): boolean {
  return id in ADAPTERS;
}

// A workspace records the harness it was set up for in `.aipe/harness` (a single
// line: the id). `aipe start` writes it; later commands read it to resolve the
// same adapter. Absent → the default (claude-code).
export async function writeHarness(workspaceDir: string, id: string): Promise<void> {
  const aipeDir = join(workspaceDir, ".aipe");
  await mkdir(aipeDir, { recursive: true });
  await writeFile(join(aipeDir, "harness"), `${id}\n`, "utf8");
}

export async function readHarness(workspaceDir: string): Promise<string> {
  try {
    const raw = await readFile(join(workspaceDir, ".aipe", "harness"), "utf8");
    const id = raw.trim();
    return hasAdapter(id) ? id : DEFAULT_HARNESS;
  } catch {
    return DEFAULT_HARNESS;
  }
}

export async function resolveAdapter(workspaceDir: string): Promise<HarnessAdapter> {
  return getAdapter(await readHarness(workspaceDir));
}
