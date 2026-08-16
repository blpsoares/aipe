#!/usr/bin/env bun
// `aipe execution <propose|plan>` — the two halves of the envelope decision.
//
// `propose` is pre-choice: it enumerates and prices every viable envelope for
// each unit in a journey. It never chooses — proposeForUnit deliberately has
// no opinion, so the coordinator (and ultimately the PE) does the choosing.
//
// `plan` is post-choice: once the PE has approved the Orientation Spec and the
// chosen envelope (mode, harness, tier, intensity, model) is recorded per unit
// in the journey ledger, `plan` reads those recorded envelopes, groups them
// into waves with groupIntoWaves, and prints the wave-level cost index and any
// gate reasons. This is the ONLY path by which the wave-level policy limits
// (gateAboveSessions, maxCostIndexPerWave) reach a human — groupIntoWaves has
// no other caller in this codebase.
import { packageFqid } from "../context-brain/packages";
import { readCapabilities } from "../capabilities/store";
import type { Capabilities } from "../capabilities/types";
import { readLedger } from "../journey/ledger";
import type { JourneyDispatch } from "../journey/types";
import { isTier } from "../model/types";
import { readExecutionPolicy } from "./policy";
import { proposeForUnit } from "./propose";
import { groupIntoWaves, type ChosenUnit } from "./waves";
import type { Envelope } from "./types";

function getFlag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const value = args[i + 1];
  if (value === undefined || value.startsWith("--")) return undefined;
  return value;
}

const COST_INDEX_NOTE =
  "NOTE cost-index is a COARSE RELATIVE INDEX, not currency: the cheapest envelope (subagent, fast tier, normal intensity) is 1.";

function droppedWarning(dropped: number): string {
  const noun = dropped === 1 ? "entry" : "entries";
  return `WARN capabilities: ${dropped} malformed ${noun} discarded from the record — re-run \`aipe capabilities probe\` to rebuild it`;
}

const UNCONFIRMED_NOTE =
  "NOTE capabilities: this record was probed but never confirmed by you — a binary on PATH is not an authenticated binary.";

type CapsLoad =
  | { ok: true; caps: Capabilities; leadingLines: string[]; trailingNotes: string[] }
  | { ok: false; lines: string[] };

async function loadCapabilities(workspace: string): Promise<CapsLoad> {
  const result = await readCapabilities(workspace);
  if (!result) {
    return {
      ok: false,
      lines: [
        "ERROR capabilities: no record — run `aipe capabilities probe` then `aipe capabilities confirm`",
      ],
    };
  }
  const { capabilities: caps, dropped } = result;
  const leadingLines: string[] = [];
  const trailingNotes: string[] = [];
  if (dropped > 0) leadingLines.push(droppedWarning(dropped));
  if (!caps.confirmed) trailingNotes.push(UNCONFIRMED_NOTE);
  return { ok: true, caps, leadingLines, trailingNotes };
}

export interface ProposeCommandOptions {
  workspace: string;
  journeyId: string;
}

export async function proposeCommand(
  opts: ProposeCommandOptions,
): Promise<{ code: number; lines: string[] }> {
  const capsLoad = await loadCapabilities(opts.workspace);
  if (!capsLoad.ok) return { code: 1, lines: capsLoad.lines };
  const { caps, leadingLines, trailingNotes } = capsLoad;

  const ledger = await readLedger(opts.workspace, opts.journeyId);
  if (!ledger) {
    return { code: 1, lines: [`ERROR journey: no ledger for ${opts.journeyId}`] };
  }
  if (ledger.dispatches.length === 0) {
    return {
      code: 1,
      lines: [`ERROR journey: ${opts.journeyId} has no units yet — nothing to propose for`],
    };
  }

  const policy = await readExecutionPolicy(opts.workspace);
  const lines: string[] = [...leadingLines];

  for (const d of ledger.dispatches) {
    const fqid = packageFqid(d.repo, d.package);
    const proposal = proposeForUnit(fqid, caps, policy, {});
    lines.push(`UNIT ${fqid}`);
    for (const o of proposal.options) {
      const e = o.envelope;
      const gate = o.gated ? ` GATED (${o.gateReasons.join("; ")})` : "";
      lines.push(`  ${e.mode} ${e.harness} ${e.tier} ${e.intensity} cost-index=${o.costIndex}${gate}`);
    }
    for (const x of proposal.excluded) {
      lines.push(`  -- ${x.harness} excluded: ${x.reason}`);
    }
  }

  lines.push(...trailingNotes);
  lines.push(COST_INDEX_NOTE);
  return { code: 0, lines };
}

