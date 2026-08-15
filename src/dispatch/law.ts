import { packageFqid } from "../context-brain/packages";
import { MAX_CONCURRENT, SESSION_MAX_CONCURRENT } from "./types";
import type { Batch, PersonaRegistryEntry, SessionContext, Verdict } from "./types";

// Pure adjudication of the parallel-dispatch law for a single proposed batch.
// The coordinator owns *sequencing* (which batch runs before which, derived
// from graph.yaml); this only enforces the physical constraints on one batch:
//   - the same *package* (unit of work) must not appear twice — same-unit work
//     serializes, while distinct packages of one monorepo run in parallel,
//   - at most MAX_CONCURRENT entries,
//   - every repo and specialist must exist.
// A package-less entry is the implicit whole-repo package, so its key is the bare
// repo name — identical to the pre-package behaviour.
// It never reorders — a batch is either lawful as proposed or rejected.
export function validateBatch(
  batch: Batch,
  knownRepos: string[],
  roster: PersonaRegistryEntry[],
  session?: SessionContext,
): Verdict {
  const rejects: string[] = [];
  const repoSet = new Set(knownRepos);

  if (batch.length > MAX_CONCURRENT) {
    rejects.push(`cap-exceeded ${batch.length}`);
  }

  // Session mode has its own, far lower cap, and depends on agentop actually
  // being present/governable — none of which applies to subagent dispatch, so
  // a pure subagent batch must sail through unaffected (even with no `session`
  // context and even when agentop is unavailable).
  const sessionEntries = batch.filter((e) => e.mode === "session");
  if (sessionEntries.length > 0) {
    if (sessionEntries.length > SESSION_MAX_CONCURRENT) {
      rejects.push(`session-cap-exceeded ${sessionEntries.length}`);
    }
    if (!session) {
      // A caller that omits the 4th argument while proposing session-mode
      // entries must not fail open: without a SessionContext there is no way
      // to confirm agentop is reachable or the harness is containable, so the
      // batch is rejected outright rather than silently skipping those checks.
      rejects.push("session-context-missing");
    }
    if (session && !session.agentopOk) {
      rejects.push("agentop-unavailable");
    }
    if (session) {
      const containable = new Set(session.containableHarnesses);
      // Each distinct non-containable harness is reported exactly once — a
      // batch that repeats the same bad harness across units isn't N distinct
      // problems, but two different bad harnesses are two distinct problems.
      const rejectedHarnesses = new Set<string>();
      for (const entry of sessionEntries) {
        const harness = entry.harness ?? session.containableHarnesses[0] ?? "claude-code";
        if (containable.has(harness)) continue;
        if (rejectedHarnesses.has(harness)) continue;
        rejectedHarnesses.add(harness);
        rejects.push(`harness-not-containable ${harness}`);
      }
    }
  }

  const seenKeys = new Set<string>();
  for (const entry of batch) {
    const key = packageFqid(entry.repo, entry.package);
    if (seenKeys.has(key)) {
      rejects.push(entry.package && entry.package !== entry.repo ? `same-package ${key}` : `same-repo ${entry.repo}`);
    }
    seenKeys.add(key);

    if (!repoSet.has(entry.repo)) {
      rejects.push(`unknown-repo ${entry.repo}`);
      continue; // can't check the specialist against an unknown repo
    }

    const known = roster.some(
      (p) =>
        p.repo === entry.repo &&
        p.name.toLowerCase() === entry.specialist.toLowerCase(),
    );
    if (!known) {
      rejects.push(`unknown-specialist ${entry.specialist}@${entry.repo}`);
    }
  }

  return rejects.length === 0 ? { ok: true } : { ok: false, rejects };
}

// ── Cross-repo landing gate (the sequencing invariant, made deterministic) ──
//
// `validateBatch` guards a *single* wave's physical shape. This guards the
// *ordering across* waves: a consumer must not be dispatched until the contract
// it depends on has actually LANDED (its producing unit is `verified`/`merged` in
// the ledger). Ordering the waves is not the same as the contract existing —
// this refuses a consumer whose producer is still open (or, worse, in the same
// wave), so a multi-repo demand never ships a consumer against a contract that
// does not exist yet. A single-session dev never needs this; a coordinator does.
//
// Pure: the caller supplies the graph edges, the set of landed unit fqids (from
// the ledger), and the set of in-context unit fqids (graph nodes). An edge
// `A consumes/imports B` means A depends on B's contract.
export interface DependencyContext {
  edges: { from: string; to: string; type: string }[];
  landed: Set<string>; // unit fqids that are verified/merged
  contextUnits: Set<string>; // all known node fqids (external `to` is skipped)
}

const DEPENDENCY_EDGE_TYPES = new Set(["consumes", "imports"]);

export function checkDependenciesLanded(batch: Batch, ctx: DependencyContext): string[] {
  const rejects: string[] = [];
  const seen = new Set<string>();
  for (const entry of batch) {
    const consumer = packageFqid(entry.repo, entry.package);
    for (const edge of ctx.edges) {
      if (edge.from !== consumer || !DEPENDENCY_EDGE_TYPES.has(edge.type)) continue;
      const producer = edge.to;
      if (!ctx.contextUnits.has(producer)) continue; // external dependency, not ours to gate
      if (ctx.landed.has(producer)) continue; // already landed → the consumer is free
      const key = `${consumer}->${producer}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rejects.push(`dependency-not-landed ${consumer} needs ${producer}`);
    }
  }
  return rejects;
}
