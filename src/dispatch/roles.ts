// Whether a role WRITES to the repo it is dispatched against — the single fact
// the concurrency law turns on. A role that writes must serialize on its unit
// (two writers can collide over the same files); a role that only reads —
// reviews a diff, runs tests, drives a page, returns a verdict — cannot collide,
// so N of them may run on one unit at once, each on a distinct task.
//
// This is stated in terms of *writes / does not write*, NOT a hardcoded list of
// persona names, so it survives a future role: to make a new read-only role
// concurrent, add it to NON_WRITING_ROLES; everything downstream (the law, the
// per-task claim lock) follows without change.
import type { PersonaRole } from "../hire-specialists/types";

// Roles that write NOTHING to the repo. A `qa` reads the diff, runs the suite,
// exercises the change and records a verdict — it never commits. (The coordinator
// is never a dispatched unit, so it is irrelevant here.)
export const NON_WRITING_ROLES = new Set<string>(["qa"]);

// True when a dispatch of this role may mutate the repo. Unknown/absent role ⇒
// treated as writing: the safe default is to serialize, never to hand out
// concurrency we cannot justify.
export function roleWritesToRepo(role: PersonaRole | "coordinator" | string | undefined): boolean {
  if (!role) return true;
  return !NON_WRITING_ROLES.has(role);
}
