// Write-time normalization of a dispatch's identity fields (j-20260829-dp, item
// 5). The ledger's upsert key is (repo, package, task, specialist); the same work
// was recorded as TWO units because the two ends spelled the key differently —
// the coordinator writes `Jane` + `--package` with the bare repo, while the
// specialist auto-registers as `jane` (its skill slug), often without `--package`
// and with the repo ORG-PREFIXED (`blpsoares/agentistics`). Normalizing the repo
// and the specialist AT WRITE TIME collapses the two spellings onto one key, so
// the duplicate never gets created — the fix is in the DATA, not painted over in
// the view (which would leave `status`/`verify` still miscounting).
import type { PersonaRegistryEntry } from "../hire-specialists/types";
import type { JourneyDispatch } from "./types";

/**
 * The bare repo name. A ledger `repo` is a single token; a slash means an
 * owner/org prefix crept in (`blpsoares/agentistics`) — the last segment is the
 * canonical repo. The `package` axis is a SEPARATE field, so a repo never legit-
 * imately carries a "/". Idempotent: an already-bare name is returned unchanged.
 */
export function normalizeRepo(repo: string): string {
  const tail = repo.split("/").pop();
  return (tail && tail.length ? tail : repo).trim();
}

/**
 * The canonical specialist name, resolved case-insensitively against the roster
 * (`personas.yaml`) — so `jane` and `Jane` both become the one spelling the
 * roster records. An unknown name round-trips trimmed, never guessed (a name the
 * roster doesn't carry is reported as-is, exactly like status/assemble's role
 * lookup).
 */
export function normalizeSpecialist(name: string, roster: PersonaRegistryEntry[]): string {
  const n = name.trim();
  const hit = roster.find((p) => p.name.trim().toLowerCase() === n.toLowerCase());
  return hit ? hit.name : n;
}

/** Canonicalize the two identity fields that caused the jane/Jane split. */
export function canonicalizeDispatch(d: JourneyDispatch, roster: PersonaRegistryEntry[]): JourneyDispatch {
  return { ...d, repo: normalizeRepo(d.repo), specialist: normalizeSpecialist(d.specialist, roster) };
}
