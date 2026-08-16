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
import { probeAll, realProbeRunner } from "../capabilities/probe";
import { fromProbes, readCapabilities, writeCapabilities } from "../capabilities/store";
import type { Capabilities, ProbeRunner } from "../capabilities/types";
import { getAdapter, hasAdapter } from "../harness/registry";
import { isContainable } from "../harness/types";
import { readLedger } from "../journey/ledger";
import type { DispatchStatus, JourneyDispatch } from "../journey/types";
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

const AUTO_PROBED_NOTE =
  "NOTE capabilities: no record found — probed this machine automatically just now.";

const PROBED_BIN_LIST = "claude, gemini, codex, copilot";

type CapsLoad =
  | { ok: true; caps: Capabilities; leadingLines: string[]; trailingNotes: string[] }
  | { ok: false; lines: string[] };

// `plan` never self-heals: it only ever reads what `propose`/`aipe
// capabilities probe` already recorded, so a missing record there is always
// a firm refusal.
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

// `propose` is the coordinator's entry point, and the whole point of this
// subsystem is that the coordinator arrives with a FILLED envelope instead of
// handing the human a blank one — so a missing record here self-heals by
// probing right where the refusal used to be, instead of making the human
// run `aipe capabilities probe` by hand just to get back to where `aipe
// start` should already have left them.
//
// An EXISTING record — confirmed or not — is never re-probed here. Two
// reasons, not one:
//   - a confirmed record is the PE's word; re-probing on every `propose`
//     would risk silently discarding a correction the moment the machine's
//     PATH looks different than last time.
//   - an UNCONFIRMED record is still the most recent evidence anyone has
//     bothered to gather. Re-probing it on every call would make repeated
//     `propose` invocations churn the file for no benefit, and would give an
//     unconfirmed record less stability than a confirmed one deserves — the
//     only thing that should ever promote unconfirmed to confirmed is `aipe
//     capabilities confirm`, never a side effect of `propose` happening to
//     run again.
// So self-healing fires exactly once: the first time there is nothing on
// disk at all.
async function loadOrProbeCapabilities(
  workspace: string,
  runner: ProbeRunner,
  now: string,
): Promise<CapsLoad> {
  const result = await readCapabilities(workspace);
  if (result) {
    const { capabilities: caps, dropped } = result;
    const leadingLines: string[] = [];
    const trailingNotes: string[] = [];
    if (dropped > 0) leadingLines.push(droppedWarning(dropped));
    if (!caps.confirmed) trailingNotes.push(UNCONFIRMED_NOTE);
    return { ok: true, caps, leadingLines, trailingNotes };
  }

  let probes;
  try {
    probes = await probeAll(runner);
  } catch (err) {
    return {
      ok: false,
      lines: [
        `ERROR capabilities: automatic probe failed (${err}) — run \`aipe capabilities probe\` to see why, then \`aipe capabilities confirm\``,
      ],
    };
  }

  const caps = fromProbes(probes, now);
  if (!caps.harnesses.some((h) => h.present)) {
    // Nothing usable: refuse rather than invent options, and don't persist a
    // record that would make the NEXT call skip probing again (this stays a
    // one-shot self-heal attempt every time, not a permanent all-absent
    // record blocking a future retry once something gets installed).
    return {
      ok: false,
      lines: [
        `ERROR capabilities: probed this machine automatically and found no usable harness (${PROBED_BIN_LIST} all absent) — install one, then re-run \`aipe execution propose\``,
      ],
    };
  }

  await writeCapabilities(workspace, caps);
  return { ok: true, caps, leadingLines: [AUTO_PROBED_NOTE], trailingNotes: [UNCONFIRMED_NOTE] };
}

export interface ProposeCommandOptions {
  workspace: string;
  journeyId: string;
  // Injectable so tests never shell out to a real harness binary — see
  // capabilities/__tests__/cli.test.ts's `only()` for the pattern this
  // follows. Defaults to the real subprocess runner outside tests.
  runner?: ProbeRunner;
  now?: string;
}

