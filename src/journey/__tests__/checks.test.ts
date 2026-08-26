import { expect, test } from "bun:test";
import { classifyGhChecks } from "../checks";

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
