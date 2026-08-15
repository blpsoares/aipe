import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parse, stringify } from "yaml";
import { PROBED_HARNESSES } from "./probe";
import type { BinaryProbe, Capabilities, HarnessCapability } from "./types";

function capsPath(workspaceDir: string): string {
  return join(workspaceDir, ".aipe", "capabilities.yaml");
}

const VALID_SOURCES = new Set(["probe", "pe-confirmed"]);

// A `HarnessCapability` cast is erased at runtime: it validates nothing.
// A hand-edited file or a version-drifted schema can put `present: "yes"` or
// a made-up `source` on disk, and that shape would otherwise flow unchanged
// into `confirm()` and `drift()` and on into a dispatch recommendation.
function isValidHarnessCapability(v: unknown): v is HarnessCapability {
  if (!v || typeof v !== "object") return false;
  const h = v as Record<string, unknown>;
  return (
    typeof h.id === "string" &&
    typeof h.bin === "string" &&
    typeof h.present === "boolean" &&
    (typeof h.version === "string" || h.version === null) &&
    typeof h.source === "string" &&
    VALID_SOURCES.has(h.source) &&
    typeof h.checkedAt === "string"
  );
}

// Missing file, empty file, malformed YAML, or valid YAML of the wrong shape
// (e.g. `harnesses` present but not an array) all read as null — never a
// throw, and never mistaken for a valid empty record.
//
// Individual malformed entries (wrong field types, an unrecognised `source`)
// are dropped rather than failing the whole file: a fabricated or garbled
// entry flowing downstream can cause a dispatch to a harness that doesn't
// really work that way, which is worse than losing that one entry and
// falling back to a re-probe for it. Discarding the whole record over one
// bad line would throw away entries that were fine, which under-reports
// what the machine has for no reason. Either way this must not be silent —
// a caller that gets three harnesses back when the file listed four has no
// way to know unless we say so.
export async function readCapabilities(workspaceDir: string): Promise<Capabilities | null> {
  try {
    const path = capsPath(workspaceDir);
    const parsed = parse(await readFile(path, "utf8"));
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.harnesses)) return null;
    const harnesses = parsed.harnesses.filter(isValidHarnessCapability);
    if (harnesses.length !== parsed.harnesses.length) {
      const dropped = parsed.harnesses.length - harnesses.length;
      console.error(
        `readCapabilities: dropped ${dropped} malformed harness entr${dropped === 1 ? "y" : "ies"} from ${path}`,
      );
    }
    return { harnesses, confirmed: parsed.confirmed === true };
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
//
// A bin fresh reports but the record has never seen is treated as an
// implicit `present: false` baseline: nothing recorded is the same as
// recording absence. That makes a newly-installed harness (fresh says
// present, record has nothing) surface as drift symmetrically with a
// vanished one (record says present, fresh says gone) — the case this
// function exists to catch, since it is a new option the PE now has.
// If fresh instead reports it not present, there is no capability change
// to report, so nothing fires.
//
// The reverse gap — an entry `recorded` has that `fresh` doesn't mention at
// all — is deliberately NOT drift. `fresh` may be a partial probe (this
// repo's own tests pass partial lists), so a bin's absence from it means
// "not checked this round," not "confirmed gone." Only `probeAll`'s fixed,
// full table is a trustworthy fresh source in production, so this stays
// safe: it never turns "we didn't look" into a fabricated disappearance.
export function drift(recorded: Capabilities, fresh: BinaryProbe[]): string[] {
  const out: string[] = [];
  for (const f of fresh) {
    const recordedPresent = recorded.harnesses.find((h) => h.bin === f.bin)?.present ?? false;
    if (recordedPresent !== f.present) out.push(f.bin);
  }
  return out;
}
