#!/usr/bin/env bun
// `aipe journey <start|record|show>` — the durable journey ledger under
// .aipe/journeys/<id>.yaml. Audit bookkeeping for a work session's dispatches
// (repo, specialist, branch, worktree, PR, status); it is NOT the hiring brief.
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { readGraph } from "../relationship/read-graph";
import { ghPrChecks, type PrChecksResolver } from "./checks";
import { recordDispatchGuarded, readLedger, setJourneySpec, startJourney } from "./ledger";
import { ghPrState, reconcileAll, reconcileJourney } from "./reconcile";
import { normalizeRepo, normalizeSpecialist } from "./normalize";
import { dedupeAll } from "./dedupe-run";
import { readPersonas } from "../hire-specialists/read-personas";
import { closeUnitSessions, SESSION_CLOSING_STATUSES } from "./session-close";
import { renderOrientationTemplate, validateOrientation } from "./spec";
import { classifyRecordTarget, findPhantomLedgers } from "./record-target";
import { isValidTaskId } from "../worktree/naming";
import { DISPATCH_STATUSES } from "./types";
import type { DispatchEvidence, DispatchStatus, JourneyDispatch, JourneyLedger } from "./types";
import { auditPrChecks, auditReleaseState, verifyJourney } from "./verify";
import { realReleaseResolver } from "../release/git";
import { resolveReleaseStates } from "../release/resolve";
import type { ReleaseResolver, RepoReleaseState } from "../release/types";
import { readBrain } from "../make-workspace/read";
import { realRunner } from "../session/runner";
import type { AgentopRunner } from "../session/types";
import { logStatusDelta } from "../status/delta";

// Injection seam so the CLI stays testable offline: the record gate's CI
// resolver and the session-close runner default to the real gh/agentop, and
// tests pass fakes. Mirrors how reconcile injects its PR-state fetcher.
export interface JourneyDeps {
  resolveChecks?: PrChecksResolver;
  sessionRunner?: AgentopRunner;
  // Local-git release-state resolver (j-20260830-zd); defaults to real git, tests
  // inject a fake so `show`/`verify` stay offline.
  resolveRelease?: ReleaseResolver;
}

// Resolve the release state for the repos a ledger touches, from local git. A
// missing/unreadable brain simply yields an empty map — `show` stays offline-safe
// and `verify` abstains rather than inventing a verdict.
async function releaseStatesForLedger(
  workspace: string,
  ledger: JourneyLedger,
  resolver: ReleaseResolver,
): Promise<Map<string, RepoReleaseState>> {
  const brain = await readBrain(workspace);
  if (!brain.ok) return new Map();
  const inLedger = new Set(ledger.dispatches.map((d) => d.repo));
  const repos = brain.brain.repos.filter((r) => inLedger.has(r.name));
  if (repos.length === 0) return new Map();
  return resolveReleaseStates(workspace, repos, resolver);
}

type SessionMode = NonNullable<JourneyDispatch["mode"]>;
type Intensity = NonNullable<JourneyDispatch["intensity"]>;
const SESSION_MODES: SessionMode[] = ["subagent", "session"];
const INTENSITIES: Intensity[] = ["normal", "ultracode"];

function getFlag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const value = args[i + 1];
  if (value === undefined || value.startsWith("--")) return undefined;
  return value;
}

// Every occurrence of a repeatable flag (e.g. --evidence-cmd "a" --evidence-cmd "b").
function getAllFlags(args: string[], name: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === name) {
      const v = args[i + 1];
      if (v !== undefined && !v.startsWith("--")) out.push(v);
    }
  }
  return out;
}

// The one place a timestamp is read; overridable with --id for reproducibility.
function mintId(): string {
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  const rand = Math.random().toString(36).slice(2, 4).padEnd(2, "0");
  return `j-${ymd}-${rand}`;
}

async function startCommand(args: string[]): Promise<number> {
  const workspace = getFlag(args, "--workspace") ?? process.cwd();
  const id = getFlag(args, "--id") ?? mintId();
  const started = await startJourney(workspace, id);
  console.log(`JOURNEY ${started}`);
  return 0;
}

