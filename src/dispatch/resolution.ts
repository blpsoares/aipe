// The managed exception (j-20260826-xj). When two claims in one repo overlap on
// a path, it is NOT a hard error — it is a serialization with a defined recovery.
// This module makes that recovery a deterministic, testable plan instead of prose
// a coordinator has to remember: the second task WAITS for the first, REBASES its
// branch onto the holder's landed work, the agent (holding BOTH orientation specs)
// RESOLVES the conflict, and the pre-approval quality review runs OVER THE MERGED
// RESULT — the net that catches both a bad textual merge and a semantic breakage.
// (Registered PE decision: without that net, dirt accumulates. Do not invent
// another recovery.)

export interface OverlapResolution {
  // The branch that must yield — always the later claimant (the one that hit the
  // collision), never the holder that is already at work.
  waiter: string;
  // The branch it rebases onto — the holder of the overlapping path.
  onto: string;
  // The overlapping paths, for the record and for the agent resolving by hand.
  paths: string[];
  // The ordered, deterministic recovery. Each step is a single imperative a
  // coordinator (or a CLI) can follow without judgement.
  steps: { action: "wait" | "rebase" | "resolve" | "review-over-merge"; detail: string }[];
}

export function planOverlapResolution(input: {
  waiterBranch: string;
  holderBranch: string;
  paths: string[];
}): OverlapResolution {
  const { waiterBranch, holderBranch, paths } = input;
  const on = paths.length ? paths.join(", ") : "the whole unit";
  return {
    waiter: waiterBranch,
    onto: holderBranch,
    paths,
    steps: [
      {
        action: "wait",
        detail: `${waiterBranch} waits: ${holderBranch} holds the overlapping path(s) ${on} — do not write them concurrently.`,
      },
      {
        action: "rebase",
        detail: `once ${holderBranch} has landed, rebase ${waiterBranch} onto it: git -C <worktree> rebase ${holderBranch}.`,
      },
      {
        action: "resolve",
        detail: `the agent — which carries the orientation spec of BOTH tasks — resolves the conflicts on ${on} by hand.`,
      },
      {
        action: "review-over-merge",
        detail: `run the pre-approval quality review on the REBASED result (not on either branch alone): it must catch a bad textual merge AND a semantic break.`,
      },
    ],
  };
}
