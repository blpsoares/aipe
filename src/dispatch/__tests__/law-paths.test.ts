import { expect, test } from "bun:test";
import { validateBatch } from "../law";
import type { PersonaRegistryEntry } from "../types";

// Two devs + a QA in one flat repo — the shape the path lock exists to unlock.
const roster: PersonaRegistryEntry[] = [
  { name: "Ana", role: "dev-fullstack", repo: "aipe", path: "p" },
  { name: "Bruno", role: "dev-fullstack", repo: "aipe", path: "p" },
  { name: "Marina", role: "qa", repo: "aipe", path: "p" },
];
const repos = ["aipe"];

test("two devs on DISJOINT declared paths in one repo are admitted", () => {
  const verdict = validateBatch(
    [
      { repo: "aipe", specialist: "Ana", task: "lock", paths: ["src/dispatch"] },
      { repo: "aipe", specialist: "Bruno", task: "serve", paths: ["src/serve"] },
    ],
    repos,
    roster,
  );
  expect(verdict.ok).toBe(true);
});

test("two devs on OVERLAPPING declared paths are rejected path-collision, naming the paths", () => {
  const verdict = validateBatch(
    [
      { repo: "aipe", specialist: "Ana", task: "lock", paths: ["src/dispatch"] },
      { repo: "aipe", specialist: "Bruno", task: "deep", paths: ["src/dispatch/lock.ts"] },
    ],
    repos,
    roster,
  );
  expect(verdict.ok).toBe(false);
  if (!verdict.ok) {
    const line = verdict.rejects.find((r) => r.startsWith("path-collision"));
    expect(line).toBeDefined();
    expect(line).toContain("aipe");
    expect(line).toContain("src/dispatch"); // the colliding paths are named
  }
});

test("a WHOLE dev (no paths) among path-declaring devs collides — WHOLE overlaps everything", () => {
  const verdict = validateBatch(
    [
      { repo: "aipe", specialist: "Ana", task: "lock", paths: ["src/dispatch"] },
      { repo: "aipe", specialist: "Bruno", task: "whole" }, // no paths ⇒ whole unit
    ],
    repos,
    roster,
  );
  expect(verdict.ok).toBe(false);
  if (!verdict.ok) expect(verdict.rejects.some((r) => r.startsWith("path-collision"))).toBe(true);
});

test("a writer with declared paths and a QA on the same repo coexist (a reviewer touches no files)", () => {
  const verdict = validateBatch(
    [
      { repo: "aipe", specialist: "Ana", task: "lock", paths: ["src/dispatch"] },
      { repo: "aipe", specialist: "Marina", task: "gate" },
    ],
    repos,
    roster,
  );
  expect(verdict.ok).toBe(true);
});

test("two disjoint-path devs sharing a task are rejected same-task (identity is per task)", () => {
  const verdict = validateBatch(
    [
      { repo: "aipe", specialist: "Ana", task: "dup", paths: ["src/dispatch"] },
      { repo: "aipe", specialist: "Bruno", task: "dup", paths: ["src/serve"] },
    ],
    repos,
    roster,
  );
  expect(verdict.ok).toBe(false);
  if (!verdict.ok) expect(verdict.rejects.some((r) => r.startsWith("same-task"))).toBe(true);
});

test("path-declaring dispatches still count toward the cap of 16", () => {
  const big = Array.from({ length: 17 }, (_, i) => ({
    repo: "aipe",
    specialist: "Ana",
    task: `t${i}`,
    paths: [`src/mod${i}`],
  }));
  const verdict = validateBatch(big, repos, roster);
  expect(verdict.ok).toBe(false);
  if (!verdict.ok) expect(verdict.rejects).toContain("cap-exceeded 17");
});

test("no-path devs on one repo still serialize same-repo (backward compatible)", () => {
  const verdict = validateBatch(
    [
      { repo: "aipe", specialist: "Ana" },
      { repo: "aipe", specialist: "Bruno" },
    ],
    repos,
    roster,
  );
  expect(verdict.ok).toBe(false);
  if (!verdict.ok) expect(verdict.rejects).toContain("same-repo aipe");
});
