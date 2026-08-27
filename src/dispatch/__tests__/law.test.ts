import { expect, test } from "bun:test";
import { validateBatch } from "../law";
import type { PersonaRegistryEntry } from "../types";

const roster: PersonaRegistryEntry[] = [
  { name: "Nicolas", role: "coordinator", repo: null, path: null },
  { name: "Joaquim", role: "dev-fullstack", repo: "embark", path: "./embark/.claude/skills/joaquim" },
  { name: "Marina", role: "qa", repo: "embark", path: "./embark/.claude/skills/marina" },
  { name: "Pedro", role: "dev-fullstack", repo: "prontuario", path: "./prontuario/.claude/skills/pedro" },
];
const repos = ["embark", "prontuario"];

test("a lawful batch of distinct repos passes", () => {
  const verdict = validateBatch(
    [
      { repo: "embark", specialist: "Joaquim" },
      { repo: "prontuario", specialist: "Pedro" },
    ],
    repos,
    roster,
  );
  expect(verdict.ok).toBe(true);
});

test("the same repo twice in one batch is rejected (serialization law)", () => {
  const verdict = validateBatch(
    [
      { repo: "embark", specialist: "Joaquim" },
      { repo: "embark", specialist: "Marina" },
    ],
    repos,
    roster,
  );
  expect(verdict.ok).toBe(false);
  if (!verdict.ok) expect(verdict.rejects).toContain("same-repo embark");
});

test("more than 16 entries is rejected (cap)", () => {
  const big = Array.from({ length: 17 }, (_, i) => ({ repo: `r${i}`, specialist: "x" }));
  const verdict = validateBatch(big, big.map((e) => e.repo), []);
  expect(verdict.ok).toBe(false);
  if (!verdict.ok) expect(verdict.rejects).toContain("cap-exceeded 17");
});

test("an unknown repo is rejected", () => {
  const verdict = validateBatch([{ repo: "ghost", specialist: "x" }], repos, roster);
  expect(verdict.ok).toBe(false);
  if (!verdict.ok) expect(verdict.rejects).toContain("unknown-repo ghost");
});

test("a specialist not on the roster for that repo is rejected", () => {
  const verdict = validateBatch([{ repo: "embark", specialist: "Pedro" }], repos, roster);
  expect(verdict.ok).toBe(false);
  if (!verdict.ok) expect(verdict.rejects).toContain("unknown-specialist Pedro@embark");
});

test("specialist match is case-insensitive", () => {
  const verdict = validateBatch([{ repo: "embark", specialist: "joaquim" }], repos, roster);
  expect(verdict.ok).toBe(true);
});

test("distinct packages of one monorepo run in parallel (package-keyed law)", () => {
  const monoRoster: PersonaRegistryEntry[] = [
    { name: "Ana", role: "dev-fullstack", repo: "platform", path: "p" },
    { name: "Bruno", role: "dev-fullstack", repo: "platform", path: "p" },
  ];
  const verdict = validateBatch(
    [
      { repo: "platform", package: "core", specialist: "Ana" },
      { repo: "platform", package: "web", specialist: "Bruno" },
    ],
    ["platform"],
    monoRoster,
  );
  expect(verdict.ok).toBe(true);
});

test("the same package twice in one batch is rejected", () => {
  const verdict = validateBatch(
    [
      { repo: "platform", package: "core", specialist: "Ana" },
      { repo: "platform", package: "core", specialist: "Bruno" },
    ],
    ["platform"],
    [
      { name: "Ana", role: "dev-fullstack", repo: "platform", path: "p" },
      { name: "Bruno", role: "qa", repo: "platform", path: "p" },
    ],
  );
  expect(verdict.ok).toBe(false);
  if (!verdict.ok) expect(verdict.rejects).toContain("same-package platform/core");
});

// ── Identity-per-task: concurrency for non-writing roles (j-20260826-uv) ──

test("two concurrent dispatches of ONE non-writing persona on DISTINCT tasks are admitted", () => {
  // Marina (qa) gates PR #24 and PR #23 at once — a QA writes nothing to the
  // repo, so two runs on the same unit cannot collide, given a distinct task each.
  const verdict = validateBatch(
    [
      { repo: "embark", specialist: "Marina", task: "gate-pr24" },
      { repo: "embark", specialist: "Marina", task: "gate-pr23" },
    ],
    repos,
    roster,
  );
  expect(verdict.ok).toBe(true);
});

test("two dev dispatches in ONE package stay rejected (writing role serializes)", () => {
  // Not this journey's to unlock: a dev writes, so the unit still serializes even
  // with distinct tasks.
  const verdict = validateBatch(
    [
      { repo: "embark", specialist: "Joaquim", task: "feat-a" },
      { repo: "embark", specialist: "Joaquim", task: "feat-b" },
    ],
    repos,
    roster,
  );
  expect(verdict.ok).toBe(false);
  if (!verdict.ok) expect(verdict.rejects).toContain("same-repo embark");
});

test("a mixed group (one writing role) still serializes as same-repo", () => {
  const verdict = validateBatch(
    [
      { repo: "embark", specialist: "Marina", task: "gate" },
      { repo: "embark", specialist: "Joaquim", task: "feat" },
    ],
    repos,
    roster,
  );
  expect(verdict.ok).toBe(false);
  if (!verdict.ok) expect(verdict.rejects).toContain("same-repo embark");
});

test("N non-writing dispatches with a DUPLICATE task are rejected same-task", () => {
  const verdict = validateBatch(
    [
      { repo: "embark", specialist: "Marina", task: "gate-pr24" },
      { repo: "embark", specialist: "Marina", task: "gate-pr24" },
    ],
    repos,
    roster,
  );
  expect(verdict.ok).toBe(false);
  if (!verdict.ok) expect(verdict.rejects).toContain("same-task embark#gate-pr24");
});

test("N non-writing dispatches MISSING a task are rejected same-task (must be distinguishable)", () => {
  const verdict = validateBatch(
    [
      { repo: "embark", specialist: "Marina" },
      { repo: "embark", specialist: "Marina" },
    ],
    repos,
    roster,
  );
  expect(verdict.ok).toBe(false);
  if (!verdict.ok) expect(verdict.rejects.some((r) => r.startsWith("same-task embark"))).toBe(true);
});

test("N concurrent non-writing dispatches still count toward the cap of 16", () => {
  const big = Array.from({ length: 17 }, (_, i) => ({ repo: "embark", specialist: "Marina", task: `gate-${i}` }));
  const verdict = validateBatch(big, repos, roster);
  expect(verdict.ok).toBe(false);
  if (!verdict.ok) expect(verdict.rejects).toContain("cap-exceeded 17");
});
