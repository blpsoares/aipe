#!/usr/bin/env bun
import { readFile, stat } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { parse } from "yaml";
import type { BrainFile, Phase, RepoEntry, StateFile } from "../context-brain/types";
import { renderSessionContext } from "./awareness";
import { readPersonaContext } from "./persona-context";
import { personaLocations } from "../harness/persona-install";
import { resolveAdapter } from "../harness/registry";
import { VERSION } from "../cli";
import { ensureRehydrated } from "./auto-rehydrate";
import { resolveStatusPref } from "../status/pref";
import { DEFAULT_STATUS_PREF, type StatusUpdatesPref } from "../status/types";
import { loadReport } from "../status/load";
import { renderStateBlock } from "../status/context-block";
import { coordinatorAwareness } from "./coordinator-awareness";

function getFlag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const v = args[i + 1];
  if (v === undefined || v.startsWith("--")) return undefined;
  return v;
}

// Strips C0 control characters from any free text that ends up interpolated
// into the awareness block. Exported so the other readers feeding that block
// (persona-context) enforce the same invariant, instead of duplicating it.
export function sanitize(v: string): string {
  return v.replace(/[\x00-\x1f]+/g, " ").trim();
}

function isPhase(v: unknown): v is Phase {
  return v === "pending" || v === "done";
}

export interface RepoAtCwd {
  name: string;
  path: string;
}

export interface Fields {
  brain: "present" | "absent";
  contextName: string;
  coordinator: string;
  pe: string;
  phaseBrain: Phase;
  phaseWorkspace: Phase;
  phaseRelationship: Phase;
  phaseSpecialists: Phase;
  repos: string[];
  root: string;
  repoAtCwd: RepoAtCwd | null;
  // The (10) follow-preference, read from brain.context.statusUpdates. Absent
  // field ⇒ `auto:false` (backward compatible with every brain written before
  // this feature). Carried on Fields so the coordinator learns it from the
  // SessionStart awareness (item 10, inv. 8) even if the richer state block
  // (item 8) cannot be assembled. It is deliberately NOT emitted by
  // `formatFields` — that KEY=value block stays byte-for-byte what the hook
  // parses.
  statusUpdates: StatusUpdatesPref;
}

const MAX_UPWARD_DEPTH = 8;

// Walks up from `startDir` (inclusive) looking for a directory containing
// `.aipe/brain.yaml`. Stops at the filesystem root or after MAX_UPWARD_DEPTH
// hops, whichever comes first. Existence only (not parseability) — a found
// but malformed brain.yaml still counts as "this is the root", matching the
// existing absent-on-malformed behavior for THAT directory rather than
// silently skipping past it to an unrelated ancestor.
async function findWorkspaceRoot(startDir: string): Promise<string | undefined> {
  let dir = resolve(startDir);
  for (let depth = 0; depth <= MAX_UPWARD_DEPTH; depth++) {
    try {
      await stat(join(dir, ".aipe", "brain.yaml"));
      return dir;
    } catch {
      // not here — try the parent
    }
    const parent = dirname(dir);
    if (parent === dir) return undefined; // reached the filesystem root
    dir = parent;
  }
  return undefined;
}

function nonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

// Which declared repo (if any) the ORIGINAL cwd falls under, relative to the
// resolved root. Longest-matching path wins (defensive against overlaps —
// repos are siblings in practice, so this rarely matters).
//
// `brain.yaml` is hand-editable, so entries are validated one by one: a null
// entry, a missing/non-string `name` or `path` is SKIPPED, never thrown on —
// a single malformed entry must not break the SessionStart hook (nor poison
// its well-formed siblings). A repo resolving to the workspace root itself
// (`path: "."`) is also skipped: the root's coordinator identity always wins.
function repoAtCwd(root: string, cwd: string, repos: readonly unknown[]): RepoAtCwd | null {
  const absCwd = resolve(cwd);
  const absRoot = resolve(root);
  let best: RepoAtCwd | null = null;
  let bestLen = -1;
  for (const entry of repos) {
    const repo = entry as Partial<RepoEntry> | null;
    const name = repo?.name;
    const path = repo?.path;
    if (!nonEmptyString(name) || !nonEmptyString(path)) continue;
    const absRepo = resolve(root, path);
    if (absRepo === absRoot) continue; // the workspace root is never a repo
    const isMatch = absCwd === absRepo || absCwd.startsWith(absRepo + sep);
    if (isMatch && absRepo.length > bestLen) {
      // NOT sanitized here: `name` is also the key matched against
      // personas.yaml/graph.yaml, so it must stay byte-identical to the brain.
      // Sanitizing happens at the display boundary (buildPersonaAwareness).
      best = { name, path };
      bestLen = absRepo.length;
    }
  }
  return best;
}

async function readYaml(path: string): Promise<unknown | undefined> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    return undefined; // absent
  }
  try {
    return parse(raw);
  } catch {
    return undefined; // malformed
  }
}

