import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parse, stringify } from "yaml";
import { PROBED_HARNESSES } from "./probe";
import type { BinaryProbe, Capabilities, HarnessCapability } from "./types";

function capsPath(workspaceDir: string): string {
  return join(workspaceDir, ".aipe", "capabilities.yaml");
}

// Missing file, empty file, malformed YAML, or valid YAML of the wrong shape
// (e.g. `harnesses` present but not an array) all read as null — never a
// throw, and never mistaken for a valid empty record.
export async function readCapabilities(workspaceDir: string): Promise<Capabilities | null> {
  try {
    const parsed = parse(await readFile(capsPath(workspaceDir), "utf8"));
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.harnesses)) return null;
    return { harnesses: parsed.harnesses as HarnessCapability[], confirmed: parsed.confirmed === true };
  } catch {
    return null;
  }
}

export async function writeCapabilities(workspaceDir: string, caps: Capabilities): Promise<string> {
  const path = capsPath(workspaceDir);
  await mkdir(join(workspaceDir, ".aipe"), { recursive: true });
  await writeFile(path, stringify(caps), "utf8");
  return path;
}

// `now` is a parameter, not Date.now(): the stored timestamp is the whole point
// of provenance, and a test that cannot pin it cannot assert on it.
//
// A probe for a binary not in PROBED_HARNESSES is skipped rather than stored:
// this store only ever holds entries agentop could actually dispatch to (id +
// bin come from that same table in fromProbes' output), so an unknown bin has
// no adapter id to file it under and would corrupt the shape everything else
// here relies on.
export function fromProbes(probes: BinaryProbe[], now: string): Capabilities {
  const harnesses: HarnessCapability[] = [];
  for (const p of probes) {
    const known = PROBED_HARNESSES.find((h) => h.bin === p.bin);
    if (!known) continue;
    harnesses.push({
      id: known.id,
      bin: p.bin,
      present: p.present,
      version: p.version,
      source: "probe",
      checkedAt: now,
    });
  }
  return { harnesses, confirmed: false };
}

// The PE's word outranks a probe. Recording that as the entry's `source` is
// what stops a later probe from silently overwriting a correction.
export function confirm(caps: Capabilities, now: string): Capabilities {
  return {
    confirmed: true,
    harnesses: caps.harnesses.map((h) => ({ ...h, source: "pe-confirmed", checkedAt: now })),
  };
}

// Only PRESENCE counts as drift. A version bump is normal and constant; a
// harness appearing or disappearing changes what may be dispatched.
export function drift(recorded: Capabilities, fresh: BinaryProbe[]): string[] {
  const out: string[] = [];
  for (const f of fresh) {
    const r = recorded.harnesses.find((h) => h.bin === f.bin);
    if (r && r.present !== f.present) out.push(f.bin);
  }
  return out;
}