export async function proposeCommand(
  opts: ProposeCommandOptions,
): Promise<{ code: number; lines: string[] }> {
  const runner = opts.runner ?? realProbeRunner;
  const now = opts.now ?? new Date().toISOString();
  const capsLoad = await loadOrProbeCapabilities(opts.workspace, runner, now);
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

// `plan` must key a unit for planning purposes the way the ledger keys a
// dispatch: (repo, package, specialist) — NOT the bare fqid `propose` uses,
// because SKILL.md dispatches a dev AND a QA against the same package as two
// separate ledger rows sharing one fqid. Folding them onto one fqid let a QA
// row silently overwrite a dev row's mode (see the `modeByFqid` bug this
// replaced). `@` matches the separator `dispatch/law.ts` already uses for a
// specialist-qualified unit (`unknown-specialist name@repo`), so a human
// reading `embark@Joaquim` and `embark@Marina` recognizes the idiom.
function dispatchLabel(d: JourneyDispatch): string {
  return `${packageFqid(d.repo, d.package)}@${d.specialist}`;
}

// Only a dispatch that still represents work the coordinator could run
// belongs in a human-facing plan:
//   - `dispatched`  — claimed, not yet delivered: this IS the pending work.
//   - `delivered`/`verified`/`merged` — the dev/QA step this ROW records is
//     already done (verified/merged is the `verified|merged` = landed idiom
//     dispatch/cli.ts already establishes for "safe to build on"; `delivered`
//     is the same "this row's job is finished" state one step earlier, just
//     not yet QA-cleared). Replanning it re-prices and re-gates work that
//     will never run again.
//   - `failed` — QA rejected it; the unit is NOT done, but nothing is
//     scheduled to run until the coordinator deliberately re-dispatches
//     (recordDispatchGuarded's redispatch-needs-reason gate, ledger.ts) —
//     until then this row is a rejected record, not queued work.
//   - `escalated` — explicitly waiting on the PE, not on a wave.
//   - `redirected` — a session already running under new live direction; it
//     is not something a fresh plan schedules, it is already underway.
//   - `removed` — the worktree is gone; there is nothing left to plan.
// Only `dispatched` survives this filter.
const PENDING_STATUSES: DispatchStatus[] = ["dispatched"];

// Consults the same authorities `propose` does (harness/registry.ts's
// hasAdapter/getAdapter, and harness/types.ts's isContainable) so a unit
// `dispatch/law.ts` would REJECT at batch time (`harness-not-containable`,
// an unknown/absent harness) never reaches a wave for the PE to approve.
// Containment only gates SESSION mode, exactly as in propose.ts and in the
// dispatch law itself — subagent mode is never routed through agentop.
function checkEligibility(envelope: Envelope, caps: Capabilities): { ok: true } | { ok: false; reason: string } {
  if (!hasAdapter(envelope.harness)) {
    return { ok: false, reason: "unknown harness — no adapter registered for this id" };
  }
  const cap = caps.harnesses.find((c) => c.id === envelope.harness);
  if (!cap || !cap.present) {
    return { ok: false, reason: "not present on this machine" };
  }
  if (envelope.mode === "session" && !isContainable(getAdapter(envelope.harness))) {
    return { ok: false, reason: "not containable — AIPe never starts a session it cannot govern" };
  }
  return { ok: true };
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
  const { caps, leadingLines, trailingNotes } = capsLoad;

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
  const planNotes: string[] = [];
  let anyEnvelopeRecorded = false;

  for (const d of ledger.dispatches) {
    const label = dispatchLabel(d);

    // Filter by status FIRST: a dispatch that no longer represents pending
    // work (merged/verified/delivered/failed/escalated/redirected/removed)
    // is never priced or gated, however complete its recorded envelope is —
    // that is what let three `merged` units get re-planned alongside one
    // `dispatched` unit and inflate cost-index 4x with a spurious gate.
    if (!PENDING_STATUSES.includes(d.status)) {
      planNotes.push(`unit ${label}: status "${d.status}" is not pending — excluded from this plan`);
      continue;
    }

    const envelope = recordedEnvelope(d);
    if (!envelope) {
      planNotes.push(`unit ${label}: no envelope recorded yet — excluded from this plan`);
      continue;
    }

    anyEnvelopeRecorded = true;

    // Consult the eligibility authority BEFORE a session envelope can reach a
    // wave — never reimplement dispatch/law.ts's containability/harness
    // checks here, only ask them.
    const eligibility = checkEligibility(envelope, caps);
    if (!eligibility.ok) {
      planNotes.push(`unit ${label}: harness ${envelope.harness} excluded — ${eligibility.reason}`);
      continue;
    }

    chosen.push({ fqid: label, envelope, model: d.model ?? null });
  }

  if (chosen.length === 0) {
    // If no unit has any recorded envelope, the coordinator must approve the
    // Orientation Spec first — that is what records envelopes.
    // If units have envelopes but all were excluded (ineligible harness, absent
    // harness, non-pending status, or any mix), list those reasons so the human
    // can tell "nobody chose yet" from "your choices cannot run, here is why".
    if (!anyEnvelopeRecorded) {
      return {
        code: 1,
        lines: [
          `ERROR journey: no unit in ${opts.journeyId} has a chosen envelope yet — approve the Orientation Spec first, then re-run \`aipe execution plan\``,
        ],
      };
    } else {
      return {
        code: 1,
        lines: [
          ...leadingLines,
          ...planNotes.map((note) => `NOTE ${note}`),
          `ERROR journey: no unit in ${opts.journeyId} is eligible for planning — see the exclusion reasons above`,
          ...trailingNotes,
          COST_INDEX_NOTE,
        ],
      };
    }
  }

  const policy = await readExecutionPolicy(opts.workspace);
  const { waves, notes } = groupIntoWaves(chosen, policy);

  const lines: string[] = [...leadingLines];
  for (const note of planNotes) lines.push(`NOTE ${note}`);

  // `Wave.mode` (waves.ts) says by construction whether this is the one
  // subagent wave or a session wave — never derived from `model === null`,
  // which is ALSO true for a session wave whose units have no model (that
  // ambiguity is exactly what let a QA session wave inherit a dev subagent
  // row's label upstream). `recordedEnvelope` above already guarantees every
  // session ChosenUnit that reaches `chosen` carries a real model, so
  // `w.model` is non-null on every session wave that can exist here; the
  // fallback below stays purely defensive.
  waves.forEach((w, i) => {
    const model =
      w.mode === "subagent"
        ? "(subagent — model binds per unit)"
        : (w.model ?? "(session wave with no model recorded — unreachable: recordedEnvelope excludes it)");
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
