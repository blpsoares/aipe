// The coordinator-identity half of the SessionStart awareness (j-20260829-5q).
//
// When a fully-onboarded coordinator session opens, it REGISTERS itself in the
// workspace and learns whether it is the only coordinator, a reconnect to a
// left-behind identity, or a second live coordinator. The result is one prose
// line appended to the awareness block. Everything here is best-effort and
// fully guarded: the SessionStart hook runs before anything else, so a workspace
// mid-onboarding or a broken registry must DEGRADE to no line, never crash the
// session open.
import { claimCoordinator, renderCoordinatorAwareness } from "../runtime/coordinator";
import type { Fields } from "./read-state";

// The agentop session name is what the event-watches address (`--notify`). AIPe
// cannot always know it (agentop does not stamp it into the environment — the
// documented limit), so it prefers an explicit env value and otherwise falls
// back to the coordinator's own name as a best-effort continuity key.
export function pickSessionName(env: Record<string, string | undefined>, coordinator: string): string {
  const fromEnv = (env.AGENTOP_SESSION_NAME ?? "").trim();
  return fromEnv || coordinator;
}

// A verifiable process identity for the session, when the harness supplies one.
// Absent ⇒ 0 ⇒ UNVERIFIABLE ⇒ treated as alive downstream (the safe inverse): a
// missing pid must never let a rival read this coordinator as dead.
export function pickPid(env: Record<string, string | undefined>): number {
  for (const key of ["AIPE_SESSION_PID", "AGENTOP_SESSION_PID"]) {
    const raw = env[key];
    if (raw && Number.isInteger(Number(raw)) && Number(raw) > 0) return Number(raw);
  }
  return 0;
}

export async function coordinatorAwareness(
  fields: Fields,
  env: Record<string, string | undefined> = process.env,
): Promise<string> {
  const onboarded =
    fields.brain === "present" &&
    fields.phaseWorkspace === "done" &&
    fields.phaseRelationship === "done" &&
    fields.phaseSpecialists === "done";
  // No coordinator to register before onboarding completes, nothing to summarize
  // without a root, and no name to register without a coordinator.
  if (!onboarded || !fields.root || !fields.coordinator) return "";
  try {
    const res = await claimCoordinator(fields.root, {
      name: fields.coordinator,
      sessionName: pickSessionName(env, fields.coordinator),
      pid: pickPid(env),
    });
    // Do not announce an identity we could not actually register, but DO still
    // surface a live-collision we observed by reading (persist failing does not
    // make a second coordinator less real).
    if (!res.persisted && res.others.length === 0) return "";
    return renderCoordinatorAwareness(res);
  } catch {
    return ""; // degrade — never break SessionStart
  }
}
