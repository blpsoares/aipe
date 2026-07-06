#!/usr/bin/env bun
import { grantedTiers, readLedger, recordAuthorization } from "../journey/ledger";
import { resolveAdapter } from "../harness/registry";
import { checkVolume, type VolumeCheck } from "./check";
import { readPolicy } from "./policy";
import { gateFor, resolveModel, type ResolvedModel } from "./resolve";
import { isTier, type DispatchGate } from "./types";

function getFlag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const v = args[i + 1];
  if (v === undefined || v.startsWith("--")) return undefined;
  return v;
}

export function renderResolve(r: ResolvedModel, gate: DispatchGate): string[] {
  return [
    `TIER=${r.tier}`,
    `MODEL=${r.model ?? "(harness default)"}${r.label ? ` (${r.label})` : ""}`,
    `GATE=${gate}`,
  ];
}

export function renderCheck(c: VolumeCheck): string[] {
  return [`REASONING=${c.reasoningDispatches}/${c.threshold}`, `STATE=${c.status}`];
}

async function resolveCmd(args: string[]): Promise<number> {
  const workspace = getFlag(args, "--workspace") ?? process.cwd();
  const tier = getFlag(args, "--tier");
  if (!isTier(tier)) {
    console.log("ERROR tier: --tier must be one of fast|standard|reasoning|frontier");
    return 1;
  }
  const [policy, adapter] = [await readPolicy(workspace), await resolveAdapter(workspace)];
  const resolved = resolveModel(policy, adapter, tier);

  // With --journey, the gate accounts for any grant already recorded there.
  const journey = getFlag(args, "--journey");
  const granted = journey ? grantedTiers(await readLedger(workspace, journey)) : new Set<string>();
  const gate = gateFor(policy, tier, granted);

  for (const line of renderResolve(resolved, gate)) console.log(line);
  return gate === "ok" ? 0 : 1;
}

async function checkCmd(args: string[]): Promise<number> {
  const workspace = getFlag(args, "--workspace") ?? process.cwd();
  const journey = getFlag(args, "--journey");
  if (!journey) {
    console.log("ERROR journey: --journey <id> is required");
    return 1;
  }
  const policy = await readPolicy(workspace);
  const result = checkVolume(policy, await readLedger(workspace, journey));
  for (const line of renderCheck(result)) console.log(line);
  return result.status === "ok" ? 0 : 1;
}

async function authorizeCmd(args: string[]): Promise<number> {
  const workspace = getFlag(args, "--workspace") ?? process.cwd();
  const journey = getFlag(args, "--journey");
  const tier = getFlag(args, "--tier");
  const by = getFlag(args, "--by") ?? "PE";
  if (!journey) {
    console.log("ERROR journey: --journey <id> is required");
    return 1;
  }
  if (!isTier(tier)) {
    console.log("ERROR tier: --tier must be one of fast|standard|reasoning|frontier");
    return 1;
  }
  await recordAuthorization(workspace, journey, { tier, grantedBy: by });
  console.log(`AUTHORIZED ${tier} journey=${journey} by=${by}`);
  return 0;
}

export async function run(args: string[]): Promise<number> {
  const [action, ...rest] = args;
  if (action === "resolve") return resolveCmd(rest);
  if (action === "check") return checkCmd(rest);
  if (action === "authorize") return authorizeCmd(rest);
  console.log("ERROR action: use `aipe model resolve|check|authorize`");
  return 1;
}

if (import.meta.main) {
  run(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((err) => {
      console.log(`ERROR ${err}`);
      process.exit(1);
    });
}
