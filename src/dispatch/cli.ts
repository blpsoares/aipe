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
import { claimLock, claimUnit, reconcileLockPaths, releaseLock, type Lock } from "./lock";
import { detectTouchedPaths } from "./detect";
import { planOverlapResolution } from "./resolution";
import { roleWritesToRepo } from "./roles";
import { recordAuthorization } from "../journey/ledger";
import { readPersonas } from "./personas";
import { isValidTaskId } from "../worktree/naming";
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

// A flag that may repeat: `--path a --path b`. Also accepts a single
// comma-separated value (`--path a,b`) for ergonomics. Returns every value in
// order; empty when the flag is absent.
function getFlagAll(args: string[], name: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] !== name) continue;
    const value = args[i + 1];
    if (value === undefined || value.startsWith("--")) continue;
    for (const part of value.split(",")) {
      const t = part.trim();
      if (t) out.push(t);
    }
  }
  return out;
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
    // `paths` (optional): a JSON array of strings. A wrong-typed field is a
    // REJECT, never a silent drop — a coordinator's mistyped paths must not fall
    // back to a WHOLE-unit claim it did not intend.
    if (r.paths !== undefined && (!Array.isArray(r.paths) || r.paths.some((p) => typeof p !== "string"))) return null;
    batch.push({
      repo: r.repo,
      specialist: r.specialist,
      ...(typeof r.package === "string" ? { package: r.package } : {}),
      ...(typeof r.task === "string" ? { task: r.task } : {}),
      ...(Array.isArray(r.paths) ? { paths: r.paths as string[] } : {}),
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

// Reconciliation must never be silent (j-20260829-5q): removing another claim's
// lock used to pass as a routine one-liner, and that is exactly how a LIVE lock
// got stomped unnoticed (twice in one day). Every torn-down lock is named on its
// own WARN line, with what to do if its owner was in fact still working.
function announceReconciled(locks?: Lock[]): void {
  if (!locks || locks.length === 0) return;
  for (const l of locks) {
    const paths = l.paths && l.paths.length ? l.paths.join(",") : "the whole unit";
    const who = `${l.journey}/${l.specialist}${l.task ? ` task=${l.task}` : ""} (pid ${l.pid})`;
    console.log(`WARN reconciled — removed the lock of ${who} over ${paths}, held since ${l.timestamp}.`);
  }
  console.log(
    "WARN if any of those tasks is still live, its work is now UNPROTECTED — have it re-run its claim, " +
      "or resolve with `aipe dispatch resolve-overlap`. A lock is only reconciled when its owner is not " +
      "provably alive; an unverifiable owner (pid 0) is kept, not removed.",
  );
}

async function claimCommand(args: string[]): Promise<number> {
  const workspace = getFlag(args, "--workspace") ?? process.cwd();
  const repo = args[0] && !args[0].startsWith("--") ? args[0] : undefined;
  const journey = getFlag(args, "--journey");
  const specialist = getFlag(args, "--specialist");
  if (!repo || !journey || !specialist) {
    console.log("ERROR args: usage: dispatch claim <repo> --journey <id> --specialist <name> [--branch b] [--package p] [--task t] [--path glob ...] [--force]");
    return 1;
  }
  const branch = getFlag(args, "--branch");
  const pkg = getFlag(args, "--package");
  const task = getFlag(args, "--task");
  if (task !== undefined && !isValidTaskId(task)) {
    console.log(`ERROR task: --task must be slug-safe (lowercase alnum + hyphen), got "${task}"`);
    return 1;
  }
  const declaredPaths = getFlagAll(args, "--path");
  const force = args.includes("--force");
  // Role is resolved from the roster (the single source of truth), never a name
  // list; unknown/absent role ⇒ treated as WRITING (safe default). Two regimes:
  //   • WRITING role → PATH-AWARE claim: it declares the paths it will touch
  //     (empty ⇒ the WHOLE unit), keeps its --task as identity so disjoint
  //     sub-tasks get distinct lock files, and is adjudicated by unit-wide path
  //     overlap. Two devs on the same unit still serialize when their paths
  //     overlap (WHOLE overlaps everything) — the D3 serialization is preserved,
  //     just made per-path.
  //   • NON-WRITING role → LEGACY task-split lock, unchanged: --task splits the
  //     lock (a QA writes nothing, so N tasks never collide) and no path scan runs.
  const role = (await readPersonas(workspace)).find(
    (p) => p.repo === repo && p.name.toLowerCase() === specialist.toLowerCase(),
  )?.role;
  const writes = roleWritesToRepo(role);
  if (task && !writes && declaredPaths.length > 0) {
    console.log(`NOTE --path is ignored for non-writing role "${role ?? "unknown"}" (a reviewer touches no files); claiming the task-split lock.`);
  }
  // The holder's long-lived session pid, for crash-based reconciliation. Passing
  // a REAL --pid is what earns automatic crash recovery: a tracked pid that later
  // dies is a provable orphan, safely reconciled. Absent ⇒ 0 (the ephemeral CLI
  // pid would die the instant this command returns, so it is worse than nothing).
  // A pid-0 lock is now treated as ALIVE, not a silent orphan (j-20260829-5q):
  // the coordinator has no reachable session pid at the write point, and the old
  // "0 ⇒ reconcilable" reading let a real claim stomp a live lock. The tradeoff is
  // deliberate — a pid-0 holder that truly crashed is recovered by `dispatch
  // release` or an authorized `--force`, not a silent takeover.
  const pidFlag = getFlag(args, "--pid");
  const pid = pidFlag && Number.isInteger(Number(pidFlag)) ? Number(pidFlag) : 0;
  const result = await claimLock(workspace, {
    repo,
    ...(pkg ? { package: pkg } : {}),
    ...(task ? { task } : {}),
    journey,
    specialist,
    ...(branch ? { branch } : {}),
    // Path-aware regime only for writing roles; a non-writing claim omits `paths`
    // (undefined) so it takes the legacy single-file branch.
    ...(writes ? { paths: declaredPaths } : {}),
    force,
    pid,
  });
  const taskSuffix = task ? ` task=${task}` : "";
  if (result.ok) {
    const unit = claimUnit(repo, pkg);
    const prev = result.previous;
    const prevStr = prev ? `${prev.journey}/${prev.specialist}(pid ${prev.pid})` : "none";
    if (result.forced) {
      console.log(`FORCED ${unit}${taskSuffix} journey=${journey} over prev=${prevStr} (authorized override)`);
      announceReconciled(result.reconciledLocks);
    } else if (result.reconciled) {
      console.log(`RECONCILED ${unit}${taskSuffix} journey=${journey} prev=${prevStr}`);
      announceReconciled(result.reconciledLocks);
    } else {
      console.log(`CLAIMED ${unit}${taskSuffix} journey=${journey} specialist=${specialist}`);
    }
    return 0;
  }
  const h = result.holder;
  const unit = claimUnit(repo, pkg);
  // Name WHICH paths collided so a coordinator understands the serialization — an
  // overlap collision spells out the pairs; a whole-unit collision says so.
  const overlaps = result.overlaps;
  const pathStr = overlaps && overlaps.length
    ? ` on paths ${overlaps.map(([a, b]) => (a === b ? a : `${a}⋂${b}`)).join(", ")}`
    : "";
  if (result.reason === "unauthorized-force") {
    console.log(`UNAUTHORIZED-FORCE ${unit}${taskSuffix} held by journey=${h.journey} specialist=${h.specialist} pid=${h.pid} since=${h.timestamp}${pathStr}`);
    console.log(`WARN --force over an active lock needs a recorded PE authorization for ${unit}.`);
    console.log(`     Record it (after the PE says yes): aipe dispatch authorize-force ${repo}${pkg ? ` --package ${pkg}` : ""} --journey ${journey} --by PE --workspace ${workspace}`);
    return 3;
  }
  console.log(`COLLISION ${unit}${taskSuffix} held by journey=${h.journey} specialist=${h.specialist} pid=${h.pid} since=${h.timestamp}${pathStr}`);
  console.log("WARN not blocking; the overlapping task must wait, rebase onto the holder, and resolve; or with the PE's approval recorded, re-run with --force. See `aipe dispatch resolve-overlap`.");
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
    console.log("ERROR args: usage: dispatch release <repo> [--journey <id>] [--package p] [--task t] [--specialist name] [--force]");
    return 1;
  }
  const journey = getFlag(args, "--journey");
  const pkg = getFlag(args, "--package");
  const task = getFlag(args, "--task");
  const specialist = getFlag(args, "--specialist");
  const force = args.includes("--force");
  // Release the SAME lock the claim took: the task splits the lock only for a
  // non-writing role. When --specialist is given, resolve the role and honor the
  // gate (a writing role's --task is ignored, matching claim); without it, trust
  // the --task as passed (the operate flow always pairs --task with --specialist).
  let releaseTask = task;
  if (task && specialist) {
    const role = (await readPersonas(workspace)).find(
      (p) => p.repo === repo && p.name.toLowerCase() === specialist.toLowerCase(),
    )?.role;
    releaseTask = roleWritesToRepo(role) ? undefined : task;
  }
  const result = await releaseLock(workspace, repo, {
    ...(journey ? { journey } : {}),
    ...(pkg ? { package: pkg } : {}),
    ...(releaseTask ? { task: releaseTask } : {}),
    force,
  });
  const unit = `${pkg ? `${repo}/${pkg}` : repo}${releaseTask ? `#${releaseTask}` : ""}`;
  if (result.ok) {
    console.log(result.released ? `RELEASED ${unit}` : `NOOP ${unit} (no lock)`);
    return 0;
  }
  console.log(`SKIP foreign ${unit} held by journey=${result.holder.journey} (use --force)`);
  return 2;
}

// `aipe dispatch reconcile <repo> --journey <id> --worktree <dir> [--package p]
// [--task t] [--base ref]` — rewrite the live lock's paths to what the branch
// ACTUALLY touched (read from git) and re-check the unit for overlap on the REAL
// set. This is the honest-declaration guard: a declaration made at dispatch time
// ages, so the lock is reconciled against verifiable git state, not trusted.
async function reconcileCommand(args: string[]): Promise<number> {
  const workspace = getFlag(args, "--workspace") ?? process.cwd();
  const repo = args[0] && !args[0].startsWith("--") ? args[0] : undefined;
  const journey = getFlag(args, "--journey");
  const worktree = getFlag(args, "--worktree");
  if (!repo || !journey || !worktree) {
    console.log("ERROR args: usage: dispatch reconcile <repo> --journey <id> --worktree <dir> [--package p] [--task t] [--base ref]");
    return 1;
  }
  const pkg = getFlag(args, "--package");
  const task = getFlag(args, "--task");
  const base = getFlag(args, "--base");
  const actual = await detectTouchedPaths(worktree, { ...(base ? { base } : {}) });
  const result = await reconcileLockPaths(workspace, {
    repo,
    ...(pkg ? { package: pkg } : {}),
    ...(task ? { task } : {}),
    journey,
    actual,
  });
  const unit = claimUnit(repo, pkg);
  const taskSuffix = task ? ` task=${task}` : "";
  if (!result.ok) {
    if (result.reason === "no-lock") {
      console.log(`NOTE no lock for ${unit}${taskSuffix} to reconcile (claim it first)`);
      return 0;
    }
    console.log(`SKIP foreign ${unit}${taskSuffix} held by journey=${result.holder.journey} (reconcile is owner-only)`);
    return 2;
  }
  const pathsStr = result.paths.length ? result.paths.join(", ") : "(whole unit)";
  const driftStr = result.drift.length ? result.drift.join(", ") : "none";
  console.log(`RECONCILED ${unit}${taskSuffix} paths=${pathsStr} drift=${driftStr}`);
  if (result.overlaps.length > 0) {
    for (const o of result.overlaps) {
      const on = o.pairs.map(([a, b]) => (a === b ? a : `${a}⋂${b}`)).join(", ");
      console.log(`DRIFT-COLLISION ${unit}${taskSuffix} now overlaps journey=${o.holder.journey} specialist=${o.holder.specialist} on ${on}`);
    }
    console.log("WARN detection found the branch touching a path another live claim holds. Run the managed exception: aipe dispatch resolve-overlap.");
    return 2;
  }
  return 0;
}

// `aipe dispatch resolve-overlap <repo> --branch <mine> --onto <holder> [--path
// glob ...]` — print the deterministic managed-exception plan (wait → rebase →
// resolve → review-over-merge). Prose lives in the skills; this is the exact,
// ordered recovery a coordinator can follow step by step.
function resolveOverlapCommand(args: string[]): number {
  const repo = args[0] && !args[0].startsWith("--") ? args[0] : undefined;
  const waiterBranch = getFlag(args, "--branch");
  const holderBranch = getFlag(args, "--onto");
  if (!repo || !waiterBranch || !holderBranch) {
    console.log("ERROR args: usage: dispatch resolve-overlap <repo> --branch <waiter> --onto <holder> [--path glob ...]");
    return 1;
  }
  const paths = getFlagAll(args, "--path");
  const plan = planOverlapResolution({ waiterBranch, holderBranch, paths });
  console.log(`PLAN overlap ${repo}: ${plan.waiter} waits and rebases onto ${plan.onto}`);
  plan.steps.forEach((s, i) => console.log(`  ${i + 1}. ${s.action}: ${s.detail}`));
  return 0;
}

export async function run(args: string[]): Promise<number> {
  const [sub, ...rest] = args;
  if (sub === "validate") return validateCommand(rest);
  if (sub === "claim") return claimCommand(rest);
  if (sub === "release") return releaseCommand(rest);
  if (sub === "reconcile") return reconcileCommand(rest);
  if (sub === "resolve-overlap") return resolveOverlapCommand(rest);
  if (sub === "authorize-force") return authorizeForceCommand(rest);
  console.log(`ERROR command: unknown dispatch command "${sub ?? ""}"`);
  console.log("Usage: aipe dispatch <validate|claim|release|reconcile|resolve-overlap|authorize-force> [options]");
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
