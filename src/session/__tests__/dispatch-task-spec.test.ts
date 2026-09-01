// R3 + R4, layer 2: a unit routed to the full SDD flow is NOT dispatched until
// its own Task Spec exists and the PE has approved it — and the specialist gets
// the PATH, never a copy.
//
// The measured failure this closes: the acceptance criteria a specialist built
// against, and a QA verified against, were free prose written by whoever was
// coordinating, decided AFTER dispatch. So there was no human gate before the
// work started, and "done" got defined by the people doing the work. The dev and
// the QA both read `disableStdin: true`, agreed it was "pre-existing design, not
// a regression", and shipped — because no approved document ever said that being
// able to TYPE was the objective. The PE reported it five times.
//
// The boundary is deliberate: only units the SDD router sends to the full flow
// owe a Task Spec. A unit declared trivial is not asked for one, so the gate
// bites where rigour was promised and stays out of the way where it was not.
import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dispatchCommand } from "../cli";
import { recordDispatch, setJourneySpec, setJourneyTaskSpec, startJourney } from "../../journey/ledger";
import { hashOrientationContent } from "../../journey/spec";
import { hashTaskSpecContent, taskSpecRelPath } from "../../journey/task-spec";
import type { TaskSize } from "../../toolbox/types";
import type { AgentopRunner } from "../types";

const ORIENTATION = "## embark\nFix it.\n";

// A workspace whose toolbox HAS the full kit installed — otherwise nothing is
// routed to it and there would be no Task Spec to demand (the same inverse
// honesty the delivery gate keeps).
const TOOLBOX = `skills:
  - name: spec-kit
    description: d
    objective: o
    whenToUse: w
    repos: [embark]
  - name: sdd-lite
    description: d
    objective: o
    whenToUse: w
    repos: [embark]
mcps: []
`;

const GOOD_SPEC = `# Task Spec — embark (j1)

## Objective
Typing works.

## Acceptance
- **A1** — Action: type into the pane · Effect: the output appears

## Tests the QA runs
- **A1** — drive a browser, assert the pane shows the listing

## Constraints
- none

## Anti-regression
- none

## Out of scope
- none
`;

async function fixture(size: TaskSize): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "aipe-dispatch-tspec-"));
  await mkdir(join(dir, "embark", ".claude", "skills", "joaquim"), { recursive: true });
  await writeFile(join(dir, "embark", ".claude", "skills", "joaquim", "SKILL.md"), "---\nname: joaquim\n---\n\nYou are Joaquim.\n", "utf8");
  await mkdir(join(dir, ".aipe", "journeys", "j1"), { recursive: true });
  await writeFile(join(dir, ".aipe", "toolbox.yaml"), TOOLBOX, "utf8");
  await writeFile(join(dir, ".aipe", "journeys", "j1", "orientation.md"), ORIENTATION, "utf8");
  await startJourney(dir, "j1");
  await setJourneySpec(dir, "j1", {
    path: join(".aipe", "journeys", "j1", "orientation.md"),
    version: 1,
    approved: true,
    contentHash: hashOrientationContent(ORIENTATION),
  });
  await recordDispatch(dir, "j1", {
    repo: "embark", specialist: "Joaquim", branch: "aipe/j1/joaquim",
    worktree: join(dir, ".worktrees", "j1-joaquim"), status: "dispatched",
    mode: "session", intensity: "normal", harness: "claude-code", size,
  });
  return dir;
}

async function writeTaskSpec(dir: string, body: string, approved: boolean): Promise<void> {
  const rel = taskSpecRelPath("j1", "embark");
  await mkdir(join(dir, ".aipe", "journeys", "j1", "task-specs"), { recursive: true });
  await writeFile(join(dir, rel), body, "utf8");
  await setJourneyTaskSpec(dir, "j1", "embark", {
    path: rel,
    version: 1,
    approved,
    ...(approved ? { contentHash: hashTaskSpecContent(body) } : {}),
  });
}

const forbiddenRunner: AgentopRunner = async (args) => {
  if (args[0] === "--version") return { code: 0, stdout: "agentop v1.9.0", stderr: "" };
  throw new Error("agentop was invoked — dispatch must refuse BEFORE starting any session");
};

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

async function prompts(dir: string): Promise<string[]> {
  try {
    return await readdir(join(dir, ".aipe", "journeys", "j1", "prompts"));
  } catch {
    return [];
  }
}

test("a full-flow unit with NO Task Spec is refused — the specialist does not write its own", async () => {
  const dir = await fixture("large");
  const r = await dispatchCommand({ workspace: dir, journeyId: "j1", runner: forbiddenRunner });
  expect(r.code).toBe(1);
  expect(r.lines.join("\n")).toContain("has no Task Spec");
  expect(await prompts(dir)).toHaveLength(0);
});

test("an UNAPPROVED Task Spec is refused — the PE approves the how, and the tests, before code", async () => {
  const dir = await fixture("large");
  await writeTaskSpec(dir, GOOD_SPEC, false);
  const r = await dispatchCommand({ workspace: dir, journeyId: "j1", runner: forbiddenRunner });
  expect(r.code).toBe(1);
  expect(r.lines.join("\n")).toContain("is not approved");
  expect(await prompts(dir)).toHaveLength(0);
});

test("an approval over a MISSING file is not an approval", async () => {
  const dir = await fixture("large");
  await setJourneyTaskSpec(dir, "j1", "embark", {
    path: taskSpecRelPath("j1", "embark"),
    version: 1,
    approved: true,
    contentHash: "deadbeef",
  });
  const r = await dispatchCommand({ workspace: dir, journeyId: "j1", runner: forbiddenRunner });
  expect(r.code).toBe(1);
  expect(r.lines.join("\n")).toContain("the file is absent");
});

test("a Task Spec EDITED after approval is refused — approved bytes are the approval", async () => {
  const dir = await fixture("large");
  await writeTaskSpec(dir, GOOD_SPEC, true);
  await writeFile(join(dir, taskSpecRelPath("j1", "embark")), `${GOOD_SPEC}\n## Extra\nSneaked in.\n`, "utf8");
  const r = await dispatchCommand({ workspace: dir, journeyId: "j1", runner: forbiddenRunner });
  expect(r.code).toBe(1);
  expect(r.lines.join("\n")).toContain("changed after approval");
});

test("an APPROVED Task Spec dispatches, and the prompt carries its PATH, not its text", async () => {
  const dir = await fixture("large");
  await writeTaskSpec(dir, GOOD_SPEC, true);
  const r = await dispatchCommand({ workspace: dir, journeyId: "j1", runner: okRunner });
  expect(r.code).toBe(0);

  const prompt = await readFile(join(dir, ".aipe", "journeys", "j1", "prompts", "embark.md"), "utf8");
  expect(prompt).toContain(taskSpecRelPath("j1", "embark"));
  // R3: the CONTENT must not be copied in — a frozen copy is what let an amended
  // spec never reach an already-dispatched specialist (#98).
  expect(prompt).not.toContain("Action: type into the pane");
  // and the specialist is told it may refuse the spec rather than reinterpret it
  expect(prompt).toContain("refuse it");
});

test("a unit declared TRIVIAL owes no Task Spec — the gate bites only where rigour was promised", async () => {
  const dir = await fixture("small");
  const r = await dispatchCommand({ workspace: dir, journeyId: "j1", runner: okRunner });
  expect(r.code).toBe(0);
  const prompt = await readFile(join(dir, ".aipe", "journeys", "j1", "prompts", "embark.md"), "utf8");
  expect(prompt).not.toContain("Your Task Spec");
});
