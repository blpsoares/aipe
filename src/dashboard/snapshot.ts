// Aggregates the whole context into one snapshot the dashboard renders: the
// company (coordinator + hired specialists), each worker's current status
// derived from the journey ledgers, the live pipeline, worktrees, and toolbox.
//
// This is the *single source of truth* for both the `aipe dashboard` TUI and the
// `aipe serve` web console. Fields the TUI needs come first; everything the web
// console adds (per-repo stacks, relation edges, toolbox detail, worktree rows,
// timestamps) is layered on additively so the TUI and its tests are unaffected.
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { inferKind } from "../context-brain/kind";
import { resolvePackages } from "../context-brain/packages";
import { readPersonas } from "../hire-specialists/read-personas";
import { listJourneys } from "../journey/ledger";
import { readBrain } from "../make-workspace/read";
import { readGraph } from "../relationship/read-graph";
import { readToolbox } from "../toolbox/catalog";
import { listWorktrees } from "../worktree/run";
import type { PersonaRegistryEntry } from "../hire-specialists/types";
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
  kind: string; // functional category: api | web | lib | service
}

// Additive views the web console reads (the TUI ignores them).
export interface RepoInfo {
  name: string;
  stack: string[];
  kind: string; // functional category: api | web | lib | service
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
// A specialist's "CV": the persona's title, bio (from their skill's description),
// and competences (their stack + role focus). Deliveries / in-progress work are
// derived on the client from the journeys, so this stays a static profile.
export interface PersonaCV {
  name: string;
  role: string;
  title: string;
  repo: string | null;
  module?: string;
  bio: string;
  competences: string[];
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
  packages: ModuleView[];
  personaCVs: PersonaCV[];
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
    packages: [],
    personaCVs: [],
    generatedAt,
  };
}

const ROLE_TITLE: Record<string, string> = {
  coordinator: "Coordinator",
  "dev-fullstack": "Fullstack specialist",
  qa: "QA specialist",
};

// Role-focused competences, shown alongside the persona's stack in their CV.
const ROLE_COMPETENCES: Record<string, string[]> = {
  coordinator: ["Orchestration", "Spec authoring", "Cross-repo review"],
  "dev-fullstack": ["Feature delivery", "API & data", "Refactoring"],
  qa: ["Test design", "Regression", "Release gating"],
};

// Reads the `description:` line from a persona's skill front-matter (their bio).
// Missing/unreadable → null, so the caller falls back to a generated line.
async function readPersonaBio(workspaceDir: string, path: string | null): Promise<string | null> {
  if (!path) return null;
  const rel = path.replace(/^\.\//, "");
  const full = rel.startsWith("/") ? join(rel, "SKILL.md") : join(workspaceDir, rel, "SKILL.md");
  try {
    const raw = await readFile(full, "utf8");
    const m = raw.match(/^description:\s*(.+)$/m);
    return m ? m[1]!.trim() : null;
  } catch {
    return null;
  }
}

async function buildPersonaCVs(
  workspaceDir: string,
  roster: PersonaRegistryEntry[],
  repoInfos: RepoInfo[],
  packages: ModuleView[],
): Promise<PersonaCV[]> {
  return Promise.all(
    roster.map(async (p) => {
      const title = ROLE_TITLE[p.role] ?? p.role;
      const stack = p.module
        ? packages.find((m) => m.repo === p.repo && m.module === p.module)?.stack ?? []
        : repoInfos.find((r) => r.name === p.repo)?.stack ?? [];
      const competences = [...new Set([...(ROLE_COMPETENCES[p.role] ?? []), ...stack])];
      const bio =
        (await readPersonaBio(workspaceDir, p.path)) ??
        (p.repo
          ? `${title} for ${p.module ? `${p.repo}/${p.module}` : p.repo}. Dispatched by the coordinator for scoped work, or worn directly in a session inside this unit.`
          : `${title} of the context — plans journeys, authors the Orientation Spec, and reviews cross-repo work.`);
      return { name: p.name, role: p.role, title, repo: p.repo, ...(p.module ? { module: p.module } : {}), bio, competences };
    }),
  );
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

  const relations: RelationEdgeView[] = graph.edges.map((e) => ({
    from: e.from,
    to: e.to,
    type: e.type,
    detail: e.perspectives[0]?.detail,
  }));

  const repoInfos: RepoInfo[] = brain.brain.repos.map((r) => ({
    name: r.name,
    stack: r.stack ?? [],
    kind: inferKind(r.name, r.stack ?? [], r.kind),
  }));
  // Declared kind per fqid: a module's own `kind`, or the repo's for an implicit
  // (whole-repo) module. Anything undeclared is inferred from name + stack.
  const declaredKind = new Map<string, string | undefined>();
  for (const r of brain.brain.repos) {
    if (r.packages && r.packages.length > 0) {
      for (const m of r.packages) declaredKind.set(`${r.name}/${m.name}`, m.kind ?? r.kind);
    } else {
      declaredKind.set(r.name, r.kind);
    }
  }
  const moduleViews: ModuleView[] = resolvePackages(brain.brain).map((m) => ({
    repo: m.repo,
    module: m.module,
    fqid: m.fqid,
    group: m.group,
    stack: m.stack,
    implicit: m.implicit,
    kind: inferKind(m.implicit ? m.repo : m.module, m.stack, declaredKind.get(m.fqid)),
  }));
  const personaCVs = await buildPersonaCVs(workspaceDir, roster, repoInfos, moduleViews);

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
    repoInfos,
    relations,
    toolboxDetail: {
      skills: toolbox.skills.map((s) => ({ name: s.name, description: s.description, whenToUse: s.whenToUse, repos: s.repos })),
      mcps: toolbox.mcps.map((m) => ({ name: m.name, scope: m.scope, repos: m.repos, description: m.description })),
    },
    worktreeRows: worktrees.map((w) => ({ repo: w.repo, slug: w.slug, journey: w.journey, branch: w.branch, path: w.path })),
    packages: moduleViews,
    personaCVs,
    generatedAt,
  };
}
