import { describe, expect, test } from "bun:test";
import {
  promote,
  queryPublishedRegistry,
  readManifestVersionAtRef,
  resolveSlugFromRemote,
  run,
  type PromoteDeps,
  type PromoteOpts,
} from "../cli";
import type { GitRun } from "../git";
import type { PublishedFacts } from "../promote";

const PUBLISHED: PublishedFacts = { tagExists: true, releaseExists: true, releaseIsDraft: false };
const ABSENT: PublishedFacts = { tagExists: false, releaseExists: false, releaseIsDraft: null };

function baseDeps(over: Partial<PromoteDeps> = {}): PromoteDeps {
  return {
    resolveSlug: async () => "blpsoares/aipe",
    readManifestVersion: async () => "1.13.2",
    queryPublished: async () => ABSENT,
    checkLock: async () => ({ clean: true, reason: "ok" }),
    promoteAction: async () => ({ ok: true, detail: "merged" }),
    sleep: async () => {},
    ...over,
  };
}

function baseOpts(over: Partial<PromoteOpts> = {}): PromoteOpts {
  return {
    repoAbs: "/repo",
    integration: "dev",
    release: "main",
    execute: false,
    timeoutMs: 600_000,
    pollMs: 15_000,
    json: false,
    ...over,
  };
}

const joined = (lines: string[]) => lines.join("\n");

describe("promote — read-only (default)", () => {
  test("not published ⇒ code 0, would-promote, writes nothing", async () => {
    let acted = false;
    const deps = baseDeps({ promoteAction: async () => ((acted = true), { ok: true, detail: "x" }) });
    const r = await promote(deps, baseOpts());
    expect(r.code).toBe(0);
    expect(joined(r.lines)).toContain("STATE=would-promote");
    expect(joined(r.lines)).toContain("--execute");
    expect(acted).toBe(false);
  });

  test("already published ⇒ code 0, already-published", async () => {
    const r = await promote(baseDeps({ queryPublished: async () => PUBLISHED }), baseOpts());
    expect(r.code).toBe(0);
    expect(joined(r.lines)).toContain("STATE=already-published");
  });
});

describe("promote — guards", () => {
  test("unresolved slug ⇒ code 1", async () => {
    const r = await promote(baseDeps({ resolveSlug: async () => null }), baseOpts());
    expect(r.code).toBe(1);
    expect(joined(r.lines)).toContain("ERROR repo");
  });

  test("unreadable manifest version ⇒ code 1", async () => {
    const r = await promote(baseDeps({ readManifestVersion: async () => null }), baseOpts());
    expect(r.code).toBe(1);
    expect(joined(r.lines)).toContain("ERROR version");
  });

  test("execute refuses on lockfile drift (#86), never acts", async () => {
    let acted = false;
    const deps = baseDeps({
      checkLock: async () => ({ clean: false, reason: "bun.lock is out of step" }),
      promoteAction: async () => ((acted = true), { ok: true, detail: "x" }),
    });
    const r = await promote(deps, baseOpts({ execute: true }));
    expect(r.code).toBe(1);
    expect(joined(r.lines)).toContain("refused-lockfile-drift");
    expect(acted).toBe(false);
  });
});

describe("promote — execute verifies against the registry, not the exit code", () => {
  test("action ok + registry confirms after polling ⇒ code 0, published", async () => {
    let calls = 0;
    let slept = 0;
    const deps = baseDeps({
      // absent on the pre-check and first poll, published on the second poll
      queryPublished: async () => (++calls >= 3 ? PUBLISHED : ABSENT),
      sleep: async () => { slept++; },
    });
    const r = await promote(deps, baseOpts({ execute: true, timeoutMs: 100_000, pollMs: 1000 }));
    expect(r.code).toBe(0);
    expect(joined(r.lines)).toContain("STATE=published");
    expect(slept).toBeGreaterThan(0); // it actually polled
  });

  // THE anti-exit-0 case: the promotion action returns ok, yet the registry
  // never confirms. The command MUST fail — a merged PR is not a publication.
  test("action ok but registry never confirms ⇒ code 1, unestablished (NOT success)", async () => {
    const deps = baseDeps({
      promoteAction: async () => ({ ok: true, detail: "merged" }),
      queryPublished: async () => ABSENT, // forever
    });
    const now = (() => { let t = 0; return () => (t += 5000); })();
    const r = await promote(deps, baseOpts({ execute: true, timeoutMs: 20_000, pollMs: 5000, now }));
    expect(r.code).toBe(1);
    expect(joined(r.lines)).toContain("STATE=unestablished");
    expect(joined(r.lines)).toContain("could not establish");
  });

  test("action ok but registry unverifiable ⇒ code 1, unestablished", async () => {
    const deps = baseDeps({
      queryPublished: async () => ({ tagExists: null, releaseExists: null, releaseIsDraft: null }),
    });
    const now = (() => { let t = 0; return () => (t += 5000); })();
    const r = await promote(deps, baseOpts({ execute: true, timeoutMs: 10_000, pollMs: 5000, now }));
    expect(r.code).toBe(1);
    expect(joined(r.lines)).toContain("STATE=unestablished");
  });

  test("promotion action itself fails ⇒ code 1, promotion-failed", async () => {
    const deps = baseDeps({ promoteAction: async () => ({ ok: false, detail: "PR did not merge" }) });
    const r = await promote(deps, baseOpts({ execute: true }));
    expect(r.code).toBe(1);
    expect(joined(r.lines)).toContain("promotion-failed");
  });
});

