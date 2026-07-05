import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parse, stringify } from "yaml";
import { emptyToolbox } from "./types";
import type { McpEntry, SkillEntry, Toolbox } from "./types";

function toolboxPath(workspaceDir: string): string {
  return join(workspaceDir, ".aipe", "toolbox.yaml");
}

export async function readToolbox(workspaceDir: string): Promise<Toolbox> {
  try {
    const parsed = parse(await readFile(toolboxPath(workspaceDir), "utf8"));
    if (parsed && typeof parsed === "object") {
      return {
        skills: Array.isArray(parsed.skills) ? (parsed.skills as SkillEntry[]) : [],
        mcps: Array.isArray(parsed.mcps) ? (parsed.mcps as McpEntry[]) : [],
      };
    }
  } catch {
    // missing or malformed → empty catalog
  }
  return emptyToolbox();
}

export async function writeToolbox(workspaceDir: string, toolbox: Toolbox): Promise<string> {
  const path = toolboxPath(workspaceDir);
  await mkdir(join(workspaceDir, ".aipe"), { recursive: true });
  await writeFile(path, stringify(toolbox), "utf8");
  return path;
}

// Upsert by name (case-insensitive), preserving order (updates in place).
export function upsertSkill(toolbox: Toolbox, entry: SkillEntry): Toolbox {
  const skills = [...toolbox.skills];
  const idx = skills.findIndex((s) => s.name.toLowerCase() === entry.name.toLowerCase());
  if (idx >= 0) skills[idx] = entry;
  else skills.push(entry);
  return { ...toolbox, skills };
}

export function upsertMcp(toolbox: Toolbox, entry: McpEntry): Toolbox {
  const mcps = [...toolbox.mcps];
  const idx = mcps.findIndex((m) => m.name.toLowerCase() === entry.name.toLowerCase());
  if (idx >= 0) mcps[idx] = entry;
  else mcps.push(entry);
  return { ...toolbox, mcps };
}

// Remove by name (case-insensitive), returning the pruned catalog and the entry
// that was dropped (null if there was none) so callers can clean up its files.
export function removeSkillEntry(toolbox: Toolbox, name: string): { toolbox: Toolbox; removed: SkillEntry | null } {
  const removed = toolbox.skills.find((s) => s.name.toLowerCase() === name.toLowerCase()) ?? null;
  if (!removed) return { toolbox, removed: null };
  return { toolbox: { ...toolbox, skills: toolbox.skills.filter((s) => s !== removed) }, removed };
}

export function removeMcpEntry(toolbox: Toolbox, name: string): { toolbox: Toolbox; removed: McpEntry | null } {
  const removed = toolbox.mcps.find((m) => m.name.toLowerCase() === name.toLowerCase()) ?? null;
  if (!removed) return { toolbox, removed: null };
  return { toolbox: { ...toolbox, mcps: toolbox.mcps.filter((m) => m !== removed) }, removed };
}
