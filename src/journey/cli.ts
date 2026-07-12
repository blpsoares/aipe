#!/usr/bin/env bun
// `aipe journey <start|record|show>` — the durable journey ledger under
// .aipe/journeys/<id>.yaml. Audit bookkeeping for a work session's dispatches
// (repo, specialist, branch, worktree, PR, status); it is NOT the hiring brief.
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { recordDispatchGuarded, readLedger, setJourneySpec, startJourney } from "./ledger";
import { ghPrState, reconcileAll, reconcileJourney } from "./reconcile";
import { renderOrientationTemplate, validateOrientation } from "./spec";
import { DISPATCH_STATUSES } from "./types";
import type { DispatchEvidence, DispatchStatus } from "./types";

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

async function recordCommand(args: string[]): Promise<number> {
  const workspace = getFlag(args, "--workspace") ?? process.cwd();
  const id = getFlag(args, "--journey");
  const repo = getFlag(args, "--repo");
  const specialist = getFlag(args, "--specialist");
  const branch = getFlag(args, "--branch");
  const worktree = getFlag(args, "--worktree");
  if (!id || !repo || !specialist || !branch || !worktree) {
    console.log("ERROR args: --journey, --repo, --specialist, --branch and --worktree are required");
    return 1;
  }
  const pr = getFlag(args, "--pr");
  const pkg = getFlag(args, "--package");
  const tier = getFlag(args, "--tier");
  const model = getFlag(args, "--model");
  const reason = getFlag(args, "--reason");
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

  const result = await recordDispatchGuarded(
    workspace,
    id,
    {
      repo,
      ...(pkg ? { package: pkg } : {}),
      specialist,
      branch,
      worktree,
      ...(pr ? { pr } : {}),
      ...(tier ? { tier } : {}),
      ...(model ? { model } : {}),
      ...(evidence ? { evidence } : {}),
      status,
    },
    { ...(reason ? { reason } : {}) },
  );

  if (!result.ok) {
    console.log(`REJECT ${result.code} ${repo}${pkg ? `/${pkg}` : ""} — ${result.message}`);
    return 1;
  }
  console.log(`OK ${repo}${pkg ? `/${pkg}` : ""} ${specialist} ${status}`);
  return 0;
}

async function showCommand(args: string[]): Promise<number> {
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
  // "Read the ledger first" (Pilar 3): each unit is tagged so the coordinator
  // sees at a glance what is finished (never re-dispatch) vs. still open.
  for (const d of ledger.dispatches) {
    const unit = `${d.repo}${d.package ? `/${d.package}` : ""}`;
    const done = d.status === "merged" ? "[MERGED — immutable]" : d.status === "verified" ? "[VERIFIED — cleared]" : "";
    const ev = d.evidence ? " +evidence" : d.status === "delivered" || d.status === "verified" ? " !NO-EVIDENCE" : "";
    console.log(`DISPATCH ${unit} ${d.specialist} ${d.status} ${d.branch} ${d.pr ?? "-"}${ev}${done ? " " + done : ""}`);
  }
  const open = ledger.dispatches.filter((d) => d.status === "dispatched" || d.status === "failed" || d.status === "escalated").length;
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

export async function run(args: string[]): Promise<number> {
  const [sub, ...rest] = args;
  switch (sub) {
    case "start":
      return startCommand(rest);
    case "record":
      return recordCommand(rest);
    case "show":
      return showCommand(rest);
    case "spec":
      return specCommand(rest);
    case "reconcile":
      return reconcileCommand(rest);
    default:
      console.log(`ERROR command: unknown journey command "${sub ?? ""}"`);
      console.log("Usage: aipe journey <start|record|show|spec|reconcile> [options]");
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
