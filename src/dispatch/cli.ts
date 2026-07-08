#!/usr/bin/env bun
// `aipe dispatch validate --input <batch.json>` — adjudicates the
// parallel-dispatch law for one proposed batch. Prints OK or one REJECT line
// per problem; the coordinator only provisions worktrees for a batch that
// validates. Deterministic; no LLM.
import { readFile } from "node:fs/promises";
import { readBrain } from "../make-workspace/read";
import { validateBatch } from "./law";
import { claimLock, releaseLock } from "./lock";
import { readPersonas } from "./personas";
import type { Batch, DispatchEntry } from "./types";

function getFlag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const value = args[i + 1];
  if (value === undefined || value.startsWith("--")) return undefined;
  return value;
}

function parseBatch(value: unknown): Batch | null {
  if (!Array.isArray(value)) return null;
  const batch: DispatchEntry[] = [];
  for (const e of value) {
    if (typeof e !== "object" || e === null) return null;
    const r = e as Record<string, unknown>;
    if (typeof r.repo !== "string" || typeof r.specialist !== "string") return null;
    batch.push({ repo: r.repo, specialist: r.specialist });
  }
  return batch;
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

  const verdict = validateBatch(
    batch,
    brainResult.brain.repos.map((r) => r.name),
    roster,
  );
  if (verdict.ok) {
    console.log(`OK batch=${batch.length}`);
    return 0;
  }
  for (const reject of verdict.rejects) console.log(`REJECT ${reject}`);
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
    const unit = pkg ? `${repo}/${pkg}` : repo;
    if (result.reconciled) {
      const prev = result.previous;
      console.log(`RECONCILED ${unit} journey=${journey} prev=${prev ? `${prev.journey}/${prev.specialist}(pid ${prev.pid})` : "none"}`);
    } else {
      console.log(`CLAIMED ${unit} journey=${journey} specialist=${specialist}`);
    }
    return 0;
  }
  const h = result.holder;
  console.log(`COLLISION ${pkg ? `${repo}/${pkg}` : repo} held by journey=${h.journey} specialist=${h.specialist} pid=${h.pid} since=${h.timestamp}`);
  console.log("WARN not blocking; re-run with --force to override the active lock.");
  return 2;
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
  console.log(`ERROR command: unknown dispatch command "${sub ?? ""}"`);
  console.log("Usage: aipe dispatch <validate|claim|release> [options]");
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