function absentFields(): Fields {
  return {
    brain: "absent",
    contextName: "",
    coordinator: "",
    pe: "",
    phaseBrain: "pending",
    phaseWorkspace: "pending",
    phaseRelationship: "pending",
    phaseSpecialists: "pending",
    repos: [],
    root: "",
    repoAtCwd: null,
    statusUpdates: DEFAULT_STATUS_PREF,
  };
}

export async function readState(cwd: string): Promise<Fields> {
  const root = await findWorkspaceRoot(cwd);
  if (!root) return absentFields();

  const aipe = join(root, ".aipe");
  const brainParsed = await readYaml(join(aipe, "brain.yaml"));
  if (!brainParsed || typeof brainParsed !== "object") {
    return absentFields();
  }

  const brain = brainParsed as Partial<BrainFile>;
  const contextName = sanitize(String(brain.context?.name ?? ""));
  const coordinator = sanitize(String(brain.context?.coordinator ?? ""));
  const pe = sanitize(String(brain.context?.pe ?? ""));
  const repos = Array.isArray(brain.repos)
    ? brain.repos
        .map((r) => sanitize(String((r as { name?: unknown } | null)?.name ?? "")))
        .filter((n) => n.length > 0)
    : [];
  const repoEntries = Array.isArray(brain.repos) ? brain.repos : [];

  const stateParsed = await readYaml(join(aipe, "state.yaml"));
  const phase = (stateParsed as Partial<StateFile> | undefined)?.phase;
  const readPhase = (v: unknown, fallback: Phase): Phase => (isPhase(v) ? v : fallback);

  return {
    brain: "present",
    contextName,
    coordinator,
    pe,
    phaseBrain: readPhase(phase?.brain, "done"),
    phaseWorkspace: readPhase(phase?.workspace, "pending"),
    phaseRelationship: readPhase(phase?.relationship, "pending"),
    phaseSpecialists: readPhase(phase?.specialists, "pending"),
    repos,
    root,
    repoAtCwd: repoAtCwd(root, cwd, repoEntries),
    statusUpdates: resolveStatusPref(brain.context),
  };
}

export function formatFields(f: Fields): string {
  return [
    `BRAIN=${f.brain}`,
    `CONTEXT_NAME=${f.contextName}`,
    `COORDINATOR=${f.coordinator}`,
    `PHASE_BRAIN=${f.phaseBrain}`,
    `PHASE_WORKSPACE=${f.phaseWorkspace}`,
    `PHASE_RELATIONSHIP=${f.phaseRelationship}`,
    `PHASE_SPECIALISTS=${f.phaseSpecialists}`,
    `REPOS=${f.repos.join(",")}`,
  ].join("\n");
}

export async function run(args: string[]): Promise<number> {
  const workspace = getFlag(args, "--workspace") ?? process.cwd();
  console.log(formatFields(await readState(workspace)));
  return 0;
}

export async function runSessionContext(args: string[]): Promise<number> {
  const workspace = getFlag(args, "--workspace") ?? process.cwd();
  if (!workspace) {
    console.log("{}");
    return 0;
  }
  const fields = await readState(workspace);
  if (fields.root) {
    await ensureRehydrated(fields.root, VERSION).catch(() => {});
  }
  if (fields.repoAtCwd) {
    const ctx = await readPersonaContext(fields.root, fields.repoAtCwd.name);
    const adapter = await resolveAdapter(fields.root);
    console.log(renderSessionContext(fields, ctx, personaLocations(adapter)));
  } else {
    // Item 8 — the coordinator session also gets a STATE block (where the work
    // is). It must NEVER break session open, so it is fully guarded: any failure
    // degrades to today's context, and it does not shell out to agentop
    // (`liveness:false`) so the hook stays fast. The coordinator-identity line
    // (j-20260829-5q) is prepended: who holds the workspace, and whether a second
    // coordinator is live — the actionable warning goes right under the awareness,
    // ahead of the state table.
    const coordBlock = await coordinatorAwareness(fields).catch(() => "");
    const stateBlock = await safeStateBlock(fields);
    const extra = [coordBlock, stateBlock].filter((b) => b && b.length > 0).join("\n\n") || undefined;
    console.log(renderSessionContext(fields, undefined, undefined, extra));
  }
  return 0;
}

// The item-8 state block, or undefined when it cannot or should not be built:
// before onboarding is complete there is no coordinator to inject it for, a
// missing root/brain has nothing to summarize, and any thrown error degrades to
// no-block rather than a broken session.
async function safeStateBlock(fields: Fields): Promise<string | undefined> {
  if (fields.brain !== "present" || !fields.root) return undefined;
  const onboarded =
    fields.phaseWorkspace === "done" && fields.phaseRelationship === "done" && fields.phaseSpecialists === "done";
  if (!onboarded) return undefined;
  try {
    const report = await loadReport(fields.root, { scope: "all", liveness: false });
    return renderStateBlock(report);
  } catch {
    return undefined;
  }
}

if (import.meta.main) {
  run(process.argv.slice(2)).then((code) => process.exit(code));
}
