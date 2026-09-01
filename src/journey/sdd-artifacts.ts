// The real SDD-artifact resolver for the delivery gate (#118). It answers ONE
// question with no network and no judgement: does this worktree carry a spec and
// a plan COMMITTED under specs/? "Committed" (not merely present on disk) is the
// contract — the artifacts must be in the PR the delivery claims — so it reads
// git's HEAD tree, not the working directory. A worktree with no commits yet
// (no HEAD) has no committed artifacts, which is the correct "missing", not an
// error. Never throws: any git failure degrades to "not found", so the gate
// refuses rather than fabricates a pass.
import type { SddArtifactResolver } from "./ledger";

async function committedFiles(worktree: string): Promise<string[]> {
  try {
    const proc = Bun.spawn(["git", "-C", worktree, "ls-tree", "-r", "--name-only", "HEAD", "--", "specs"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const [out, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
    if (code !== 0) return [];
    return out.split("\n").map((l) => l.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

// A committed spec-kit artifact is `specs/<anything>/spec.md` (or `plan.md`) —
// the layout `/speckit.specify` → `/speckit.plan` write. Matched by basename
// under specs/ so a nested feature directory (`specs/118-x/spec.md`) counts.
export const resolveSddArtifactsGit: SddArtifactResolver = async (worktree: string) => {
  const files = await committedFiles(worktree);
  const has = (base: string) => files.some((f) => f.startsWith("specs/") && f.endsWith(`/${base}`));
  return { spec: has("spec.md"), plan: has("plan.md") };
};
