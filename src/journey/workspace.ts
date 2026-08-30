// Resolving the workspace for a ledger command — and refusing to guess.
//
// The journey ledger lives under `<workspace>/.aipe/journeys/`. Commands that
// enumerate it (`dedupe`, and any future maintenance command with the same
// shape) resolve their workspace from `--workspace` or the current directory.
// The trap: `listJourneys` treats a missing `.aipe/journeys/` as an empty
// ledger, so a command run from a directory that is NOT a workspace reported a
// clean zero — indistinguishable from "a real workspace with nothing to do".
// "Nothing found" and "nothing searched" must never read the same.
//
// This resolver draws that line before the command touches the ledger: a
// directory is a workspace target only if it exists and carries an `.aipe/`
// directory that is not the machine state dir (`~/.aipe`, excluded the same way
// looksLikeWorkspace excludes it — running an `aipe` command from $HOME must
// never treat the state dir as a workspace). Anything else is refused with a
// reason the operator can act on, so the caller can fail visibly instead of
// printing a false zero.
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { aipeStateDir } from "../runtime/state";

export type LedgerWorkspace =
  | { ok: true; workspace: string }
  | { ok: false; reason: string };

export function resolveLedgerWorkspace(
  dir: string,
  deps: { exists?: (p: string) => boolean; stateDir?: string } = {},
): LedgerWorkspace {
  const exists = deps.exists ?? existsSync;
  const stateDir = deps.stateDir ?? aipeStateDir();
  const abs = resolve(dir);
  if (!exists(abs)) {
    return { ok: false, reason: `directory does not exist: ${abs}` };
  }
  const aipe = resolve(abs, ".aipe");
  if (aipe === resolve(stateDir)) {
    return { ok: false, reason: `${abs} is the AIPe machine state directory, not a workspace` };
  }
  if (!exists(aipe)) {
    return { ok: false, reason: `${abs} has no .aipe/ — it is not an AIPe workspace` };
  }
  return { ok: true, workspace: abs };
}
