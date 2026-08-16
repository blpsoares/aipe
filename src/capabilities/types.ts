// What this machine can actually run. A probe result is a CLAIM WITH A DATE,
// not a fact: a binary on PATH is not an authenticated binary, and a harness
// that was usable last month may not be after a CLI update. Everything here
// keeps provenance so a stale claim is distinguishable from a fresh one.

export type ProbeRunner = (
  bin: string,
  args: string[],
) => Promise<{ code: number; stdout: string; stderr: string }>;

export interface BinaryProbe {
  bin: string;
  present: boolean;
  version: string | null;
}

// `source` is what makes a confirmation outrank a probe: the PE's word is
// recorded as such, so a later probe cannot silently overwrite it.
export type CapabilitySource = "probe" | "pe-confirmed";

export interface HarnessCapability {
  id: string; // adapter id: claude-code, gemini, codex, copilot
  bin: string;
  present: boolean;
  version: string | null;
  source: CapabilitySource;
  checkedAt: string; // ISO date
}

export interface Capabilities {
  harnesses: HarnessCapability[];
  confirmed: boolean; // has the PE ever confirmed this file?
}
