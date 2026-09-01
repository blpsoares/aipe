// D1 (j-20260830-w0) — "a redispatch in the same unit is read as a duplicate".
// The Lawson incident, reproduced exactly: a unit's ledger already carries a
// MERGED task (v2, already shipped); the coordinator edits orientation.md
// directly (no `--amend`) to append a new section and redispatches a NEW task
// in the SAME worktree. Before this fix, the specialist's prompt still named
// the OLD spec version and said nothing about the merged sibling — exactly
// what let Lawson conclude "nothing new to build" without ever opening the
// new section. This test fails if either the version bump or the
// disambiguation is reverted.
import { expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dispatchCommand } from "../cli";
import { readLedger, recordDispatch, setJourneySpec, startJourney } from "../../journey/ledger";
import { hashOrientationContent } from "../../journey/spec";
import type { AgentopRunner } from "../types";

const V2_ORIENTATION = "## embark\nShip the hero flow (v2).\n";
const V3_ORIENTATION = "## embark\nShip the hero flow (v2).\n\n## SPEC v3\nRework the hero flow per PE feedback.\n";

async function fixture(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "aipe-sess-history-"));
  await mkdir(join(dir, "embark", ".claude", "skills", "lawson"), { recursive: true });
  await writeFile(
    join(dir, "embark", ".claude", "skills", "lawson", "SKILL.md"),
    "---\nname: lawson\n---\n\nYou are Lawson.\n",
    "utf8",
  );
  await mkdir(join(dir, ".aipe", "journeys", "j1"), { recursive: true });
  // v2 shipped and merged under an EARLIER hash.
  await writeFile(join(dir, ".aipe", "journeys", "j1", "orientation.md"), V2_ORIENTATION, "utf8");
  await startJourney(dir, "j1");
  await setJourneySpec(dir, "j1", {
    path: join(".aipe", "journeys", "j1", "orientation.md"),
    version: 1,
    approved: true,
    contentHash: hashOrientationContent(V2_ORIENTATION),
  });
  await recordDispatch(dir, "j1", {
    repo: "embark", task: "hero-flow", specialist: "Lawson",
    branch: "aipe/j1/hero-flow--lawson", worktree: join(dir, ".worktrees", "j1-lawson"),
    status: "merged", pr: "https://github.com/blpsoares/embark/pull/26",
    evidence: { by: "qa", commands: ["bun test"], summary: "33/33 green" },
  });
  // Now the coordinator edits orientation.md DIRECTLY — no `journey spec --amend` —
  // and redispatches a NEW task in the SAME worktree, same as the real incident.
  await writeFile(join(dir, ".aipe", "journeys", "j1", "orientation.md"), V3_ORIENTATION, "utf8");
  await recordDispatch(dir, "j1", {
    repo: "embark", task: "fluxo-v3", specialist: "Lawson",
    branch: "aipe/j1/hero-flow--lawson", worktree: join(dir, ".worktrees", "j1-lawson"),
    status: "dispatched", mode: "session",
  });
  return dir;
}

const okRunner: AgentopRunner = async (args) => {
  if (args[0] === "--version") return { code: 0, stdout: "agentop v1.9.0", stderr: "" };
  const sessions = args
    .filter((_, i) => args[i - 1] === "--session")
    .map((flag, i) => {
      const m = /^[^@]+@(.+): @.+$/.exec(flag);
      if (!m) throw new Error(`okRunner: could not parse --session flag: ${flag}`);
      return { id: `s-${i + 1}`, harness: "claude", cwd: m[1] };
    });
  return { code: 0, stdout: JSON.stringify({ sessions }), stderr: "" };
};

test("a redispatch into a unit with a MERGED sibling task states the NEW spec version and names the merge as history, not as the order", async () => {
  const dir = await fixture();

  // R4 changed the FIRST half of this incident. Editing orientation.md after
  // approval now REFUSES the dispatch instead of proceeding with a NOTE: the PE
  // never reviewed the appended section, and dispatching content no human
  // approved is the very gap the spec-writer design closes. What that refusal
  // does NOT change is D1's lesson below — once the amendment IS approved, the
  // prompt must name the new version and the merged sibling. So the incident is
  // now two beats: refuse, then (re-approved) dispatch correctly.
  const refused = await dispatchCommand({ workspace: dir, journeyId: "j1", runner: okRunner });
  expect(refused.code).toBe(1);
  expect(refused.lines.join("\n")).toContain("re-approval");

  // The refusal still recorded the drift it detected: v2, awaiting approval.
  const drifted = await readLedger(dir, "j1");
  expect(drifted!.spec!.version).toBe(2);
  expect(drifted!.spec!.approved).toBe(false);

  // The PE reviews the amended spec and approves v2 — the human gate, taken.
  await setJourneySpec(dir, "j1", { ...drifted!.spec!, approved: true });

  const r = await dispatchCommand({ workspace: dir, journeyId: "j1", runner: okRunner });
  expect(r.code).toBe(0);

  const prompt = await Bun.file(join(dir, ".aipe", "journeys", "j1", "prompts", "embark.md")).text();

  // 1 — the spec's content-derived version bumped past v1 (the orientation.md
  // content genuinely changed) and the prompt states it explicitly.
  expect(prompt).toContain("spec version v2");
  expect(prompt).not.toContain("spec version v1");

  // 2 — the merged sibling is named as HISTORY, explicitly not the order.
  expect(prompt).toContain("hero-flow");
  expect(prompt).toContain("merged");
  expect(prompt).toContain("NOT your order");
  expect(prompt).toContain("pull/26");

  // The ledger's own spec record reflects the bump, not just the prompt text.
  const ledger = await readLedger(dir, "j1");
  expect(ledger!.spec!.version).toBe(2);
  expect(ledger!.spec!.approved).toBe(true); // approved by the PE above, and only then dispatched
});