async function recordCommand(args: string[], deps: JourneyDeps = {}): Promise<number> {
  // D8 — a record aimed at a worktree must never create a phantom ledger there.
  // classifyRecordTarget resolves the real workspace (or refuses); a bare dir is
  // left untouched so first-run and test fixtures keep working.
  const target = await classifyRecordTarget(getFlag(args, "--workspace") ?? process.cwd());
  if (!target.ok) {
    console.log(`REJECT worktree-workspace — ${target.message}`);
    return 1;
  }
  const workspace = target.workspace;
  if (target.note) console.log(`NOTE ${target.note}`);
  const id = getFlag(args, "--journey");
  const repoFlag = getFlag(args, "--repo");
  const specialistFlag = getFlag(args, "--specialist");
  const branch = getFlag(args, "--branch");
  const worktree = getFlag(args, "--worktree");
  if (!id || !repoFlag || !specialistFlag || !branch || !worktree) {
    console.log("ERROR args: --journey, --repo, --specialist, --branch and --worktree are required");
    return 1;
  }
  // Write-time identity normalization (j-20260829-dp, item 5): resolve the repo
  // to its bare name and the specialist to the roster's canonical casing, so the
  // coordinator's `Jane`/bare-repo and the specialist's self-registered
  // `jane`/`blpsoares/…` land on ONE ledger key instead of two. Fixed in the DATA
  // at write, never painted over in the view.
  const repo = normalizeRepo(repoFlag);
  const specialist = normalizeSpecialist(specialistFlag, await readPersonas(workspace));
  if (repo !== repoFlag || specialist !== specialistFlag) {
    console.log(`NOTE record: normalized identity ${repoFlag}/${specialistFlag} → ${repo}/${specialist} (jane/Jane dedupe).`);
  }
  const pr = getFlag(args, "--pr");
  const pkg = getFlag(args, "--package");
  const task = getFlag(args, "--task");
  if (task !== undefined && !isValidTaskId(task)) {
    console.log(`ERROR task: --task must be slug-safe (lowercase alnum + hyphen), got "${task}"`);
    return 1;
  }
  const tier = getFlag(args, "--tier");
  const model = getFlag(args, "--model");
  const reason = getFlag(args, "--reason");

  // Session-mode dispatch metadata (optional; absent ⇒ absent on the ledger,
  // never present-and-undefined — legacy ledgers and subagent dispatches must
  // round-trip untouched).
  const modeFlag = getFlag(args, "--mode");
  if (modeFlag !== undefined && !SESSION_MODES.includes(modeFlag as SessionMode)) {
    console.log(`ERROR mode: --mode must be one of ${SESSION_MODES.join("|")}`);
    return 1;
  }
  const mode = modeFlag as SessionMode | undefined;

  const intensityFlag = getFlag(args, "--intensity");
  if (intensityFlag !== undefined && !INTENSITIES.includes(intensityFlag as Intensity)) {
    console.log(`ERROR intensity: --intensity must be one of ${INTENSITIES.join("|")}`);
    return 1;
  }
  const intensity = intensityFlag as Intensity | undefined;

  const harness = getFlag(args, "--harness");
  const sessionId = getFlag(args, "--session-id");
  const statusFlag = getFlag(args, "--status");
  const status: DispatchStatus = DISPATCH_STATUSES.includes(statusFlag as DispatchStatus)
    ? (statusFlag as DispatchStatus)
    : "dispatched";

  // Evidence (verify-before-done): --evidence-summary + one-or-more --evidence-cmd,
  // optional --evidence-by (defaults from the status) and --evidence-artifact.
  const evSummary = getFlag(args, "--evidence-summary");
  const evCmds = getAllFlags(args, "--evidence-cmd");
  const evArtifact = getFlag(args, "--evidence-artifact");
  const evByFlag = getFlag(args, "--evidence-by");
  const evidence: DispatchEvidence | undefined =
    evSummary || evCmds.length > 0
      ? {
          by: evByFlag === "qa" || evByFlag === "dev" ? evByFlag : status === "verified" ? "qa" : "dev",
          commands: evCmds,
          summary: evSummary ?? "",
          ...(evArtifact ? { artifact: evArtifact } : {}),
        }
      : undefined;

  // The CI gate resolves the PR's checks over the forge; wire the real gh here
  // (tests inject a fake). `--ci-none` is the explicit, recorded bypass for a
  // repo with no checks configured — it only upgrades a resolved "none" (see
  // recordDispatchGuarded), never masks a red/pending/unresolvable verdict.
  const ciNone = args.includes("--ci-none");
  const resolveChecks = deps.resolveChecks ?? ghPrChecks;

  const result = await recordDispatchGuarded(
    workspace,
    id,
    {
      repo,
      ...(pkg ? { package: pkg } : {}),
      ...(task ? { task } : {}),
      specialist,
      branch,
      worktree,
      ...(pr ? { pr } : {}),
      ...(tier ? { tier } : {}),
      ...(model ? { model } : {}),
      ...(mode ? { mode } : {}),
      ...(intensity ? { intensity } : {}),
      ...(harness ? { harness } : {}),
      ...(sessionId ? { sessionId } : {}),
      ...(evidence ? { evidence } : {}),
      status,
    },
    { ...(reason ? { reason } : {}), resolveChecks, ciNone },
  );

  if (!result.ok) {
    console.log(`REJECT ${result.code} ${repo}${pkg ? `/${pkg}` : ""} — ${result.message}`);
    return 1;
  }
  console.log(`OK ${repo}${pkg ? `/${pkg}` : ""} ${specialist} ${status}`);

  // Rule 2 — the ledger record above is the important thing and is now durable;
  // closing the session is housekeeping done AFTER it, and must never lose the
  // record. When this write lands a session-mode unit on a TERMINAL status
  // (SESSION_CLOSING_STATUSES — verified/merged/failed/escalated), end its
  // session(s) as the coordinator's instrument (an internal agentop spawn that
  // never passes through the specialist guard) and say so — closing only what it
  // can verify, and surfacing a stale/missing sessionId instead of staying
  // silent. Idempotent, non-fatal.
  if (SESSION_CLOSING_STATUSES.has(status)) {
    const ledger = await readLedger(workspace, id);
    // Per task (j-20260826-uv): closing THIS task's delivery must end only THIS
    // task's session(s) — a sibling task of the same persona on the same unit is
    // an independent run and must keep running.
    const unitRecords = (ledger?.dispatches ?? []).filter(
      (d) => d.repo === repo && (d.package ?? null) === (pkg ?? null) && (d.task ?? null) === (task ?? null),
    );
    const lines = await closeUnitSessions(unitRecords, `${repo}${pkg ? `/${pkg}` : ""}`, deps.sessionRunner ?? realRunner);
    for (const l of lines) console.log(l);
  }

  // Item 9 — a ledger record is a state event: log the delta table (gated on TTY
  // and the follow-preference, silent off a terminal). Presentation only, wrapped
  // so it can never undo the record that already landed above.
  await logStatusDelta({
    workspace,
    journeyId: id,
    changed: (u) =>
      u.journey === id &&
      u.repo === repo &&
      (u.package ?? null) === (pkg ?? null) &&
      (u.task ?? null) === (task ?? null) &&
      u.specialist === specialist,
    argv: args,
    runner: deps.sessionRunner,
  });
  return 0;
}

