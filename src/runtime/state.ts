// Machine-level AIPe state: the one directory everything outside a workspace
// writes to (update cache, upgrade lock, workspace registry, running servers).
//
// A workspace keeps its own state under <workspace>/.aipe/. This is the other
// half: facts about THIS MACHINE that survive across workspaces — which
// workspaces exist, which `aipe serve` processes are up, whether an upgrade is
// already running. `aipe upgrade` needs all three to put the machine back the
// way it found it, on the new binary.
import { homedir } from "node:os";
import { join } from "node:path";

/** Root of the machine state. Overridable with AIPE_HOME (tests, sandboxes). */
export function aipeStateDir(
  env: Record<string, string | undefined> = process.env,
  home: string = homedir(),
): string {
  return env.AIPE_HOME || join(home, ".aipe");
}

/** A file inside the machine state dir. */
export function statePath(...parts: string[]): string {
  return join(aipeStateDir(), ...parts);
}
