import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

// Repo root, three levels up from src/governance-docs/__tests__.
const ROOT = join(import.meta.dir, "..", "..", "..");
const read = (rel: string) => readFile(join(ROOT, rel), "utf8");

// These are prose guards for a governance invariant, not code behaviour: the
// `operate` skill and `CONTRIBUTING.md` must describe the promotion flow that
// actually exists (see RELEASING.md), and must not re-describe a world that
// doesn't — `main` protection is ACTIVE, not pending, and no release-bot bypass
// exists on this personal repo. This is the same class of guard as
// reliability-floor.test.ts (assert on published skill content), scoped to the
// concepts the journey j-20260830-98 was opened to fix.

test("operate skill describes the promotion step: offer to the PE, by batch, never silent", async () => {
  const skill = await read("skills/operate/SKILL.md");

  // A promotion step exists at all.
  expect(skill).toMatch(/promot(e|ion|ing)/i);

  // The offer-to-the-PE policy (never promote in silence, never dam in silence).
  expect(skill).toMatch(/present[^.\n]*PE|ask[^.\n]*PE/i);

  // The reason it is by BATCH and not per-PR is preserved (five releases in a day).
  expect(skill).toMatch(/batch/i);
  expect(skill).toMatch(/five releases/i);
});

test("operate skill distinguishes `merged` from in-production, standalone", async () => {
  const skill = await read("skills/operate/SKILL.md");
  // A reader must understand, without opening another file, that merged ≠ prod.
  expect(skill).toMatch(/`?merged`?[^.\n]*\b(not|never)\b[^.\n]*(production|published|released)/i);
});

test("operate self-review gate covers verified-but-unpromoted work on dev", async () => {
  const skill = await read("skills/operate/SKILL.md");
  const gate = skill.slice(skill.indexOf("## Self-review gate"));
  expect(gate.length).toBeGreaterThan(0);
  // The gate asks: is there verified work on dev with no promotion offered to the PE?
  expect(gate).toMatch(/promot/i);
  expect(gate).toMatch(/\bdev\b/i);
  expect(gate).toMatch(/PE/);
});

test("CONTRIBUTING.md states main protection as ACTIVE, not pending", async () => {
  const contributing = await read("CONTRIBUTING.md");
  // Must NOT claim protection is pending / not yet enforced.
  expect(contributing).not.toMatch(/protection[^.]{0,60}\bpending\b/i);
  // Must state it as active/enforced.
  expect(contributing).toMatch(/protection[^.]{0,60}\b(active|enforced)\b/i);
});

test("CONTRIBUTING.md does not claim a release-bot bypass or a direct push to main", async () => {
  const contributing = await read("CONTRIBUTING.md");
  // The old, false claim: a bypass for the version-bump commit pushing to main.
  expect(contributing).not.toMatch(/bypass/i);
  expect(contributing).not.toMatch(/push(es|ed)?\s+directly\s+to\s+`?main`?/i);
});
