import type { BrainFile, RepoReport } from "./types";

export function backfillStack(brain: BrainFile, reports: RepoReport[]): BrainFile {
  const stackByRepo = new Map(reports.map((r) => [r.repo, r.stack]));

  return {
    ...brain,
    repos: brain.repos.map((repo) => {
      if (repo.stack && repo.stack.length > 0) return repo;
      const detected = stackByRepo.get(repo.name);
      return detected && detected.length > 0 ? { ...repo, stack: detected } : repo;
    }),
  };
}
