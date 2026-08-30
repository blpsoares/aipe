// Reads the workspace and produces the assembled `StatusReport`. This is the one
// I/O boundary the three surfaces share: `aipe status` (item 3), the post-change
// delta (item 9) and the SessionStart state block (item 8) all call `loadReport`,
// so none re-derives. Every reader it calls already degrades cleanly on a missing
// or half-written workspace (item 6), so this never throws on a partial one.
import { readPersonas } from "../hire-specialists/read-personas";
import { listJourneys } from "../journey/ledger";
import { readBrain } from "../make-workspace/read";
import { readPolicy } from "../model/policy";
import { realReleaseResolver } from "../release/git";
import { resolveReleaseStates } from "../release/resolve";
import type { ReleaseResolver, RepoReleaseState } from "../release/types";
import { realRunner } from "../session/runner";
import type { AgentopRunner } from "../session/types";
import { assemble } from "./assemble";
import { resolveLiveSessions, type LiveSessions } from "./liveness";
import { resolveStatusPref } from "./pref";
import { selectJourneys } from "./scope";
import type { StatusReport, StatusScope } from "./types";

const NO_LIVE: LiveSessions = { source: "none", reliable: false, sessions: new Map() };
const NO_RELEASES = new Map<string, RepoReleaseState>();

export interface LoadOptions {
  scope: StatusScope;
  journeyId?: string;
  runner?: AgentopRunner;
  recentClosed?: number;
  // When false, agentop is NOT consulted — the SessionStart hook (item 8) must be
  // fast and must never hang on a probe, so it reports state from the ledger
  // alone and leaves session liveness unresolved.
  liveness?: boolean;
  // When false, local git is NOT consulted for release state — same reason as
  // liveness: the hook hot path must not shell out per repo. Release state is then
  // empty (no represado section, publishState null), never a guessed verdict.
  release?: boolean;
  releaseResolver?: ReleaseResolver;
}

export async function loadReport(workspace: string, opts: LoadOptions): Promise<StatusReport> {
  const [ledgers, roster, policy, brain] = await Promise.all([
    listJourneys(workspace),
    readPersonas(workspace),
    readPolicy(workspace),
    readBrain(workspace),
  ]);
  const context = brain.ok ? brain.brain.context : undefined;
  const contextName = brain.ok ? String(brain.brain.context.name ?? "") : "";
  const pref = resolveStatusPref(context);
  const { selected, elision, scope } = selectJourneys(ledgers, {
    scope: opts.scope,
    journeyId: opts.journeyId,
    recentClosed: opts.recentClosed,
  });
  // Release state, item 2. Resolved only for the repos actually touched by the
  // selected journeys (never the whole brain), and only when release is on — the
  // hook hot path (release:false) skips the per-repo git entirely.
  const reposInScope = new Set<string>();
  for (const l of selected) for (const d of l.dispatches) reposInScope.add(d.repo);
  const repos = brain.ok ? brain.brain.repos.filter((r) => reposInScope.has(r.name)) : [];
  const releaseStates =
    opts.release === false || repos.length === 0
      ? NO_RELEASES
      : await resolveReleaseStates(workspace, repos, opts.releaseResolver ?? realReleaseResolver);

  const live = opts.liveness === false ? NO_LIVE : await resolveLiveSessions(opts.runner ?? realRunner);
  return assemble({ workspace, contextName, scope, ledgers: selected, roster, policy, live, pref, elision, releaseStates });
}
