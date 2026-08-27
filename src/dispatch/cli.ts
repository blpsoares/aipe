#!/usr/bin/env bun
// `aipe dispatch validate --input <batch.json>` — adjudicates the
// parallel-dispatch law for one proposed batch. Prints OK or one REJECT line
// per problem; the coordinator only provisions worktrees for a batch that
// validates. Deterministic; no LLM.
import { readFile } from "node:fs/promises";
import { readBrain } from "../make-workspace/read";
import { readGraph } from "../relationship/read-graph";
import { readLedger } from "../journey/ledger";
import { packageFqid } from "../context-brain/packages";
import { checkDependenciesLanded, validateBatch } from "./law";
import { claimLock, claimUnit, releaseLock } from "./lock";
import { recordAuthorization } from "../journey/ledger";
import { readPersonas } from "./personas";
import { isContainable } from "../harness/types";
import { getAdapter } from "../harness/registry";
import { probe, realRunner } from "../session/runner";
import type { AgentopRunner } from "../session/types";
import type { Batch, DispatchEntry, SessionContext } from "./types";

function getFlag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const value = args[i + 1];
  if (value === undefined || value.startsWith("--")) return undefined;
  return value;
}

export function parseBatch(value: unknown): Batch | null {
  if (!Array.isArray(value)) return null;
  const batch: DispatchEntry[] = [];
  for (const e of value) {
    if (typeof e !== "object" || e === null) return null;
    const r = e as Record<string, unknown>;
    if (typeof r.repo !== "string" || typeof r.specialist !== "string") return null;
    // An unrecognised mode/intensity is a REJECT, never a silent downgrade to
    // the default: a typo'd "session" must not quietly run as a subagent.
    if (r.mode !== undefined && r.mode !== "subagent" && r.mode !== "session") return null;
    if (r.intensity !== undefined && r.intensity !== "normal" && r.intensity !== "ultracode") return null;
    batch.push({
      repo: r.repo,
      specialist: r.specialist,
      ...(typeof r.package === "string" ? { package: r.package } : {}),
      ...(typeof r.tier === "string" ? { tier: r.tier } : {}),
      ...(r.mode !== undefined ? { mode: r.mode as "subagent" | "session" } : {}),
      ...(r.intensity !== undefined ? { intensity: r.intensity as "normal" | "ultracode" } : {}),
      ...(typeof r.harness === "string" ? { harness: r.harness } : {}),
    });
  }
  return batch;
}

// The universe of registered adapter ids to PROBE for session eligibility —
// not the eligibility answer itself. `buildSessionContext` below filters this
// through `isContainable`, so an entry here whose adapter isn't containable
// (e.g. "codex" and "copilot" — see codexAdapter/copilotAdapter's
// containmentHook()'s null, and "generic", which never had a containment
// hook) is correctly dropped from `containableHarnesses` rather than
// misreported. Leaving them listed here is intentional: it's what keeps this
// list "every adapter AIPe knows about," letting the containability filter —
// not a second hand-maintained list — be the single source of truth for
// which ones are actually session-dispatchable.
const KNOWN_HARNESSES = ["claude-code", "codex", "gemini", "copilot", "generic"];

export async function buildSessionContext(
  runner: AgentopRunner = realRunner,
): Promise<SessionContext> {
  const probed = await probe(runner);
  return {
    agentopOk: probed.ok,
    containableHarnesses: KNOWN_HARNESSES.filter((id) => isContainable(getAdapter(id))),
  };
}

