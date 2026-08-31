import { describe, expect, test } from "bun:test";
import { deriveReleaseState } from "../state";
import type { RepoReleaseFacts } from "../types";

// The four cases the spec (j-20260830-zd) names, plus the honesty edges, exercised
// purely: given git facts, does the derivation refuse the comfortable assumption?
function facts(over: Partial<RepoReleaseFacts>): RepoReleaseFacts {
  return {
    flow: "dev-then-main",
    hasRelease: true,
    latestReleaseTag: "v1.11.0",
    unreleasedOnMain: 0,
    unpromotedOnDev: 0,
    releaseBranch: "main",
    integrationBranch: "dev",
    ...over,
  };
}

describe("deriveReleaseState", () => {
  test("merged into dev with no promotion → merged-unpublished (counts the dev backlog)", () => {
    const s = deriveReleaseState("aipe", facts({ unpromotedOnDev: 3, unreleasedOnMain: 0 }));
    expect(s.state).toBe("merged-unpublished");
    expect(s.reason).toContain("3 commit(s) merged into dev not yet in main");
  });

  test("main ahead of the last release tag → merged-unpublished (counts the release backlog)", () => {
    const s = deriveReleaseState("aipe", facts({ unpromotedOnDev: 0, unreleasedOnMain: 2 }));
    expect(s.state).toBe("merged-unpublished");
    expect(s.reason).toContain("2 commit(s) on main beyond v1.11.0");
  });

  test("dev==main and main==latest tag → published", () => {
    const s = deriveReleaseState("aipe", facts({ unpromotedOnDev: 0, unreleasedOnMain: 0 }));
    expect(s.state).toBe("published");
    expect(s.reason).toContain("main is at v1.11.0");
  });

  test("main-direct repo with no release tags → published at main head (not marked unpublished)", () => {
    // The openvibes-embark flow: merging into main IS the release. The resolver
    // hands unreleasedOnMain=0 and unpromotedOnDev=null for main-direct.
    const s = deriveReleaseState(
      "embark",
      facts({ flow: "main-direct", hasRelease: false, latestReleaseTag: null, unreleasedOnMain: 0, unpromotedOnDev: null }),
    );
    expect(s.state).toBe("published");
    expect(s.reason).toContain("no release tags — main head is the published state");
  });

  test("main-direct repo that DOES tag, main ahead of tag → merged-unpublished", () => {
    const s = deriveReleaseState(
      "some-app",
      facts({ flow: "main-direct", unpromotedOnDev: null, unreleasedOnMain: 4 }),
    );
    expect(s.state).toBe("merged-unpublished");
    expect(s.reason).toContain("4 commit(s) on main beyond v1.11.0");
  });

  test("main-direct, release branch unreadable → unknown (says it could not establish)", () => {
    const s = deriveReleaseState(
      "some-app",
      facts({ flow: "main-direct", unpromotedOnDev: null, unreleasedOnMain: null }),
    );
    expect(s.state).toBe("unknown");
    expect(s.reason).toContain("could not be established");
  });

  test("a reachable tag with a gap but an unestablished publish method → unknown, not represado (#74)", () => {
    const s = deriveReleaseState(
      "openvibes-embark",
      facts({ flow: "main-direct", unpromotedOnDev: null, unreleasedOnMain: null, mainBaselineUnverified: { tag: "v1.4.0", ahead: 121 } }),
    );
    expect(s.state).toBe("unknown");
    expect(s.state).not.toBe("merged-unpublished");
    expect(s.reason).toContain("121 commit(s)");
    expect(s.reason).toContain("v1.4.0");
    expect(s.reason).toContain("publish method");
  });

  test("dev-then-main, both counts unreadable → unknown", () => {
    const s = deriveReleaseState("aipe", facts({ unreleasedOnMain: null, unpromotedOnDev: null }));
    expect(s.state).toBe("unknown");
    expect(s.reason).toContain("could not be established");
  });

  test("honesty: a null count with no visible backlog is unknown, never a comfortable published", () => {
    // dev backlog unreadable, release backlog is 0 — we CANNOT conclude published,
    // because the missing dev count could hide unpromoted work.
    const s = deriveReleaseState("aipe", facts({ unreleasedOnMain: 0, unpromotedOnDev: null }));
    expect(s.state).toBe("unknown");
    expect(s.reason).toContain("could not be fully verified");
  });
});