async function showCommand(args: string[], deps: JourneyDeps = {}): Promise<number> {
  const workspace = getFlag(args, "--workspace") ?? process.cwd();
  const id = getFlag(args, "--journey");
  if (!id) {
    console.log("ERROR args: --journey <id> is required");
    return 1;
  }
  const ledger = await readLedger(workspace, id);
  if (!ledger) {
    console.log(`ERROR journey: no ledger for ${id}`);
    return 1;
  }
  // Publication state per repo (j-20260830-zd), from local git — so a merged-in-dev
  // unit reads differently from a published one without anyone touching GitHub.
  // Best-effort: a git failure leaves the map empty and `show` prints as before.
  const releaseStates = await releaseStatesForLedger(workspace, ledger, deps.resolveRelease ?? realReleaseResolver);
  const publishTag: Record<string, string> = {
    published: " [published]",
    "merged-unpublished": " [merged-in-dev — NOT published]",
    unknown: " [publication unverifiable]",
  };
  // "Read the ledger first" (Pilar 3): each unit is tagged so the coordinator
  // sees at a glance what is finished (never re-dispatch) vs. still open.
  for (const d of ledger.dispatches) {
    const unit = `${d.repo}${d.package ? `/${d.package}` : ""}`;
    const done = d.status === "merged" ? "[MERGED — immutable]" : d.status === "verified" ? "[VERIFIED — cleared]" : "";
    const ev = d.evidence ? " +evidence" : d.status === "delivered" || d.status === "verified" ? " !NO-EVIDENCE" : "";
    // Only merged units carry a publication question; annotate from the derived
    // repo state (never rewriting the immutable `merged` record itself).
    const pub = d.status === "merged" ? publishTag[releaseStates.get(d.repo)?.state ?? ""] ?? "" : "";
    console.log(`DISPATCH ${unit} ${d.specialist} ${d.status} ${d.branch} ${d.pr ?? "-"}${ev}${done ? " " + done : ""}${pub}`);
  }
  const open = ledger.dispatches.filter(
    (d) => d.status === "dispatched" || d.status === "failed" || d.status === "escalated" || d.status === "redirected",
  ).length;
  const done = ledger.dispatches.filter((d) => d.status === "merged" || d.status === "verified").length;
  console.log(`STATE journey=${id} dispatches=${ledger.dispatches.length} open=${open} done=${done}`);
  return 0;
}

