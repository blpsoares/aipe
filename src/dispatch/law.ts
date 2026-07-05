import { MAX_CONCURRENT } from "./types";
import type { Batch, PersonaRegistryEntry, Verdict } from "./types";

// Pure adjudication of the parallel-dispatch law for a single proposed batch.
// The coordinator owns *sequencing* (which batch runs before which, derived
// from graph.yaml); this only enforces the physical constraints on one batch:
//   - the same repo must not appear twice (same-repo work serializes),
//   - at most MAX_CONCURRENT entries,
//   - every repo and specialist must exist.
// It never reorders — a batch is either lawful as proposed or rejected.
export function validateBatch(
  batch: Batch,
  knownRepos: string[],
  roster: PersonaRegistryEntry[],
): Verdict {
  const rejects: string[] = [];
  const repoSet = new Set(knownRepos);

  if (batch.length > MAX_CONCURRENT) {
    rejects.push(`cap-exceeded ${batch.length}`);
  }

  const seenRepos = new Set<string>();
  for (const entry of batch) {
    if (seenRepos.has(entry.repo)) {
      rejects.push(`same-repo ${entry.repo}`);
    }
    seenRepos.add(entry.repo);

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
