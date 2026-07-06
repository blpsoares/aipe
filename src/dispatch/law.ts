import { packageFqid } from "../context-brain/packages";
import { MAX_CONCURRENT } from "./types";
import type { Batch, PersonaRegistryEntry, Verdict } from "./types";

// Pure adjudication of the parallel-dispatch law for a single proposed batch.
// The coordinator owns *sequencing* (which batch runs before which, derived
// from graph.yaml); this only enforces the physical constraints on one batch:
//   - the same *module* (unit of work) must not appear twice — same-unit work
//     serializes, while distinct packages of one monorepo run in parallel,
//   - at most MAX_CONCURRENT entries,
//   - every repo and specialist must exist.
// A module-less entry is the implicit whole-repo module, so its key is the bare
// repo name — identical to the pre-module behaviour.
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

  const seenKeys = new Set<string>();
  for (const entry of batch) {
    const key = packageFqid(entry.repo, entry.module);
    if (seenKeys.has(key)) {
      rejects.push(entry.module && entry.module !== entry.repo ? `same-module ${key}` : `same-repo ${entry.repo}`);
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
