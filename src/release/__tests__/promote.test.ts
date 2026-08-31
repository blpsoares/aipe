import { describe, expect, test } from "bun:test";
import { evaluatePublication, type PublishedFacts } from "../promote";
import { checkLockfileClean, type Run } from "../lockfile";

// The verdict must come ONLY from registry facts. These cases pin every branch,
// with special weight on the two honesty seams: an unread fact never becomes
// `published`, and a draft release is not `published`.
describe("evaluatePublication", () => {
  const facts = (f: Partial<PublishedFacts>): PublishedFacts => ({
    tagExists: false,
    releaseExists: false,
    releaseIsDraft: null,
    ...f,
  });

  test("tag + live release ⇒ published", () => {
    const v = evaluatePublication("1.13.2", facts({ tagExists: true, releaseExists: true, releaseIsDraft: false }));
    expect(v.state).toBe("published");
    expect(v.reason).toContain("1.13.2");
  });

  test("no tag and no release ⇒ not-published, names both", () => {
    const v = evaluatePublication("1.13.2", facts({ tagExists: false, releaseExists: false }));
    expect(v.state).toBe("not-published");
    expect(v.reason).toContain("no v1.13.2 tag");
    expect(v.reason).toContain("no published release");
  });

  test("tag present but release missing ⇒ not-published", () => {
    const v = evaluatePublication("1.13.2", facts({ tagExists: true, releaseExists: false }));
    expect(v.state).toBe("not-published");
    expect(v.reason).toContain("no published release");
  });

  test("draft release ⇒ not-published (a draft is not live)", () => {
    const v = evaluatePublication("1.13.2", facts({ tagExists: true, releaseExists: true, releaseIsDraft: true }));
    expect(v.state).toBe("not-published");
    expect(v.reason).toContain("draft");
  });

  // The seam: null facts must degrade to unverifiable — never to published.
  test("tag unreadable ⇒ unverifiable, never published", () => {
    const v = evaluatePublication("1.13.2", facts({ tagExists: null, releaseExists: true, releaseIsDraft: false }));
    expect(v.state).toBe("unverifiable");
    expect(v.reason).toContain("could not be established");
  });

  test("release unreadable ⇒ unverifiable", () => {
    const v = evaluatePublication("1.13.2", facts({ tagExists: true, releaseExists: null }));
    expect(v.state).toBe("unverifiable");
  });

  test("both unreadable ⇒ unverifiable, names both", () => {
    const v = evaluatePublication("1.13.2", facts({ tagExists: null, releaseExists: null }));
    expect(v.state).toBe("unverifiable");
    expect(v.reason).toContain("neither");
  });

  test("release exists but draft state unreadable ⇒ unverifiable (not assumed live)", () => {
    const v = evaluatePublication("1.13.2", facts({ tagExists: true, releaseExists: true, releaseIsDraft: null }));
    expect(v.state).toBe("unverifiable");
    expect(v.reason).toContain("draft state was unreadable");
  });
});

describe("checkLockfileClean", () => {
  test("frozen install passes ⇒ clean", async () => {
    const run: Run = async (cmd) => {
      expect(cmd).toEqual(["bun", "install", "--frozen-lockfile"]);
      return { code: 0, stdout: "", stderr: "" };
    };
    const r = await checkLockfileClean("/repo", run);
    expect(r.clean).toBe(true);
  });

  test("frozen install refused ⇒ not clean, folds in the bun reason", async () => {
    const run: Run = async () => ({
      code: 1,
      stdout: "",
      stderr: "error: lockfile had changes, but lockfile is frozen\nnote: try re-running without --frozen-lockfile",
    });
    const r = await checkLockfileClean("/repo", run);
    expect(r.clean).toBe(false);
    expect(r.reason).toContain("out of step");
    expect(r.reason).toContain("frozen");
  });
});
