import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RepoEntry } from "../../context-brain/types";
import { realReleaseResolver } from "../git";

// The strongest evidence for a git-derived fact is REAL git. Each case builds an
// actual repo with the branch/tag topology the spec (j-20260830-zd) names, then
// asks the real resolver — no fakes, no mocks of git.

const dirs: string[] = [];
afterAll(async () => {
  for (const d of dirs) await rm(d, { recursive: true, force: true });
});

async function run(cmd: string[]): Promise<{ code: number; stdout: string }> {
  const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe" });
  const out = await new Response(proc.stdout).text();
  return { code: await proc.exited, stdout: out.trim() };
}

async function initRepo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "aipe-release-"));
  dirs.push(dir);
  await run(["git", "-C", dir, "init", "-q", "-b", "main"]);
  await run(["git", "-C", dir, "config", "user.email", "t@t.dev"]);
  await run(["git", "-C", dir, "config", "user.name", "t"]);
  await run(["git", "-C", dir, "config", "commit.gpgsign", "false"]);
  return dir;
}

let counter = 0;
async function commit(dir: string, branch = "main"): Promise<void> {
  await run(["git", "-C", dir, "checkout", "-q", branch]);
  await writeFile(join(dir, `f${counter}.txt`), String(counter));
  counter++;
  await run(["git", "-C", dir, "add", "-A"]);
  await run(["git", "-C", dir, "commit", "-q", "-m", `c${counter}`]);
}

const repo = (name: string, publish?: RepoEntry["publish"]): RepoEntry => ({
  name,
  url: "x",
  path: ".",
  ...(publish ? { publish } : {}),
});

