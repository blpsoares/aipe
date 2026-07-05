// Aggregates the whole context into one snapshot the dashboard renders: the
// company (coordinator + hired specialists), each worker's current status
// derived from the journey ledgers, the live pipeline, worktrees, and toolbox.
//
// This is the *single source of truth* for both the `aipe dashboard` TUI and the
// `aipe serve` web console. Fields the TUI needs come first; everything the web
// console adds (per-repo stacks, relation edges, toolbox detail, worktree rows,
// timestamps) is layered on additively so the TUI and its tests are unaffected.
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { resolveModules } from "../context-brain/modules";
import { readPersonas } from "../hire-specialists/read-personas";
import { listJourneys } from "../journey/ledger";
import { readBrain } from "../make-workspace/read";
import { readGraph } from "../relationship/read-graph";
import { readToolbox } from "../toolbox/catalog";
import { listWorktrees } from "../worktree/run";
import type { JourneyLedger } from "../journey/types";
import type { RelationType } from "../relationship/types";

export type WorkerStatus = "active" | "delivered" | "escalated" | "available";

export interface WorkerView {
  name: string;
  role: string;
  repo: string | null;
  status: WorkerStatus;
  journey?: string;
  pr?: string;
  module?: string; // monorepo unit this persona covers (absent ⇒ whole repo)
  group?: string;
}

export interface ModuleView {
  repo: string;
  module: string;
  fqid: string;
  group: string;
  stack: string[];
  implicit: boolean;
}

// Additive views the web console reads (the TUI ignores them).
export interface RepoInfo {
  name: string;
  stack: string[];
}
export interface RelationEdgeView {
  from: string;
  to: string;
  type: RelationType;
  detail?: string;
}
export interface ToolboxSkillView {
  name: string;
  description: string;
  whenToUse: string;
  repos: string[];
}
export interface ToolboxMcpView {
  name: string;
  scope: string;
  repos: string[];
  description: string;
}
export interface WorktreeView {
  repo: string;
  slug: string;
  journey: string;
  branch: string;
  path: string;
}
export type JourneyView = JourneyLedger & { updatedAt?: string };

export interface Snapshot {
  ok: boolean;
  error?: string;
  context: { name: string; coordinator: string };
  repos: string[];
  workers: WorkerView[];
  journeys: JourneyView[];
  worktrees: number;
  counts: { hired: number; active: number; delivered: number; escalated: number; available: number };
  skills: number;
  mcps: number;
  // web-console additions
  repoInfos: RepoInfo[];
  relations: RelationEdgeView[];
  toolboxDetail: { skills: ToolboxSkillView[]; mcps: ToolboxMcpView[] };
  worktreeRows: WorktreeView[];
  modules: ModuleView[];
  generatedAt: string;
}

// Precedence for a worker's *current* state across all their dispatches.
function deriveStatus(
  repo: string,
  name: string,
  journeys: JourneyLedger[],
): { status: WorkerStatus; journey?: string; pr?: string } {
  let best: { rank: number; status: WorkerStatus; journey?: string; pr?: string } = { rank: 0, status: "available" };
  const rank: Record<string, number> = { available: 0, delivered: 1, escalated: 2, active: 3 };
  for (const j of journeys) {
    for (const d of j.dispatches) {
      if (d.repo !== repo || d.specialist.toLowerCase() !== name.toLowerCase()) continue;
      const status: WorkerStatus =
        d.status === "dispatched" ? "active"
        : d.status === "escalated" ? "escalated"
        : d.status === "delivered" ? "delivered"
        : "available"; // merged/removed → free again
      if (rank[status]! >= best.rank) best = { rank: rank[status]!, status, journey: j.id, pr: d.pr };
    }
  }
  return { status: best.status, journey: best.journey, pr: best.pr };
}

// Best-effort last-modified stamp for a journey ledger (drives ordering in the
// web console). Missing/unreadable → undefined, never throws.
async function journeyMtime(workspaceDir: string, id: string): Promise<string | undefined> {
  try {
    const s = await stat(join(workspaceDir, ".aipe", "journeys", `${id}.yaml`));
    return s.mtime.toISOString();
  } catch {
    return undefined;
  }
}

function emptySnapshot(generatedAt: string): Snapshot {
  return {
    ok: false,
    context: { name: "?", coordinator: "?" },
    repos: [],
    workers: [],
    journeys: [],
    worktrees: 0,
    counts: { hired: 0, active: 0, delivered: 0, escalated: 0, available: 0 },
    skills: 0,
    mcps: 0,
    repoInfos: [],
    relations: [],
    toolboxDetail: { skills: [], mcps: [] },
    worktreeRows: [],
    modules: [],
    generatedAt,
  };
}

export async function buildSnapshot(workspaceDir: string): Promise<Snapshot> {
  // Date is available in the compiled binary and in bun test (not a workflow script).
  const generatedAt = new Date().toISOString();
  const empty = emptySnapshot(generatedAt);

  const brain = await readBrain(workspaceDir);
  if (!brain.ok) return { ...empty, error: brain.error };

  const [roster, journeys, toolbox, worktrees, graph] = await Promise.all([
    readPersonas(workspaceDir),
    listJourneys(workspaceDir),
    readToolbox(workspaceDir),
    listWorktrees(workspaceDir),
    readGraph(workspaceDir),
  ]);

  const workers: WorkerView[] = roster.map((p) => {
    if (p.role === "coordinator" || p.repo === null) {
      return { name: p.name, role: p.role, repo: p.repo, status: "active" as WorkerStatus };
    }
    const derived = deriveStatus(p.repo, p.name, journeys);
    return {
      name: p.name,
      role: p.role,
      repo: p.repo,
      ...(p.module ? { module: p.module } : {}),
      ...(p.group ? { group: p.group } : {}),
      ...derived,
    };
  });

  const specialists = workers.filter((w) => w.role !== "coordinator");
  const counts = {
    hired: specialists.length,
    active: specialists.filter((w) => w.status === "active").length,
    delivered: specialists.filter((w) => w.status === "delivered").length,
    escalated: specialists.filter((w) => w.status === "escalated").length,
    available: specialists.filter((w) => w.status === "available").length,
  };

  const journeyViews: JourneyView[] = await Promise.all(
    journeys.map(async (j) => ({ ...j, updatedAt: await journeyMtime(workspaceDir, j.id) })),
  );

  const relations: RelationEdgeView[] = graph.map((e) => ({
    from: e.from,
    to: e.to,
    type: e.type,
    detail: e.perspectives[0]?.detail,
  }));

  return {
    ok: true,
    context: brain.brain.context,
    repos: brain.brain.repos.map((r) => r.name),
    workers,
    journeys: journeyViews,
    worktrees: worktrees.length,
    counts,
    skills: toolbox.skills.length,
    mcps: toolbox.mcps.length,
    repoInfos: brain.brain.repos.map((r) => ({ name: r.name, stack: r.stack ?? [] })),
    relations,
    toolboxDetail: {
      skills: toolbox.skills.map((s) => ({ name: s.name, description: s.description, whenToUse: s.whenToUse, repos: s.repos })),
      mcps: toolbox.mcps.map((m) => ({ name: m.name, scope: m.scope, repos: m.repos, description: m.description })),
    },
    worktreeRows: worktrees.map((w) => ({ repo: w.repo, slug: w.slug, journey: w.journey, branch: w.branch, path: w.path })),
    modules: resolveModules(brain.brain).map((m) => ({ repo: m.repo, module: m.module, fqid: m.fqid, group: m.group, stack: m.stack, implicit: m.implicit })),
    generatedAt,
  };
}
