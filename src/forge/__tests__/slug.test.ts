import { describe, expect, test } from "bun:test";
import { parsePrUrl, resolveSlugFromRemote, type SlugGitRun } from "../slug";

// The single forge resolver behind every explicit `gh --repo` (onda5 #76). A
// fake git runner drives resolveSlugFromRemote offline; parsePrUrl is pure.

const fakeRemote = (url: string, code = 0): SlugGitRun => async () => ({ code, stdout: url, stderr: "" });

describe("resolveSlugFromRemote", () => {
  test("https remote → owner/name", async () => {
    expect(await resolveSlugFromRemote(".", fakeRemote("https://github.com/blpsoares/aipe"))).toBe("blpsoares/aipe");
  });

  test("https remote with .git suffix → owner/name", async () => {
    expect(await resolveSlugFromRemote(".", fakeRemote("https://github.com/blpsoares/aipe.git"))).toBe("blpsoares/aipe");
  });

  test("ssh remote (git@github.com:owner/name.git) → owner/name", async () => {
    expect(await resolveSlugFromRemote(".", fakeRemote("git@github.com:opvibes/openvibes-embark.git"))).toBe(
      "opvibes/openvibes-embark",
    );
  });

  test("trailing slash is tolerated", async () => {
    expect(await resolveSlugFromRemote(".", fakeRemote("https://github.com/blpsoares/aipe/"))).toBe("blpsoares/aipe");
  });

  test("no origin / git failure → null (never a guess)", async () => {
    expect(await resolveSlugFromRemote(".", fakeRemote("", 1))).toBeNull();
  });

  test("a non-github remote → null", async () => {
    expect(await resolveSlugFromRemote(".", fakeRemote("https://gitlab.com/owner/name.git"))).toBeNull();
  });
});

describe("parsePrUrl", () => {
  test("github PR URL → owner/repo/number", () => {
    expect(parsePrUrl("https://github.com/blpsoares/aipe/pull/100")).toEqual({
      owner: "blpsoares",
      repo: "aipe",
      number: "100",
    });
  });

  test("http and trailing path tolerated", () => {
    expect(parsePrUrl("http://github.com/opvibes/openvibes-embark/pull/26/files")).toEqual({
      owner: "opvibes",
      repo: "openvibes-embark",
      number: "26",
    });
  });

  test("a non-github / non-PR input → null (caller passes it through)", () => {
    expect(parsePrUrl("http://pr/1")).toBeNull();
    expect(parsePrUrl("42")).toBeNull();
  });
});
