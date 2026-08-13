import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parse, stringify } from "yaml";
import { rehydrateFlowSkills } from "../rehydrate/flow-skills";
import { rehydratePersonas } from "../rehydrate/personas";
import { rehydrateToolbox } from "../rehydrate/toolbox";

export interface RehydrateDeps {
  rehydratePersonas: (root: string) => Promise<unknown>;
  rehydrateToolbox: (root: string) => Promise<unknown>;
  rehydrateFlowSkills: (root: string) => Promise<unknown>;
}

const DEFAULT_DEPS: RehydrateDeps = { rehydratePersonas, rehydrateToolbox, rehydrateFlowSkills };

function stampPath(root: string): string {
  return join(root, ".aipe", "toolchain.yaml");
}

async function readStampedVersion(root: string): Promise<string | undefined> {
  try {
    const raw = await readFile(stampPath(root), "utf8");
    const parsed = parse(raw);
    const version = (parsed as { aipeVersion?: unknown } | null)?.aipeVersion;
    return typeof version === "string" ? version : undefined;
  } catch {
    return undefined;
  }
}

async function writeStampedVersion(root: string, version: string): Promise<void> {
  await mkdir(join(root, ".aipe"), { recursive: true });
  await writeFile(stampPath(root), stringify({ aipeVersion: version }), "utf8");
}

// Re-syncs a workspace's installed skills (personas, toolbox, flow-skills)
// from the running binary whenever the binary is newer than whatever
// generated the skills currently on disk — so a SessionStart hook always
// sees up-to-date skills without the PE ever running `aipe rehydrate`
// themselves. Never throws: a rehydrate failure degrades to "skills stay a
// bit stale this session," never to a broken hook.
export async function ensureRehydrated(
  root: string,
  currentVersion: string,
  deps: RehydrateDeps = DEFAULT_DEPS,
): Promise<boolean> {
  const stamped = await readStampedVersion(root);
  if (stamped === currentVersion) return false;

  try {
    await deps.rehydratePersonas(root);
    await deps.rehydrateToolbox(root);
    await deps.rehydrateFlowSkills(root);
    await writeStampedVersion(root, currentVersion);
    return true;
  } catch {
    return false;
  }
}
