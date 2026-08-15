// agentop binds --model per BATCH, not per session, and startBatch refuses a
// wave whose units disagree. So per-unit model choice in session mode costs
// extra waves. That trade is the PE's to make, so it is stated, never hidden.
//
// This module is also where the two WAVE-LEVEL policy fields are enforced.
// `maxCostIndexPerWave` and `gateAboveSessions` are loaded by policy.ts and
// consulted nowhere else; a policy field that is read and never enforced reads
// as a limit while permitting everything.
import { costIndex } from "./cost";
import type { Envelope, ExecutionPolicy } from "./types";

export interface ChosenUnit {
  fqid: string;
  envelope: Envelope;
  model: string | null;
}

export interface Wave {
  model: string | null; // null for subagent waves — the model binds per unit there
  units: string[];
  costIndex: number;
  gated: boolean;
  gateReasons: string[];
}

function buildWave(
  model: string | null,
  members: ChosenUnit[],
  policy: ExecutionPolicy,
  isSession: boolean,
): Wave {
  const cost = members.reduce((sum, m) => sum + costIndex(m.envelope), 0);
  const gateReasons: string[] = [];
  // Session count only gates SESSION waves: subagent concurrency is governed by
  // the dispatch law's MAX_CONCURRENT, not by this ceiling.
  if (isSession && members.length > policy.gateAboveSessions) {
    gateReasons.push(
      `${members.length} concurrent sessions exceeds the policy's gate of ${policy.gateAboveSessions} — needs your authorization`,
    );
  }
  if (cost > policy.maxCostIndexPerWave) {
    gateReasons.push(
      `cost-index ${cost} exceeds the policy ceiling of ${policy.maxCostIndexPerWave} — needs your authorization`,
    );
  }
  return {
    model,
    units: members.map((m) => m.fqid),
    costIndex: cost,
    gated: gateReasons.length > 0,
    gateReasons,
  };
}

export function groupIntoWaves(
  chosen: ChosenUnit[],
  policy: ExecutionPolicy,
): { waves: Wave[]; notes: string[] } {
  const notes: string[] = [];

  const sessionUnits = chosen.filter((c) => c.envelope.mode === "session");
  const subagentUnits = chosen.filter((c) => c.envelope.mode === "subagent");

  // Session units group by model, preserving first-seen order. The Map key is
  // `string | null` on purpose: a session unit with no model chosen yet still
  // needs a wave of its own rather than crashing or silently joining a named
  // model's wave.
  const byModel = new Map<string | null, ChosenUnit[]>();
  for (const c of sessionUnits) {
    const list = byModel.get(c.model) ?? [];
    list.push(c);
    byModel.set(c.model, list);
  }

  const waves: Wave[] = [];
  let capped = false;
  for (const [model, members] of byModel) {
    for (let i = 0; i < members.length; i += policy.maxSessionsPerWave) {
      waves.push(buildWave(model, members.slice(i, i + policy.maxSessionsPerWave), policy, true));
      if (i > 0) capped = true;
    }
  }

  // The two splitting causes are reported against different baselines so they
  // compose instead of contradicting or double-counting: the model-split note
  // states the cost of model diversity alone (1 -> byModel.size), and the cap
  // note states the additional cost of the session ceiling on top of that
  // (byModel.size -> waves.length), never re-stating the model-caused waves as
  // if the cap alone produced them.
  if (byModel.size > 1) {
    notes.push(
      `${byModel.size} waves instead of 1: agentop binds --model per batch, so units wanting different models cannot share a wave. Subagent mode binds the model per unit if one wave matters more than the finer choice.`,
    );
  }
  if (capped) {
    notes.push(
      `${waves.length} waves instead of ${byModel.size}: the policy caps a wave at ${policy.maxSessionsPerWave} concurrent sessions.`,
    );
  }

  // Subagent units share one wave: the model binds per unit, so nothing forces
  // a split, and their concurrency is governed by MAX_CONCURRENT, not this cap.
  if (subagentUnits.length > 0) {
    waves.push(buildWave(null, subagentUnits, policy, false));
  }

  return { waves, notes };
}