// The registry-query seam: gh "release not found" is the FACT false, any other
// gh failure is null (unverifiable), and a git failure makes the tag null.
describe("queryPublishedRegistry — the honesty seam", () => {
  const runWith = (relCode: number, relStdout: string, relStderr: string, tagCode = 0, tagStdout = "abc\trefs/tags/v1.0.0"): GitRun =>
    async (cmd) => {
      if (cmd[0] === "gh") return { code: relCode, stdout: relStdout, stderr: relStderr };
      return { code: tagCode, stdout: tagStdout, stderr: "" };
    };

  test("gh 'release not found' ⇒ releaseExists false", async () => {
    const f = await queryPublishedRegistry("/r", "o/n", "v1.0.0", runWith(1, "", "release not found"));
    expect(f.releaseExists).toBe(false);
    expect(f.tagExists).toBe(true);
  });

  test("gh other failure ⇒ releaseExists null (unverifiable)", async () => {
    const f = await queryPublishedRegistry("/r", "o/n", "v1.0.0", runWith(1, "", "HTTP 401: Bad credentials"));
    expect(f.releaseExists).toBeNull();
  });

  test("gh ok with draft json ⇒ isDraft read", async () => {
    const f = await queryPublishedRegistry("/r", "o/n", "v1.0.0", runWith(0, '{"tagName":"v1.0.0","isDraft":true}', ""));
    expect(f.releaseExists).toBe(true);
    expect(f.releaseIsDraft).toBe(true);
  });

  test("git ls-remote failure ⇒ tagExists null", async () => {
    const f = await queryPublishedRegistry("/r", "o/n", "v1.0.0", runWith(0, '{"isDraft":false}', "", 128, ""));
    expect(f.tagExists).toBeNull();
  });

  test("empty ls-remote ⇒ tagExists false", async () => {
    const f = await queryPublishedRegistry("/r", "o/n", "v1.0.0", runWith(0, '{"isDraft":false}', "", 0, ""));
    expect(f.tagExists).toBe(false);
  });
});

describe("resolveSlugFromRemote", () => {
  const run = (url: string, code = 0): GitRun => async () => ({ code, stdout: url, stderr: "" });
  test("https remote", async () => {
    expect(await resolveSlugFromRemote("/r", run("https://github.com/blpsoares/aipe.git"))).toBe("blpsoares/aipe");
  });
  test("ssh remote", async () => {
    expect(await resolveSlugFromRemote("/r", run("git@github.com:blpsoares/aipe.git"))).toBe("blpsoares/aipe");
  });
  test("no remote ⇒ null", async () => {
    expect(await resolveSlugFromRemote("/r", run("", 1))).toBeNull();
  });
});

// `--help` on the subcommand must show help and NEVER fall through to running
// the command — a stray `release promote --execute --help` must not promote.
describe("run — cli wrapper", () => {
  function capture(): { lines: string[]; restore: () => void } {
    const lines: string[] = [];
    const orig = console.log;
    console.log = (...a: unknown[]) => { lines.push(a.join(" ")); };
    return { lines, restore: () => { console.log = orig; } };
  }

  test("release promote --help shows help, does not execute", async () => {
    const c = capture();
    const code = await run(["promote", "--execute", "--help"]);
    c.restore();
    expect(code).toBe(0);
    expect(c.lines.join("\n")).toContain("Usage: aipe release promote");
    // proof it did not run: no REPO=/STATE= line was emitted
    expect(c.lines.join("\n")).not.toContain("STATE=");
  });

  test("unknown release subcommand ⇒ code 1", async () => {
    const c = capture();
    const code = await run(["frobnicate"]);
    c.restore();
    expect(code).toBe(1);
    expect(c.lines.join("\n")).toContain("unknown");
  });

  test("no subcommand ⇒ help, code 1", async () => {
    const c = capture();
    const code = await run([]);
    c.restore();
    expect(code).toBe(1);
    expect(c.lines.join("\n")).toContain("Usage: aipe release promote");
  });
});

describe("readManifestVersionAtRef", () => {
  test("reads plugin.json version at origin/dev", async () => {
    const run: GitRun = async (cmd) => {
      const ref = cmd[cmd.length - 1];
      if (ref === "origin/dev:.claude-plugin/plugin.json") return { code: 0, stdout: '{"version":"1.13.2"}', stderr: "" };
      return { code: 128, stdout: "", stderr: "" };
    };
    expect(await readManifestVersionAtRef("/r", "dev", run)).toBe("1.13.2");
  });

  test("falls back to package.json when no plugin manifest", async () => {
    const run: GitRun = async (cmd) => {
      const ref = cmd[cmd.length - 1];
      if (ref === "dev:package.json") return { code: 0, stdout: '{"version":"2.0.0"}', stderr: "" };
      return { code: 128, stdout: "", stderr: "" };
    };
    expect(await readManifestVersionAtRef("/r", "dev", run)).toBe("2.0.0");
  });

  test("no version anywhere ⇒ null", async () => {
    const run: GitRun = async () => ({ code: 128, stdout: "", stderr: "" });
    expect(await readManifestVersionAtRef("/r", "dev", run)).toBeNull();
  });
});
