// Hiring is the first moment AIPe writes into someone else's repository, and it
// used to do so with `.claude/` plain untracked: a `git add -A` in the onboarded
// repo would commit the entire persona roster into the OFFICIAL repository.
//
// The exclusion existed — `ensureReposExcludeClaude` — and ran only from
// `rehydrate`, which happens later or not at all. Same shape as every defect
// this repo has been paying for: the protection was real and was not on the
// path. This test pins the ORDERING, which is the part that matters — the
// exclusion has to be in place before the first persona file lands.
import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stringify } from "yaml";
import { run as git } from "../../worktree/git";
import { runHireSpecialists } from "../run";

test("hiring puts `.claude/` in the repo's exclude — the personas never become committable", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-hire-exclude-"));
  const repo = join(dir, "demo");
  await mkdir(repo, { recursive: true });
  await git(["git", "-C", repo, "init", "-q"]);
  await git(["git", "-C", repo, "config", "user.email", "t@t"]);
  await git(["git", "-C", repo, "config", "user.name", "t"]);
  await writeFile(join(repo, "README.md"), "# demo\n", "utf8");
  await git(["git", "-C", repo, "add", "-A"]);
  await git(["git", "-C", repo, "commit", "-qm", "init"]);

  await mkdir(join(dir, ".aipe"), { recursive: true });
  await writeFile(
    join(dir, ".aipe", "brain.yaml"),
    stringify({
      context: { name: "demo", coordinator: "Nicolas", pe: "p" },
      repos: [{ name: "demo", url: "https://x/demo.git", path: "./demo", stack: ["TypeScript"], kind: "lib" }],
    }),
    "utf8",
  );
  const reportsDir = join(dir, ".aipe", "specialists", ".reports");
  await mkdir(reportsDir, { recursive: true });
  await writeFile(join(reportsDir, "demo-dev-fullstack.json"), JSON.stringify({ repo: "demo", role: "dev-fullstack", name: "Jesse", body: "You are Jesse." }));
  await writeFile(join(reportsDir, "demo-qa.json"), JSON.stringify({ repo: "demo", role: "qa", name: "Getz", body: "You are Getz." }));

  const result = await runHireSpecialists(dir);
  expect(result.ok).toBe(true);

  // the personas ARE on disk…
  expect(await readFile(join(repo, ".claude", "skills", "jesse", "SKILL.md"), "utf8")).toContain("Jesse");

  // …and git cannot see them. This is the assertion that matters: not that a
  // line exists in a config file, but that a `git add -A` in the official
  // repository would pick up nothing.
  const status = await git(["git", "-C", repo, "status", "--porcelain"]);
  expect(status.stdout.trim()).toBe("");
  const tracked = await git(["git", "-C", repo, "ls-files", ".claude"]);
  expect(tracked.stdout.trim()).toBe("");
});