async function validateCommand(args: string[]): Promise<number> {
  const workspace = getFlag(args, "--workspace") ?? process.cwd();
  const inputPath = getFlag(args, "--input");
  if (!inputPath) {
    console.log("ERROR input: --input <batch.json> is required");
    return 1;
  }

  let batch: Batch | null;
  try {
    batch = parseBatch(JSON.parse(await readFile(inputPath, "utf8")));
  } catch {
    console.log(`ERROR input: could not read/parse ${inputPath}`);
    return 1;
  }
  if (!batch) {
    console.log("ERROR input: expected a JSON array of {repo, specialist}");
    return 1;
  }

  const brainResult = await readBrain(workspace);
  if (!brainResult.ok) {
    console.log(`ERROR brain: ${brainResult.error}`);
    return 1;
  }
  const roster = await readPersonas(workspace);

  // Probing agentop spawns a subprocess — only pay for it when the batch
  // actually contains a session-mode entry. A pure subagent batch never
  // depends on agentop being present.
  const sessionCtx = batch.some((e) => e.mode === "session") ? await buildSessionContext() : undefined;
  const verdict = validateBatch(
    batch,
    brainResult.brain.repos.map((r) => r.name),
    roster,
    sessionCtx,
  );
  const rejects = verdict.ok ? [] : [...verdict.rejects];

  // Cross-repo landing gate (opt-in via --journey, since it needs the ledger to
  // know what has landed). Skipped for a legacy/graph-less workspace.
  const journey = getFlag(args, "--journey");
  if (journey) {
    const [graph, ledger] = await Promise.all([readGraph(workspace), readLedger(workspace, journey)]);
    if (graph.edges.length > 0) {
      const landed = new Set(
        (ledger?.dispatches ?? [])
          .filter((d) => d.status === "verified" || d.status === "merged")
          .map((d) => packageFqid(d.repo, d.package)),
      );
      // The units of THIS journey's demand: every unit already on the ledger,
      // plus every unit in the batch being validated. NOT every graph node —
      // the graph is context-wide and includes repos this demand merely
      // consumes (e.g. the agentop binary from agentistics), which are not
      // units of the journey and can never land here. Gating on graph-node
      // membership blocked any such consumer forever (D5).
      const demandUnits = new Set<string>([
        ...(ledger?.dispatches ?? []).map((d) => packageFqid(d.repo, d.package)),
        ...batch.map((e) => packageFqid(e.repo, e.package)),
      ]);
      rejects.push(...checkDependenciesLanded(batch, { edges: graph.edges, landed, demandUnits }));
    }
  }

  if (rejects.length === 0) {
    console.log(`OK batch=${batch.length}`);
    return 0;
  }
  for (const reject of rejects) console.log(`REJECT ${reject}`);
  return 1;
}

// `aipe dispatch claim <repo> --journey <id> --specialist <name>` — atomically
// acquire the per-repo lock so N parallel coordinator sessions can't provision
// worktrees for one repo at once. A collision (an ACTIVE lock held by another
// session) WARNS and exits non-zero — it never hard-blocks; --force overrides.
async function claimCommand(args: string[]): Promise<number> {
  const workspace = getFlag(args, "--workspace") ?? process.cwd();
  const repo = args[0] && !args[0].startsWith("--") ? args[0] : undefined;
  const journey = getFlag(args, "--journey");
  const specialist = getFlag(args, "--specialist");
  if (!repo || !journey || !specialist) {
    console.log("ERROR args: usage: dispatch claim <repo> --journey <id> --specialist <name> [--branch b] [--package p] [--force]");
    return 1;
  }
  const branch = getFlag(args, "--branch");
  const pkg = getFlag(args, "--package");
  const force = args.includes("--force");
  // The coordinator's long-lived session pid, for crash-based reconciliation.
  // Absent ⇒ 0 (the ephemeral CLI pid is meaningless): the lock's liveness is
  // then governed purely by the ledger's "dispatched" status.
  const pidFlag = getFlag(args, "--pid");
  const pid = pidFlag && Number.isInteger(Number(pidFlag)) ? Number(pidFlag) : 0;
  const result = await claimLock(workspace, {
    repo,
    ...(pkg ? { package: pkg } : {}),
    journey,
    specialist,
    ...(branch ? { branch } : {}),
    force,
    pid,
  });
  if (result.ok) {
    const unit = claimUnit(repo, pkg);
    const prev = result.previous;
    const prevStr = prev ? `${prev.journey}/${prev.specialist}(pid ${prev.pid})` : "none";
    if (result.forced) {
      console.log(`FORCED ${unit} journey=${journey} over prev=${prevStr} (authorized override)`);
    } else if (result.reconciled) {
      console.log(`RECONCILED ${unit} journey=${journey} prev=${prevStr}`);
    } else {
      console.log(`CLAIMED ${unit} journey=${journey} specialist=${specialist}`);
    }
    return 0;
  }
  const h = result.holder;
  const unit = claimUnit(repo, pkg);
  if (result.reason === "unauthorized-force") {
    console.log(`UNAUTHORIZED-FORCE ${unit} held by journey=${h.journey} specialist=${h.specialist} pid=${h.pid} since=${h.timestamp}`);
    console.log(`WARN --force over an active lock needs a recorded PE authorization for ${unit}.`);
    console.log(`     Record it (after the PE says yes): aipe dispatch authorize-force ${repo}${pkg ? ` --package ${pkg}` : ""} --journey ${journey} --by PE --workspace ${workspace}`);
    return 3;
  }
  console.log(`COLLISION ${unit} held by journey=${h.journey} specialist=${h.specialist} pid=${h.pid} since=${h.timestamp}`);
  console.log("WARN not blocking; with the PE's approval recorded, re-run with --force to override the active lock.");
  return 2;
}

