import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parse, stringify } from "yaml";
import type { Phase, StateFile } from "../context-brain/types";
import { initialState } from "../context-brain/write";

export async function updateSpecialistsPhase(workspaceDir: string, phase: Phase): Promise<string> {
  const aipeDir = join(workspaceDir, ".aipe");
  const statePath = join(aipeDir, "state.yaml");

  let state: StateFile = initialState();
  try {
    const raw = await readFile(statePath, "utf8");
    const parsed = parse(raw);
    if (parsed && typeof parsed === "object" && parsed.phase) {
      state = { phase: { ...state.phase, ...parsed.phase } };
    }
  } catch {
    // no prior state: start from the default
  }

  state.phase.specialists = phase;
  await mkdir(aipeDir, { recursive: true });
  await writeFile(statePath, stringify(state), "utf8");
  return statePath;
}
