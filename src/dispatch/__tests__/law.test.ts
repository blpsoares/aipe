import { expect, test } from "bun:test";
import { validateBatch } from "../law";
import type { PersonaRegistryEntry } from "../types";

const roster: PersonaRegistryEntry[] = [
  { name: "Nicolas", role: "coordinator", repo: null, module: null, fqid: null, path: null },
  { name: "Joaquim", role: "dev-fullstack", repo: "embark", module: null, fqid: "embark", path: "./embark/.claude/skills/joaquim" },
  { name: "Marina", role: "qa", repo: "embark", module: null, fqid: "embark", path: "./embark/.claude/skills/marina" },
  { name: "Pedro", role: "dev-fullstack", repo: "prontuario", module: null, fqid: "prontuario", path: "./prontuario/.claude/skills/pedro" },
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
