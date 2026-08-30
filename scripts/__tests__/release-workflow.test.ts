import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";

const ROOT = join(import.meta.dir, "..", "..");
const RAW = readFileSync(join(ROOT, ".github", "workflows", "release.yml"), "utf8");

type Step = { name?: string; id?: string; if?: string; run?: string; uses?: string; with?: Record<string, unknown> };
const WF = parse(RAW) as {
  on: { push?: { branches?: string[] }; workflow_dispatch?: unknown };
  jobs: Record<string, { if?: string; concurrency?: { group?: string }; steps: Step[] }>;
};

// Path 4 — the version bump lives on `dev`; `main` is never written to.
//
//   bump    (push to dev)  computes the next version and commits the stamped
//                          bump to dev. dev has no ruleset, so the bot pushes it.
//   release (push to main) publishes: reads the manifest version that arrived
//                          through the promotion PR, builds, and creates the tag
//                          AND the Release together, from the merge commit. It
//                          never commits and never pushes a branch — main's
//                          protection is therefore never in the way.
const RELEASE = WF.jobs.release!;
const BUMP = WF.jobs.bump!;

// ── Triggers ────────────────────────────────────────────────────────────────

test("a merge to main triggers the workflow", () => {
  expect(WF.on.push?.branches).toContain("main");
});

test("a push to dev triggers the workflow (that is where the bump lives)", () => {
  expect(WF.on.push?.branches).toContain("dev");
});

test("the manual valve is still there", () => {
  expect(WF.on.workflow_dispatch).toBeDefined();
});

// ── The core of path 4: the release job never writes to protected main ───────

test("the release job never pushes anything (no write to protected main)", () => {
  const pushes = RELEASE.steps.filter((s) => /git\s+push/.test(s.run ?? ""));
  expect(pushes).toHaveLength(0);
});

test("the release job creates no commit (no bump commit lands on main)", () => {
  const commits = RELEASE.steps.filter((s) => /git\s+commit/.test(s.run ?? ""));
  expect(commits).toHaveLength(0);
});

test("nothing is ever pushed to main", () => {
  expect(RAW).not.toContain("HEAD:main");
});

test("the release job is gated to main / manual dispatch, never to dev", () => {
  expect(RELEASE.if).toBeDefined();
  expect(RELEASE.if).toContain("refs/heads/main");
  expect(RELEASE.if).not.toContain("refs/heads/dev");
});

// ── A tag can never outlive its release: tags are born WITH the release ───────
//
// An orphan tag (v1.10.3, v1.11.0) is a release claimed that never happened.
// The only structural cure is to never create a tag independently of its
// release. The publish action creates the tag AND the release in one API call
// against the merge commit; nothing anywhere runs `git tag <name>`.

test("no tag is ever created by hand — the publish step is the only tag author", () => {
  // `git tag -l` (listing) is fine; `git tag "v…"` / `git tag $…` (creation) is
  // the orphan-tag hazard and must not appear.
  expect(RAW).not.toMatch(/git\s+tag\s+["'$]/);
});

test("the tag is created from the merge commit, together with the release", () => {
  const publish = RELEASE.steps.find((s) => (s.uses ?? "").includes("action-gh-release"));
  expect(publish).toBeDefined();
  const wth = (publish!.with ?? {}) as Record<string, unknown>;
  expect(wth.tag_name).toBeDefined();
  expect(String(wth.target_commitish)).toContain("github.sha");
});

test("the release actually publishes binaries, checksums and installers", () => {
  const publish = RELEASE.steps.find((s) => s.name?.includes("Publish"));
  expect(publish).toBeDefined();
  expect(RAW).toContain("dist/aipe-*");
  expect(RAW).toContain("dist/SHA256SUMS.txt");
  expect(RAW).toContain("scripts/install.sh");
  expect(RAW).toContain("scripts/install.ps1");
});

test("a version that already shipped is not published twice", () => {
  // The manifest version arrives via the promotion PR; a re-push of main whose
  // number already has a tag must stop, not republish.
  const resolve = RELEASE.steps.find((s) => s.id === "version")!;
  expect(resolve.run).toMatch(/refs\/tags\/v/);
  expect(resolve.run).toMatch(/skip=true/);
});

test("runs on main are serialised, so two merges cannot publish the same number", () => {
  expect(RELEASE.concurrency?.group).toBe("release-main");
});

// ── The bump job: decides the version on dev and commits it there ────────────

test("the bump job runs only on a push to dev", () => {
  expect(BUMP.if).toBeDefined();
  expect(BUMP.if).toContain("refs/heads/dev");
  expect(BUMP.if).not.toContain("refs/heads/main");
});

test("the bump commit carries [skip ci] and is authored so it cannot re-trigger", () => {
  expect(RAW).toContain("[skip ci]");
  const guard = BUMP.steps.find((s) => s.id === "guard");
  expect(guard).toBeDefined();
  expect(guard!.run).toContain("github-actions[bot]");
  expect(guard!.run).toContain("chore(release): ");
});

test("a refused bump push on dev fails the job loudly, never in silence", () => {
  const step = BUMP.steps.find((s) => /git push/.test(s.run ?? ""));
  expect(step).toBeDefined();
  expect(step!.run).toContain("::error::");
  expect(step!.run).toMatch(/exit 1/);
  expect(step!.run).not.toMatch(/git push[^\n]*\|\|\s*true/);
});

// ── Only the known skips gate the work in each job ───────────────────────────

test("every gated step in the release job keys off the version-skip output", () => {
  for (const s of RELEASE.steps) {
    if (s.if) expect(s.if).toMatch(/steps\.version\.outputs\.(skip|forced)/);
  }
});

test("every gated step in the bump job keys off the guard / version outputs", () => {
  for (const s of BUMP.steps) {
    if (s.if) expect(s.if).toMatch(/steps\.(guard|version)\.outputs\.(skip|changed)/);
  }
});

// ── The bump must actually see every commit in the range (tformat, scopes) ───
//
// `--pretty=format:` omits the trailing newline after its last line, and
// `while read` returns non-zero on an unterminated line — so that line is
// silently dropped. `git log` prints newest-first, so what is lost is the
// range's OLDEST commit. `tformat:` terminates every line, including the last.

test("no read loop consumes a `format:` stream — it would drop a commit", () => {
  const loops = RAW.split("\n").filter((l) => /while\s+IFS.*read\b/.test(l) || /done\s*<\s*<\(/.test(l));
  expect(loops.length).toBeGreaterThan(0);
  for (const line of loops) {
    expect(line).not.toMatch(/--pretty=format:/);
  }
});

test("the version-computation loop (on dev) uses tformat", () => {
  const version = BUMP.steps.find((s) => s.id === "version")!;
  expect(version.run).toContain("--pretty=tformat:%s");
});

test("the release-notes loop uses tformat", () => {
  const notes = RELEASE.steps.find((s) => s.run?.includes("What's changed in v"))!;
  expect(notes.run).toContain("--pretty=tformat:");
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
