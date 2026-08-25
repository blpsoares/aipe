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