describe("realReleaseResolver (real git)", () => {
  test("dev-then-main, dev==main==latest tag → published", async () => {
    const dir = await initRepo();
    await commit(dir);
    await run(["git", "-C", dir, "tag", "v1.0.0"]);
    await run(["git", "-C", dir, "branch", "dev"]); // dev at main, 0 ahead
    const s = await realReleaseResolver(repo("aipe"), dir);
    expect(s.state).toBe("published");
  });

  test("dev-then-main, dev ahead of main → merged-unpublished (unpromoted)", async () => {
    const dir = await initRepo();
    await commit(dir);
    await run(["git", "-C", dir, "tag", "v1.0.0"]);
    await run(["git", "-C", dir, "branch", "dev"]);
    await commit(dir, "dev");
    await commit(dir, "dev"); // dev now 2 ahead of main
    const s = await realReleaseResolver(repo("aipe"), dir);
    expect(s.flow).toBe("dev-then-main");
    expect(s.state).toBe("merged-unpublished");
    expect(s.unpromotedOnDev).toBe(2);
    expect(s.reason).toContain("2 commit(s) merged into dev not yet in main");
  });

  test("main ahead of the last release tag, publish established as tag → merged-unpublished (unreleased)", async () => {
    const dir = await initRepo();
    await commit(dir);
    await run(["git", "-C", dir, "tag", "v1.0.0"]);
    await commit(dir); // main now 1 commit beyond the tag
    // The represado-by-tag claim is only made once the repo's method is ESTABLISHED
    // as tag-release (the PE's registration) — otherwise a push-published repo and
    // a tag-release backlog are indistinguishable here (see the #74 case below).
    const s = await realReleaseResolver(repo("aipe", { releaseVia: "tag" }), dir);
    expect(s.state).toBe("merged-unpublished");
    expect(s.unreleasedOnMain).toBe(1);
    expect(s.reason).toContain("1 commit(s) on main beyond v1.0.0");
  });

  test("the baseline is the highest tag REACHABLE from main — an unreachable (upstream) tag is ignored (#75)", async () => {
    // openvibes-embark's real shape: v1.5.0/v1.5.1 exist in the object DB (fetched
    // from the `upstream` remote) but are NOT reachable from this repo's main; the
    // highest tag on main's own lineage is v1.4.0. The baseline must be v1.0.0
    // here (reachable), never a tag that only lives in the object pool.
    const dir = await initRepo();
    await commit(dir); // c1 on main
    await run(["git", "-C", dir, "tag", "v1.0.0"]); // reachable
    await commit(dir); // c2 on main — 1 beyond v1.0.0
    // A divergent branch carrying a HIGHER tag that never merges into main.
    await run(["git", "-C", dir, "checkout", "-q", "-b", "upstream-ish"]);
    await commit(dir, "upstream-ish");
    await run(["git", "-C", dir, "tag", "v2.0.0"]); // NOT reachable from main
    await run(["git", "-C", dir, "checkout", "-q", "main"]);

    const s = await realReleaseResolver(repo("aipe", { releaseVia: "tag" }), dir);
    expect(s.latestReleaseTag).toBe("v1.0.0"); // the reachable one, not v2.0.0
    expect(s.unreleasedOnMain).toBe(1); // v1.0.0..main, not v2.0.0..main (=2)
    expect(s.reason).toContain("beyond v1.0.0");
  });

  test("reachable tag with commits beyond it but NO established publish method → unknown, not a false REPRESADO (#74)", async () => {
    // The openvibes-embark false alarm: an old reachable tag (v1.4.0) sits far
    // behind main because the repo publishes by PUSH-deploy, not by cutting tags.
    // Absent an established method, a tag-release backlog and a push-published repo
    // look identical from git — so the honest verdict is "unknown", never REPRESADO.
    const dir = await initRepo();
    await commit(dir);
    await run(["git", "-C", dir, "tag", "v1.0.0"]);
    await commit(dir);
    await commit(dir);
    await commit(dir); // main 3 beyond the tag, publish method NOT registered
    const s = await realReleaseResolver(repo("openvibes-embark"), dir);
    expect(s.state).toBe("unknown");
    expect(s.state).not.toBe("merged-unpublished");
    expect(s.reason).toContain("publish method");
    expect(s.reason.toLowerCase()).toContain("releasevia");
  });

  test("publish established as push-deploy → published at main head even with an old tag behind (#74)", async () => {
    // Once the PE establishes the repo publishes by push, an ancient tag left on
    // the lineage is not a backlog: the head IS the published state.
    const dir = await initRepo();
    await commit(dir);
    await run(["git", "-C", dir, "tag", "v1.0.0"]);
    await commit(dir);
    await commit(dir); // 2 beyond the tag
    const s = await realReleaseResolver(repo("openvibes-embark", { releaseVia: "push" }), dir);
    expect(s.state).toBe("published");
    expect(s.unreleasedOnMain).toBe(0);
  });

  test("main-direct repo (no dev, no tags) → published at main head (the embark flow)", async () => {
    const dir = await initRepo();
    await commit(dir);
    await commit(dir);
    const s = await realReleaseResolver(repo("embark"), dir);
    expect(s.flow).toBe("main-direct");
    expect(s.state).toBe("published");
    expect(s.reason).toContain("no release tags — main head is the published state");
  });

  test("ABANDONED dev (behind main, 0 ahead) is NOT a permanent false represado", async () => {
    // The embark-me case the coordinator measured: a `dev` branch exists but is
    // stale — behind main, nothing ahead. Keying on dev-ahead (not mere
    // existence) reads this as main-direct, so merged-into-main work is published,
    // never marked represado forever.
    const dir = await initRepo();
    await commit(dir); // c1
    await run(["git", "-C", dir, "branch", "dev"]); // dev forks at c1
    await commit(dir); // c2 on main
    await commit(dir); // c3 on main — dev now 2 behind, 0 ahead
    const s = await realReleaseResolver(repo("embark-me"), dir);
    expect(s.flow).toBe("main-direct");
    expect(s.state).toBe("published");
    expect(s.unpromotedOnDev).toBeNull();
  });

  test("release state cannot be established → unknown (says so)", async () => {
    // No release branch resolves (repo's default branch is not `main`) and no tags.
    const dir = await mkdtemp(join(tmpdir(), "aipe-release-"));
    dirs.push(dir);
    await run(["git", "-C", dir, "init", "-q", "-b", "trunk"]);
    await run(["git", "-C", dir, "config", "user.email", "t@t.dev"]);
    await run(["git", "-C", dir, "config", "user.name", "t"]);
    await run(["git", "-C", dir, "config", "commit.gpgsign", "false"]);
    await writeFile(join(dir, "a.txt"), "a");
    await run(["git", "-C", dir, "add", "-A"]);
    await run(["git", "-C", dir, "commit", "-q", "-m", "c"]);
    const s = await realReleaseResolver(repo("weird"), dir);
    expect(s.state).toBe("unknown");
    expect(s.reason).toContain("could not be established");
  });

  test("brain override main-direct wins over auto-detection (dev backlog ignored)", async () => {
    const dir = await initRepo();
    await commit(dir);
    await run(["git", "-C", dir, "tag", "v1.0.0"]);
    await run(["git", "-C", dir, "branch", "dev"]);
    await commit(dir, "dev"); // dev 1 ahead — auto-detect would call this represado
    const auto = await realReleaseResolver(repo("pinned"), dir);
    expect(auto.state).toBe("merged-unpublished");
    const pinned = await realReleaseResolver(repo("pinned", { flow: "main-direct" }), dir);
    expect(pinned.flow).toBe("main-direct");
    expect(pinned.state).toBe("published");
  });
});
