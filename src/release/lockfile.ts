// The lockfile preflight behind `aipe release promote` (onda3 #86). The bug it
// guards: a release that stamps a version can leave `bun.lock` out of step with
// the manifest, so the very NEXT PR fails CI on `bun install --frozen-lockfile`
// ("Verify the lockfile is unchanged") — a drift the release itself introduced,
// surfacing far from its cause. The fix is to run that exact CI enforcement as a
// preflight, BEFORE the promotion PR is opened, so the drift is caught at its
// source and named, instead of exploding red on an unrelated commit later.
//
// The check IS the CI gate, not an approximation of it: `bun install
// --frozen-lockfile` exits non-zero iff the committed lock does not already
// satisfy the manifest — that is precisely what the CI step asserts. The command
// runner is injected so the verdict logic is testable offline; the default runs
// real bun against the repo directory.

export type Run = (cmd: string[], cwd: string) => Promise<{ code: number; stdout: string; stderr: string }>;

export const realRun: Run = async (cmd, cwd) => {
  const proc = Bun.spawn(cmd, { cwd, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const code = await proc.exited;
  return { code, stdout: stdout.trim(), stderr: stderr.trim() };
};

export interface LockfileCheck {
  clean: boolean;
  reason: string; // a plain sentence a human reads on the promote report
}

// Runs `bun install --frozen-lockfile` in the repo. Exit 0 ⇒ the lock already
// agrees with the manifest (clean). Non-zero ⇒ the frozen install was refused
// because the lock would have to change — the same failure a following PR's CI
// would hit, caught here instead. The bun stderr is folded into the reason so
// the operator sees WHAT drifted, not just that something did.
export async function checkLockfileClean(repoAbs: string, run: Run = realRun): Promise<LockfileCheck> {
  const r = await run(["bun", "install", "--frozen-lockfile"], repoAbs);
  if (r.code === 0) {
    return { clean: true, reason: "bun.lock agrees with the manifest (bun install --frozen-lockfile passed)" };
  }
  const detail = (r.stderr || r.stdout).split("\n").map((l) => l.trim()).filter(Boolean).slice(-3).join(" — ");
  return {
    clean: false,
    reason: `bun.lock is out of step with the manifest — bun install --frozen-lockfile was refused${detail ? `: ${detail}` : ""}. Run \`bun install\` and commit bun.lock before promoting, or CI's lockfile check will fail on the next PR.`,
  };
}