// A dispatch's recorded envelope is complete only when all four fields are
// present AND the tier is a value the model layer still recognizes — a
// hand-edited or stale ledger entry with a bogus tier is treated the same as
// "not chosen yet", never smuggled into groupIntoWaves as a fake Envelope.
//
// `model` is checked too, but only for session mode: agentop binds --model
// per BATCH, so a session unit with no model chosen is not a finished
// decision — it must be excluded, exactly like any other incomplete
// envelope, rather than defaulting to null and landing in a real session
// wave mislabeled as "model binds per unit" (that label is true only for
// subagent mode). A subagent unit with no model is still complete: there the
// model genuinely binds per unit, so there is nothing to be missing.
function recordedEnvelope(d: JourneyDispatch): Envelope | null {
  if (!d.mode || !d.harness || !d.tier || !d.intensity) return null;
  if (!isTier(d.tier)) return null;
  if (d.mode === "session" && !d.model) return null;
  return { mode: d.mode, harness: d.harness, tier: d.tier, intensity: d.intensity };
}

export interface PlanCommandOptions {
  workspace: string;
  journeyId: string;
}

export async function planCommand(
  opts: PlanCommandOptions,
): Promise<{ code: number; lines: string[] }> {
  const capsLoad = await loadCapabilities(opts.workspace);
  if (!capsLoad.ok) return { code: 1, lines: capsLoad.lines };
  const { leadingLines, trailingNotes } = capsLoad;

  const ledger = await readLedger(opts.workspace, opts.journeyId);
  if (!ledger) {
    return { code: 1, lines: [`ERROR journey: no ledger for ${opts.journeyId}`] };
  }
  if (ledger.dispatches.length === 0) {
    return {
      code: 1,
      lines: [`ERROR journey: ${opts.journeyId} has no units yet — nothing to plan for`],
    };
  }

  const chosen: ChosenUnit[] = [];
  const missing: string[] = [];
  for (const d of ledger.dispatches) {
    const fqid = packageFqid(d.repo, d.package);
    const envelope = recordedEnvelope(d);
    if (!envelope) {
      missing.push(fqid);
      continue;
    }
    chosen.push({ fqid, envelope, model: d.model ?? null });
  }

  if (chosen.length === 0) {
    return {
      code: 1,
      lines: [
        `ERROR journey: no unit in ${opts.journeyId} has a chosen envelope yet — approve the Orientation Spec first, then re-run \`aipe execution plan\``,
      ],
    };
  }

  const policy = await readExecutionPolicy(opts.workspace);
  const { waves, notes } = groupIntoWaves(chosen, policy);

  const lines: string[] = [...leadingLines];
  for (const fqid of missing) {
    lines.push(`NOTE unit ${fqid}: no envelope recorded yet — excluded from this plan`);
  }

  // `Wave.model === null` is ambiguous by construction (waves.ts, deliberately
  // out of scope here, hardcodes it for the one subagent wave — where the
  // model genuinely binds per unit) — it says nothing about *why* a wave has
  // no model. Deriving the label from the envelope mode of the wave's own
  // units, instead of from `model === null`, keeps that ambiguity from ever
  // reaching this print site: recordedEnvelope above already guarantees every
  // session ChosenUnit that survives into `chosen` has a real model, so a
  // session-mode wave here always has `w.model` set, and only the one
  // subagent wave can print the "binds per unit" label.
  const modeByFqid = new Map(chosen.map((c) => [c.fqid, c.envelope.mode]));
  waves.forEach((w, i) => {
    // A wave's units are never empty (groupIntoWaves only pushes a wave for a
    // non-empty slice of members), so units[0] always resolves.
    const isSubagentWave = modeByFqid.get(w.units[0]!) === "subagent";
    const model = isSubagentWave
      ? "(subagent — model binds per unit)"
      : (w.model ??
        "(session wave with no model recorded — this should be unreachable; recordedEnvelope is meant to exclude it)");
    const gate = w.gated ? ` GATED (${w.gateReasons.join("; ")})` : "";
    lines.push(`WAVE ${i + 1} model=${model} units=${w.units.join(",")} cost-index=${w.costIndex}${gate}`);
  });
  for (const note of notes) lines.push(`NOTE ${note}`);
  lines.push(...trailingNotes);
  lines.push(COST_INDEX_NOTE);
  return { code: 0, lines };
}

const HELP = [
  "aipe execution — price and plan the ways a journey's units could be run",
  "",
  "  propose --journey <id> [--workspace <dir>]   Enumerate and price the viable envelopes",
  "  plan    --journey <id> [--workspace <dir>]   Group the CHOSEN envelopes into waves",
].join("\n");

export async function run(args: string[]): Promise<number> {
  const [sub, ...rest] = args;
  if (sub !== "propose" && sub !== "plan") {
    console.log(HELP);
    return sub === undefined || sub === "--help" ? 0 : 1;
  }
  const workspace = getFlag(rest, "--workspace") ?? process.cwd();
  const journeyId = getFlag(rest, "--journey");
  if (!journeyId) {
    console.log("ERROR journey: --journey <id> is required");
    return 1;
  }
  const { code, lines } =
    sub === "propose"
      ? await proposeCommand({ workspace, journeyId })
      : await planCommand({ workspace, journeyId });
  for (const line of lines) console.log(line);
  return code;
}

if (import.meta.main) {
  run(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((err) => {
      console.log(`ERROR ${err}`);
      process.exit(1);
    });
}
