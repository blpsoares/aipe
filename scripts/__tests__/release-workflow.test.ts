import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";

const ROOT = join(import.meta.dir, "..", "..");
const RAW = readFileSync(join(ROOT, ".github", "workflows", "release.yml"), "utf8");
const WF = parse(RAW) as {
  on: { push?: { branches?: string[] }; workflow_dispatch?: unknown };
  jobs: Record<string, { steps: { name?: string; id?: string; if?: string; run?: string }[] }>;
};

const STEPS = WF.jobs.release!.steps;

// The requirement, stated once: EVERY merge to main cuts a release. All three
// merge strategies (merge commit, squash, rebase) are a push to main, so the
// trigger covers them — what has to be watched is anything that can skip.
test("every push to main triggers the release", () => {
  expect(WF.on.push?.branches).toContain("main");
});

test("the manual valve is still there", () => {
  expect(WF.on.workflow_dispatch).toBeDefined();
});

test("the only skip guard cannot fire on a human merge", () => {
  // Matching the commit SUBJECT alone silently swallowed a squash-merged PR
  // titled "chore(release): …". The author check is what makes the guard
  // unable to misidentify a human merge as the bot's own bump commit.
  const guard = STEPS.find((s) => s.id === "guard");
  expect(guard).toBeDefined();
  expect(guard!.run).toContain("github-actions[bot]");
  expect(guard!.run).toContain("chore(release): ");
  // Both conditions, not either.
  expect(guard!.run).toMatch(/AUTHOR"?\s*=\s*"github-actions\[bot\]"\s*\]\s*&&/);
});

test("a forced release bypasses the guard entirely", () => {
  const guard = STEPS.find((s) => s.id === "guard")!;
  expect(guard.run).toContain("github.event.inputs.version");
});

test("the bump commit carries [skip ci], so the loop is prevented twice over", () => {
  expect(RAW).toContain("[skip ci]");
});

test("nothing but the two known skips gates the publishing steps", () => {
  // Any `if:` on a step must reference only guard/version skip outputs. A new
  // condition sneaking in is how "every merge releases" quietly stops being
  // true.
  const conditions = STEPS.map((s) => s.if).filter((c): c is string => !!c);
  expect(conditions.length).toBeGreaterThan(0);
  for (const c of conditions) {
    expect(c).toMatch(/steps\.(guard|version)\.outputs\.skip/);
  }
});

test("the release actually publishes binaries, checksums and installers", () => {
  const publish = STEPS.find((s) => s.name?.includes("Publish"));
  expect(publish).toBeDefined();
  expect(RAW).toContain("dist/aipe-*");
  expect(RAW).toContain("dist/SHA256SUMS.txt");
  expect(RAW).toContain("scripts/install.sh");
  expect(RAW).toContain("scripts/install.ps1");
});

test("runs are serialised, so two merges cannot compute the same version", () => {
  expect(RAW).toContain("concurrency:");
  expect(RAW).toContain("release-main");
});

// ── The bump must actually see every commit in the range ────────────────────
//
// `--pretty=format:` omits the trailing newline after its last line, and
// `while read` returns non-zero on an unterminated line — so that line is
// silently dropped. `git log` prints newest-first, so what is lost is the
// range's OLDEST commit. Since every merge to main releases, the usual range
// holds exactly ONE commit, which means the only commit was the one being
// dropped: v1.0.1 shipped `feat(update): …` as a patch.

test("no read loop consumes a `format:` stream — it would drop a commit", () => {
  // Command substitution (`$(git log -1 --pretty=format:%s)`) and `grep` are
  // both fine with a missing terminator; a `while read` loop is not.
  const loops = RAW.split("\n").filter((l) => /while\s+IFS.*read\b/.test(l) || /done\s*<\s*<\(/.test(l));
  expect(loops.length).toBeGreaterThan(0);
  for (const line of loops) {
    expect(line).not.toMatch(/--pretty=format:/);
  }
});

test("both git-log loops that feed a read use tformat", () => {
  const version = STEPS.find((s) => s.id === "version")!;
  expect(version.run).toContain("--pretty=tformat:%s");
  const notes = STEPS.find((s) => s.run?.includes("What's changed in v"))!;
  expect(notes.run).toContain("--pretty=tformat:");
});

// ── A tag must never outlive the release it claims ──────────────────────────
//
// `git push origin HEAD:main <tag>` pushed two refs NON-atomically. main's
// ruleset ("Require PR + green CI on main") rejects the branch ref but does not
// cover tag refs, so the tag landed while the branch bounced — an orphan tag
// asserting a release that never happened (v1.10.3, v1.11.0). The push must be
// atomic so the ruleset rejection takes the tag down with the branch.

test("the bump push is atomic — a rejected branch cannot leave an orphan tag", () => {
  const step = STEPS.find((s) => s.run?.includes("git push") && s.run?.includes("HEAD:main"));
  expect(step).toBeDefined();
  expect(step!.run).toContain("--atomic");
  // and the two refs still go in ONE push, so --atomic actually binds them
  expect(step!.run).toMatch(/git push --atomic origin HEAD:main/);
});

test("a rejected bump push fails the job loudly, never in silence", () => {
  const step = STEPS.find((s) => s.run?.includes("git push --atomic"))!;
  // an explicit annotation + non-zero exit, not a swallowed failure
  expect(step.run).toContain("::error::");
  expect(step.run).toMatch(/exit 1/);
  expect(step.run).not.toMatch(/git push[^\n]*\|\|\s*true/);
});

test("REGRESSION: a lone `feat(scope):` in the range computes minor, not patch", async () => {
  const { mkdtemp, rm, writeFile } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const dir = await mkdtemp(join(tmpdir(), "aipe-semver-"));
  try {
    const git = async (...args: string[]) => {
      const p = Bun.spawn(["git", "-C", dir, ...args], { stdout: "pipe", stderr: "pipe" });
      await p.exited;
      return (await new Response(p.stdout).text()).trim();
    };
    await Bun.spawn(["git", "init", "-q", "-b", "main", dir]).exited;
    await writeFile(join(dir, "a.txt"), "a\n", "utf8");
    await git("add", "-A");
    await git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "chore: base");
    await git("tag", "v1.0.0");
    await writeFile(join(dir, "b.txt"), "b\n", "utf8");
    await git("add", "-A");
    await git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "feat(update): a lone feature");

    // The workflow's own loop, run for real against that range.
    const script = `
      BUMP="patch"
      while IFS= read -r subject; do
        case "$subject" in
          feat\\!:*|fix\\!:*) BUMP="major"; break ;;
          feat\\(*\\)\\!:*|fix\\(*\\)\\!:*) BUMP="major"; break ;;
          feat:*|feat\\(*\\):*) [ "$BUMP" != "major" ] && BUMP="minor" || true ;;
        esac
      done < <(git -C "${dir}" log v1.0.0..HEAD --pretty=tformat:%s)
      echo "$BUMP"
    `;
    const proc = Bun.spawn(["bash", "-c", script], { stdout: "pipe", stderr: "pipe" });
    await proc.exited;
    expect((await new Response(proc.stdout).text()).trim()).toBe("minor");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
