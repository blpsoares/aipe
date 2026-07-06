// Aggregates the whole context into one snapshot the dashboard renders: the
// company (coordinator + hired specialists), each worker's current status
// derived from the journey ledgers, the live pipeline, worktrees, and toolbox.
import { readPersonas } from "../hire-specialists/read-personas";
import { listJourneys } from "../journey/ledger";
import { readBrain } from "../make-workspace/read";
import { readToolbox } from "../toolbox/catalog";
import { listWorktrees } from "../worktree/run";
import type { JourneyLedger } from "../journey/types";

export type WorkerStatus = "active" | "delivered" | "escalated" | "available";

export interface WorkerView {
  name: string;
  role: string;
  repo: string | null;
  module: string | null;
  fqid: string | null;
  status: WorkerStatus;
  journey?: string;
  pr?: string;
}

export interface Snapshot {
  ok: boolean;
  error?: string;
  context: { name: string; coordinator: string };
  repos: string[];
  workers: WorkerView[];
  journeys: JourneyLedger[];
  worktrees: number;
  counts: { hired: number; active: number; delivered: number; escalated: number; available: number };
  skills: number;
  mcps: number;
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

export async function buildSnapshot(workspaceDir: string): Promise<Snapshot> {
  const empty: Snapshot = {
    ok: false,
    context: { name: "?", coordinator: "?" },
    repos: [],
    workers: [],
    journeys: [],
    worktrees: 0,
    counts: { hired: 0, active: 0, delivered: 0, escalated: 0, available: 0 },
    skills: 0,
    mcps: 0,
  };

  const brain = await readBrain(workspaceDir);
  if (!brain.ok) return { ...empty, error: brain.error };

  const [roster, journeys, toolbox, worktrees] = await Promise.all([
    readPersonas(workspaceDir),
    listJourneys(workspaceDir),
    readToolbox(workspaceDir),
    listWorktrees(workspaceDir),
  ]);

  const workers: WorkerView[] = roster.map((p) => {
    const module = p.module ?? null;
    const fqid = p.fqid ?? (p.repo ?? null);
    if (p.role === "coordinator" || p.repo === null) {
      return { name: p.name, role: p.role, repo: p.repo, module, fqid, status: "active" as WorkerStatus };
    }
    const derived = deriveStatus(p.repo, p.name, journeys);
    return { name: p.name, role: p.role, repo: p.repo, module, fqid, ...derived };
  });

  const specialists = workers.filter((w) => w.role !== "coordinator");
  const counts = {
    hired: specialists.length,
    active: specialists.filter((w) => w.status === "active").length,
    delivered: specialists.filter((w) => w.status === "delivered").length,
    escalated: specialists.filter((w) => w.status === "escalated").length,
    available: specialists.filter((w) => w.status === "available").length,
  };

  return {
    ok: true,
    context: brain.brain.context,
    repos: brain.brain.repos.map((r) => r.name),
    workers,
    journeys,
    worktrees: worktrees.length,
    counts,
    skills: toolbox.skills.length,
    mcps: toolbox.mcps.length,
  };
}