// The coordinator's Orientation Spec: a durable, PE-approved cross-package spec
// written before any dispatch (the gate). Scaffold → PE edits → --check → PE
// --approve; --amend bumps the version (re-approval) after an escalation.
async function specCommand(args: string[]): Promise<number> {
  const workspace = getFlag(args, "--workspace") ?? process.cwd();
  const id = getFlag(args, "--journey");
  if (!id) {
    console.log("ERROR args: --journey <id> is required");
    return 1;
  }
  const unitsFlag = getFlag(args, "--units");
  const units = unitsFlag ? unitsFlag.split(",").map((s) => s.trim()).filter(Boolean) : [];
  const relPath = join(".aipe", "journeys", id, "orientation.md");
  const absPath = join(workspace, relPath);

  if (args.includes("--approve")) {
    const ledger = await readLedger(workspace, id);
    if (!ledger?.spec) {
      console.log("ERROR spec: no orientation spec to approve — scaffold it first");
      return 1;
    }
    await setJourneySpec(workspace, id, { ...ledger.spec, approved: true });
    console.log(`OK approved journey=${id} spec=v${ledger.spec.version}`);
    return 0;
  }

  if (args.includes("--check")) {
    let md: string;
    try {
      md = await readFile(absPath, "utf8");
    } catch {
      console.log(`REJECT missing-file ${relPath}`);
      return 1;
    }
    const check = validateOrientation(md, units);
    if (check.ok) {
      console.log(`OK spec journey=${id}`);
      return 0;
    }
    for (const s of check.missingSections) console.log(`REJECT missing-section ${s}`);
    for (const u of check.missingUnits) console.log(`REJECT missing-unit ${u}`);
    return 1;
  }

  if (args.includes("--show")) {
    const ledger = await readLedger(workspace, id);
    if (!ledger?.spec) {
      console.log(`STATE spec=none journey=${id}`);
      return 0;
    }
    console.log(`SPEC ${ledger.spec.path} v${ledger.spec.version} approved=${ledger.spec.approved}`);
    return 0;
  }

  // default: scaffold (never clobbers an edited spec) + record it on the ledger
  const existing = await readLedger(workspace, id);
  const amend = args.includes("--amend");
  const version = amend ? (existing?.spec?.version ?? 1) + 1 : existing?.spec?.version ?? 1;
  await mkdir(dirname(absPath), { recursive: true });
  let created = true;
  try {
    await access(absPath);
    created = false;
  } catch {
    // absent → write the template
  }
  if (created) await writeFile(absPath, renderOrientationTemplate(id, units), "utf8");
  await setJourneySpec(workspace, id, { path: relPath, version, approved: false });
  console.log(`${created ? "OK" : "EXISTS"} ${relPath}`);
  console.log(`STATE spec journey=${id} v${version} approved=false units=${units.length}`);
  return 0;
}

// `aipe journey reconcile [--journey <id>]` — auto-detect merges: poll each
// delivered dispatch's PR via `gh pr view --json state` and mark the MERGED ones
// merged on the ledger. With no --journey, reconciles every journey.
async function reconcileCommand(args: string[]): Promise<number> {
  const workspace = getFlag(args, "--workspace") ?? process.cwd();
  const id = getFlag(args, "--journey");
  const results = id ? [await reconcileJourney(workspace, id, ghPrState)] : await reconcileAll(workspace, ghPrState);
  let totalChecked = 0;
  let totalMerged = 0;
  for (const r of results) {
    totalChecked += r.checked;
    totalMerged += r.merged.length;
    for (const pr of r.merged) console.log(`MERGED journey=${r.journey} ${pr}`);
  }
  console.log(`STATE reconcile checked=${totalChecked} merged=${totalMerged}`);
  return 0;
}

