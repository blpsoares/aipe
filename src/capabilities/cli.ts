#!/usr/bin/env bun
// `aipe capabilities <probe|show|confirm>` — what this machine can actually
// run. A probe result is a CLAIM WITH A DATE, not a fact: a binary on PATH is
// not an authenticated binary, so `probe` says so out loud, and `confirm` is
// the only thing that outranks a probe — the PE's word, recorded as such.
import { probeAll, realProbeRunner } from "./probe";
import { confirm, drift, fromProbes, readCapabilities, writeCapabilities } from "./store";
import type { ProbeRunner } from "./types";

function getFlag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const value = args[i + 1];
  if (value === undefined || value.startsWith("--")) return undefined;
  return value;
}

const UNCONFIRMED_NOTE =
  "NOTE capabilities: probed, not confirmed — a binary on PATH is not an authenticated binary. Run `aipe capabilities confirm` once you have checked.";

// `readCapabilities` already dropped the malformed entries before returning —
// this is the only place a human finds out it happened. A PE whose record
// silently lost a harness has no way to know an option disappeared, so
// `dropped > 0` gets its own WARN line, separate from the OK/DRIFT lines that
// describe the (still usable) entries that are left.
function droppedWarning(dropped: number): string {
  const noun = dropped === 1 ? "entry" : "entries";
  return `WARN capabilities: ${dropped} malformed ${noun} discarded from the record — it may be missing a harness; re-run \`aipe capabilities probe\` to rebuild it`;
}

export async function probeCommand(
  workspaceDir: string,
  runner: ProbeRunner,
  now: string,
): Promise<{ code: number; lines: string[] }> {
  const caps = fromProbes(await probeAll(runner), now);
  await writeCapabilities(workspaceDir, caps);
  const lines = caps.harnesses.map((h) =>
    h.present ? `OK ${h.id} ${h.bin} ${h.version ?? "unversioned"}` : `-- ${h.id} ${h.bin} absent`,
  );
  lines.push(UNCONFIRMED_NOTE);
  return { code: 0, lines };
}

export async function confirmCommand(
  workspaceDir: string,
  now: string,
): Promise<{ code: number; lines: string[] }> {
  const result = await readCapabilities(workspaceDir);
  if (!result) {
    return {
      code: 1,
      lines: ["ERROR capabilities: nothing to confirm — run `aipe capabilities probe` first"],
    };
  }
  const { capabilities: caps, dropped } = result;
  await writeCapabilities(workspaceDir, confirm(caps, now));
  const lines: string[] = [];
  if (dropped > 0) lines.push(droppedWarning(dropped));
  lines.push(`OK capabilities confirmed ${caps.harnesses.length} harnesses`);
  return { code: 0, lines };
}

export async function showCommand(
  workspaceDir: string,
  runner: ProbeRunner,
  now: string,
): Promise<{ code: number; lines: string[] }> {
  const result = await readCapabilities(workspaceDir);
  if (!result) {
    return { code: 1, lines: ["ERROR capabilities: no record — run `aipe capabilities probe` first"] };
  }
  const { capabilities: caps, dropped } = result;
  const lines: string[] = [];
  if (dropped > 0) lines.push(droppedWarning(dropped));
  lines.push(
    ...caps.harnesses.map(
      (h) => `${h.present ? "OK" : "--"} ${h.id} ${h.bin} ${h.version ?? "unversioned"} (${h.source} ${h.checkedAt})`,
    ),
  );
  if (!caps.confirmed) lines.push(UNCONFIRMED_NOTE);

  const fresh = await probeAll(runner);
  const driftedBins = drift(caps, fresh);
  for (const bin of driftedBins) {
    const rec = caps.harnesses.find((h) => h.bin === bin);
    // Drift is symmetric (see store.ts's `drift`): a bin can vanish (record
    // had it present, now it's gone) or appear (record had it absent — or
    // never recorded it at all — and it's present now). Each direction gets
    // its own wording so a newly-installed harness isn't reported as having
    // "disappeared".
    lines.push(
      rec === undefined
        ? `DRIFT ${bin} — not recorded, now present. Re-run \`aipe capabilities probe\`.`
        : rec.present
          ? `DRIFT ${bin} — recorded present, now absent. Re-run \`aipe capabilities probe\`.`
          : `DRIFT ${bin} — recorded absent, now present. Re-run \`aipe capabilities probe\`.`,
    );
  }
  return { code: driftedBins.length > 0 ? 2 : 0, lines };
}

const HELP = [
  "aipe capabilities — what this machine can actually run",
  "",
  "  probe    [--workspace <dir>]   Detect harness binaries and record them",
  "  show     [--workspace <dir>]   Print the record and flag any drift",
  "  confirm  [--workspace <dir>]   Mark the record as checked by you",
].join("\n");

export async function run(args: string[]): Promise<number> {
  const [sub, ...rest] = args;
  const workspace = getFlag(rest, "--workspace") ?? process.cwd();
  const now = new Date().toISOString();
  let result: { code: number; lines: string[] } | null = null;
  switch (sub) {
    case "probe":
      result = await probeCommand(workspace, realProbeRunner, now);
      break;
    case "show":
      result = await showCommand(workspace, realProbeRunner, now);
      break;
    case "confirm":
      result = await confirmCommand(workspace, now);
      break;
    default:
      console.log(HELP);
      return sub === undefined || sub === "--help" ? 0 : 1;
  }
  for (const line of result.lines) console.log(line);
  return result.code;
}

if (import.meta.main) {
  run(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((err) => {
      console.log(`ERROR ${err}`);
      process.exit(1);
    });
}
