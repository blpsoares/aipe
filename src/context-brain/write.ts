import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { stringify } from "yaml";
import type { BrainFile, StateFile } from "./types";

export function initialState(): StateFile {
  return {
    phase: { brain: "done", workspace: "pending", relationship: "pending", specialists: "pending" },
  };
}

export async function writeBrainFiles(
  workspaceDir: string,
  brain: BrainFile,
): Promise<{ brainPath: string; statePath: string }> {
  const aipeDir = join(workspaceDir, ".aipe");
  await mkdir(aipeDir, { recursive: true });
  const brainPath = join(aipeDir, "brain.yaml");
  const statePath = join(aipeDir, "state.yaml");
  await writeFile(brainPath, stringify(brain), "utf8");
  await writeFile(statePath, stringify(initialState()), "utf8");
  return { brainPath, statePath };
}