// `aipe journey verify --journey <id>` — a deterministic reliability lint of the
// ledger, run by the coordinator before reporting to the PE. It audits the
// durable record for broken invariants (a done-claim without proof, a QA
// rejection left open, a delivery that never cleared its gate, a merge that
// skipped QA, a consumer shipped against a producer that never landed, an
// escalation still open) and fails (exit 1) on any critical finding.
async function verifyCommand(args: string[], deps: JourneyDeps = {}): Promise<number> {
  const workspace = getFlag(args, "--workspace") ?? process.cwd();
  const id = getFlag(args, "--journey");
  if (!id) {
    console.log("ERROR args: --journey <id> is required");
    return 1;
  }
  const ledger = await readLedger(workspace, id);
  if (!ledger) {
    console.log(`ERROR journey: no ledger for ${id}`);
    return 1;
  }
  const graph = await readGraph(workspace);
  const edges = graph.edges.map((e) => ({ from: e.from, to: e.to, type: e.type }));
  // The offline invariant lint, plus the CI audit (talks to the forge). Both
  // feed the same finding list so a red-CI unit reads exactly like any other
  // critical. The CI resolver is injectable (tests) and defaults to real gh.
  const findings = verifyJourney(ledger, edges);
  findings.push(...(await auditPrChecks(ledger, deps.resolveChecks ?? ghPrChecks)));
  // Release audit (j-20260830-zd): merged work that was never published, from
  // local git. Warnings only — a promotion/release is owed, not a defect.
  const releaseStates = await releaseStatesForLedger(workspace, ledger, deps.resolveRelease ?? realReleaseResolver);
  findings.push(...auditReleaseState(ledger, releaseStates));
  findings.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "critical" ? -1 : 1));
  for (const f of findings) {
    console.log(`FINDING ${f.severity.toUpperCase()} ${f.code} ${f.unit} — ${f.detail}`);
  }
  // D8 — surface any phantom ledgers already sitting inside a worktree so the
  // coordinator can reconcile and remove them. A warning (not a critical): it is
  // a misdirected write to clean up, not a broken invariant in THIS ledger.
  for (const phantom of await findPhantomLedgers(workspace)) {
    console.log(
      `FINDING WARNING phantom-ledger ${phantom.worktree} — a ledger was written inside this worktree (${phantom.path}); reconcile its records into the workspace ledger and remove it`,
    );
  }
  const critical = findings.filter((f) => f.severity === "critical").length;
  console.log(`STATE journey=${id} clean=${critical === 0} findings=${findings.length} critical=${critical}`);
  return critical > 0 ? 1 : 0;
}

// `aipe journey dedupe [--dry-run]` — migrate the jane/Jane duplicates already on
// disk: canonicalize repo + specialist, collapse rows that share a branch into
// one, keep merged units immutable (j-20260829-dp §10). --dry-run reports without
// writing.
async function dedupeCommand(args: string[]): Promise<number> {
  const workspace = getFlag(args, "--workspace") ?? process.cwd();
  const dryRun = args.includes("--dry-run");
  const results = await dedupeAll(workspace, { dryRun });
  let collapsed = 0;
  let normalized = 0;
  for (const r of results) {
    for (const m of r.merges) {
      collapsed += m.dropped;
      console.log(`${dryRun ? "WOULD-MERGE" : "MERGED"} journey=${r.journey} ${m.unit} kept=${m.kept} dropped=${m.dropped}`);
    }
    normalized += r.normalized;
  }
  console.log(`STATE dedupe journeys-changed=${results.length} duplicates-collapsed=${collapsed} normalized=${normalized}${dryRun ? " (dry-run)" : ""}`);
  return 0;
}

export async function run(args: string[], deps: JourneyDeps = {}): Promise<number> {
  const [sub, ...rest] = args;
  switch (sub) {
    case "start":
      return startCommand(rest);
    case "record":
      return recordCommand(rest, deps);
    case "show":
      return showCommand(rest, deps);
    case "spec":
      return specCommand(rest);
    case "reconcile":
      return reconcileCommand(rest);
    case "dedupe":
      return dedupeCommand(rest);
    case "verify":
      return verifyCommand(rest, deps);
    default:
      console.log(`ERROR command: unknown journey command "${sub ?? ""}"`);
      console.log("Usage: aipe journey <start|record|show|spec|reconcile|dedupe|verify> [options]");
      return 1;
  }
}

if (import.meta.main) {
  run(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((err) => {
      console.log(`ERROR ${err}`);
      process.exit(1);
    });
}