async function authorizeForceCommand(args: string[]): Promise<number> {
  const workspace = getFlag(args, "--workspace") ?? process.cwd();
  const repo = args[0] && !args[0].startsWith("--") ? args[0] : undefined;
  const journey = getFlag(args, "--journey");
  if (!repo || !journey) {
    console.log("ERROR args: usage: dispatch authorize-force <repo> --journey <id> [--package p] [--by <who>]");
    return 1;
  }
  const pkg = getFlag(args, "--package");
  const by = getFlag(args, "--by") ?? "PE";
  const unit = claimUnit(repo, pkg);
  await recordAuthorization(workspace, journey, { grantedBy: by, forceClaim: unit });
  console.log(`AUTHORIZED force-claim ${unit} journey=${journey} by=${by}`);
  return 0;
}

// `aipe dispatch release <repo> [--journey <id>]` — release the lock at a marker
// (delivered/escalated/merged). Idempotent; refuses a foreign lock unless --force.
async function releaseCommand(args: string[]): Promise<number> {
  const workspace = getFlag(args, "--workspace") ?? process.cwd();
  const repo = args[0] && !args[0].startsWith("--") ? args[0] : undefined;
  if (!repo) {
    console.log("ERROR args: usage: dispatch release <repo> [--journey <id>] [--package p] [--force]");
    return 1;
  }
  const journey = getFlag(args, "--journey");
  const pkg = getFlag(args, "--package");
  const force = args.includes("--force");
  const result = await releaseLock(workspace, repo, {
    ...(journey ? { journey } : {}),
    ...(pkg ? { package: pkg } : {}),
    force,
  });
  const unit = pkg ? `${repo}/${pkg}` : repo;
  if (result.ok) {
    console.log(result.released ? `RELEASED ${unit}` : `NOOP ${unit} (no lock)`);
    return 0;
  }
  console.log(`SKIP foreign ${unit} held by journey=${result.holder.journey} (use --force)`);
  return 2;
}

export async function run(args: string[]): Promise<number> {
  const [sub, ...rest] = args;
  if (sub === "validate") return validateCommand(rest);
  if (sub === "claim") return claimCommand(rest);
  if (sub === "release") return releaseCommand(rest);
  if (sub === "authorize-force") return authorizeForceCommand(rest);
  console.log(`ERROR command: unknown dispatch command "${sub ?? ""}"`);
  console.log("Usage: aipe dispatch <validate|claim|release|authorize-force> [options]");
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
