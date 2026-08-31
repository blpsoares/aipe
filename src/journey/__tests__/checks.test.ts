import { expect, test } from "bun:test";
import { buildGhChecksArgs, classifyGhChecks, makeGhPrChecks, parsePrUrl, type GhRunner } from "../checks";

const j = (rows: unknown[]): string => JSON.stringify(rows);

test("all pass → green", () => {
  expect(classifyGhChecks(0, j([{ bucket: "pass", state: "SUCCESS" }, { bucket: "pass", state: "SUCCESS" }]), "")).toBe("green");
});

test("a single failing check → red, even amid passes", () => {
  expect(classifyGhChecks(1, j([{ bucket: "pass" }, { bucket: "fail", state: "FAILURE" }]), "")).toBe("red");
});

test("a cancelled check counts as red", () => {
  expect(classifyGhChecks(1, j([{ bucket: "cancel", state: "CANCELLED" }]), "")).toBe("red");
});

test("pending is distinct from failure — not-yet-concluded", () => {
  expect(classifyGhChecks(8, j([{ bucket: "pass" }, { bucket: "pending", state: "IN_PROGRESS" }]), "")).toBe("pending");
});

test("pending inferred from state even if bucket is blank", () => {
  expect(classifyGhChecks(8, j([{ state: "queued" }]), "")).toBe("pending");
});

test("empty array → none (PR reports no checks)", () => {
  expect(classifyGhChecks(0, j([]), "")).toBe("none");
});

test("non-zero exit with gh's 'no checks' message and no JSON → none", () => {
  expect(classifyGhChecks(1, "", "no checks reported on the 'main' branch")).toBe("none");
});

test("unauthenticated / offline (no JSON, not a no-checks message) → unknown, never a guessed pass", () => {
  expect(classifyGhChecks(1, "", "gh: To use GitHub CLI, run: gh auth login")).toBe("unknown");
});

test("garbage stdout that is valid JSON but not an array → unknown", () => {
  expect(classifyGhChecks(0, JSON.stringify({ oops: true }), "")).toBe("unknown");
});

test("all-pass rows but a non-zero exit does not become green — fail safe", () => {
  // rows look terminal-pass, but exit 8 says pending: trust the exit.
  expect(classifyGhChecks(8, j([{ bucket: "pass" }]), "")).toBe("pending");
});

// D2 (j-20260830-w0) — "gate abstains on CI it can resolve": the real cause was
// resolving checks by whatever gh does with the raw URL/branch, which breaks
// exactly for a merged PR whose branch has been deleted. The fix queries by PR
// NUMBER with an explicit --repo, which never depends on the branch existing.
test("builds the gh args by PR NUMBER with an explicit --repo, never the raw URL", () => {
  expect(buildGhChecksArgs("https://github.com/acme/widgets/pull/257")).toEqual([
    "pr", "checks", "257", "--repo", "acme/widgets", "--json", "bucket,state",
  ]);
});

test("a non-URL input (legacy caller, bare number) is passed through, still never as a branch", () => {
  expect(buildGhChecksArgs("257")).toEqual(["pr", "checks", "257", "--json", "bucket,state"]);
});

test("a non-github.com host is not parsed as a PR ref (avoid confidently guessing a wrong owner/repo)", () => {
  expect(parsePrUrl("https://gitlab.com/acme/widgets/pull/1")).toBeNull();
});

test("resolves a MERGED, branch-deleted PR by number — the exact D2 regression, reverting buildGhChecksArgs to pass the raw URL makes this fail", async () => {
  const fake: GhRunner = async (args) => {
    // Simulate the real symptom: whatever gh does with the URL/branch form
    // comes back unresolvable for a merged PR with its branch gone; the
    // number+--repo form (the fix) succeeds.
    const byNumber = args[2] === "257" && args.includes("--repo") && args[args.indexOf("--repo") + 1] === "acme/widgets";
    if (byNumber) return { code: 0, stdout: JSON.stringify([{ bucket: "pass", state: "SUCCESS" }]), stderr: "" };
    return { code: 1, stdout: "", stderr: "no branch found for pull request" };
  };
  const resolve = makeGhPrChecks(fake);
  const r = await resolve("https://github.com/acme/widgets/pull/257");
  expect(typeof r === "string" ? r : r.verdict).toBe("green");
});

test("an unresolvable verdict carries what was attempted and what came back, not a list of guesses", async () => {
  const fake: GhRunner = async () => ({ code: 1, stdout: "", stderr: "gh: To use GitHub CLI, run: gh auth login" });
  const resolve = makeGhPrChecks(fake);
  const r = await resolve("https://github.com/acme/widgets/pull/9");
  if (typeof r === "string") throw new Error("expected an object resolution with detail");
  expect(r.verdict).toBe("unknown");
  expect(r.detail).toContain("pr checks 9 --repo acme/widgets");
  expect(r.detail).toContain("gh auth login");
});

test("a spawn failure is reported as unknown with the spawn error in the detail", async () => {
  const fake: GhRunner = async () => {
    throw new Error("ENOENT: gh not found");
  };
  const resolve = makeGhPrChecks(fake);
  const r = await resolve("https://github.com/acme/widgets/pull/9");
  if (typeof r === "string") throw new Error("expected an object resolution with detail");
  expect(r.verdict).toBe("unknown");
  expect(r.detail).toContain("ENOENT: gh not found");
});
