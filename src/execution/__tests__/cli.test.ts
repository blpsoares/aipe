import { expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { planCommand, proposeCommand } from "../cli";
import { readCapabilities, writeCapabilities } from "../../capabilities/store";
import { recordDispatch, startJourney } from "../../journey/ledger";
import { defaultExecutionPolicy } from "../policy";
import { proposeForUnit } from "../propose";
import type { Capabilities, ProbeRunner } from "../../capabilities/types";

const NOW = "2026-08-15T00:00:00.000Z";
const caps: Capabilities = {
  confirmed: true,
  harnesses: [
    { id: "claude-code", bin: "claude", present: true, version: "1", source: "pe-confirmed", checkedAt: NOW },
  ],
};

const COST_INDEX_NOTE =
  "NOTE cost-index is a COARSE RELATIVE INDEX, not currency: the cheapest envelope (subagent, fast tier, normal intensity) is 1.";
const UNCONFIRMED_NOTE =
  "NOTE capabilities: this record was probed but never confirmed by you — a binary on PATH is not an authenticated binary.";
const AUTO_PROBED_NOTE =
  "NOTE capabilities: no record found — probed this machine automatically just now.";

// `propose`'s self-heal path never shells out to a real harness binary in a
// test — same injectable-runner pattern as
// capabilities/__tests__/cli.test.ts's `only()`. All four (claude, gemini,
// codex, copilot) are actually installed on a dev machine, so a test that
// forgot this fake would pass here and fail everywhere else.
const only = (present: string[]): ProbeRunner => async (bin) =>
  present.includes(bin) ? { code: 0, stdout: `${bin} 1.2.3`, stderr: "" } : { code: 127, stdout: "", stderr: "" };

async function newWorkspace(): Promise<string> {
  return mkdtemp(join(tmpdir(), "aipe-execcli-"));
}

async function writeRawCaps(dir: string, yaml: string): Promise<void> {
  await mkdir(join(dir, ".aipe"), { recursive: true });
  await writeFile(join(dir, ".aipe", "capabilities.yaml"), yaml, "utf8");
}

// One well-formed entry plus one malformed entry, matching the shape
// capabilities/__tests__/cli.test.ts and capabilities/__tests__/store.test.ts
// use to exercise `dropped: 1` on readCapabilities.
const ONE_GOOD_ONE_BAD = [
  "confirmed: false",
  "harnesses:",
  "  - id: claude-code",
  "    bin: claude",
  "    present: true",
  "    version: 5.0.0",
  "    source: probe",
  `    checkedAt: "${NOW}"`,
  "  - {}",
].join("\n");

const DEGRADED_CAPS: Capabilities = {
  confirmed: false,
  harnesses: [
    { id: "claude-code", bin: "claude", present: true, version: "5.0.0", source: "probe", checkedAt: NOW },
  ],
};

// codex is present on this machine but its adapter's `containmentHook()`
// returns `null` (see harness/codex.ts) — it is NEVER containable, so a
// session envelope on it is exactly what `dispatch/law.ts` REJECTs as
// `harness-not-containable codex`.
const CAPS_WITH_CODEX: Capabilities = {
  confirmed: true,
  harnesses: [
    { id: "claude-code", bin: "claude", present: true, version: "1", source: "pe-confirmed", checkedAt: NOW },
    { id: "codex", bin: "codex", present: true, version: "1", source: "pe-confirmed", checkedAt: NOW },
  ],
};

async function fixture(withCaps = true): Promise<{ dir: string; journey: string }> {
  const dir = await newWorkspace();
  await startJourney(dir, "j1");
  await recordDispatch(dir, "j1", {
    repo: "embark", specialist: "Joaquim", branch: "b", worktree: "w", status: "dispatched",
  });
  if (withCaps) await writeCapabilities(dir, caps);
  return { dir, journey: "j1" };
}

// ---------------------------------------------------------------------------
// propose
// ---------------------------------------------------------------------------

test("propose lists each unit's priced options, cheapest first, exactly matching the underlying proposal", async () => {
  const { dir, journey } = await fixture();
  const r = await proposeCommand({ workspace: dir, journeyId: journey });
  expect(r.code).toBe(0);

  const proposal = proposeForUnit("embark", caps, defaultExecutionPolicy(), {});
  const expected = ["UNIT embark"];
  for (const o of proposal.options) {
    const e = o.envelope;
    const gate = o.gated ? ` GATED (${o.gateReasons.join("; ")})` : "";
    expected.push(`  ${e.mode} ${e.harness} ${e.tier} ${e.intensity} cost-index=${o.costIndex}${gate}`);
  }
  for (const x of proposal.excluded) expected.push(`  -- ${x.harness} excluded: ${x.reason}`);
  expected.push(COST_INDEX_NOTE);

  expect(r.lines).toEqual(expected);
  expect(r.lines[1]).toBe("  subagent claude-code fast normal cost-index=1");
});

test("gated options are marked so, with the reason, in the real CLI output", async () => {
  const { dir, journey } = await fixture();
  const r = await proposeCommand({ workspace: dir, journeyId: journey });
  const ultraLine = r.lines.find((l) => l.includes("ultracode") && !l.includes("normal"))!;
  expect(ultraLine).toBe(
    "  subagent claude-code fast ultracode cost-index=8 GATED (intensity ultracode requires your authorization)",
  );
});

test("without capabilities, propose self-heals by probing automatically and says so", async () => {
  const { dir, journey } = await fixture(false);
  const r = await proposeCommand({ workspace: dir, journeyId: journey, runner: only(["claude"]), now: NOW });
  expect(r.code).toBe(0);

  const probedCaps: Capabilities = {
    confirmed: false,
    harnesses: [
      { id: "claude-code", bin: "claude", present: true, version: "1.2.3", source: "probe", checkedAt: NOW },
      { id: "gemini", bin: "gemini", present: false, version: null, source: "probe", checkedAt: NOW },
      { id: "codex", bin: "codex", present: false, version: null, source: "probe", checkedAt: NOW },
      { id: "copilot", bin: "copilot", present: false, version: null, source: "probe", checkedAt: NOW },
    ],
  };
  const proposal = proposeForUnit("embark", probedCaps, defaultExecutionPolicy(), {});
  const expected = [AUTO_PROBED_NOTE, "UNIT embark"];
  for (const o of proposal.options) {
    const e = o.envelope;
    const gate = o.gated ? ` GATED (${o.gateReasons.join("; ")})` : "";
    expected.push(`  ${e.mode} ${e.harness} ${e.tier} ${e.intensity} cost-index=${o.costIndex}${gate}`);
  }
  for (const x of proposal.excluded) expected.push(`  -- ${x.harness} excluded: ${x.reason}`);
  expected.push(UNCONFIRMED_NOTE, COST_INDEX_NOTE);

  expect(r.lines).toEqual(expected);

  // The self-heal persists what it found, so `capabilities show`/`plan` never
  // have to probe again on their own.
  const result = await readCapabilities(dir);
  expect(result!.capabilities).toEqual(probedCaps);
});

test("propose still refuses when the probe finds no usable harness, naming the constraint", async () => {
  const { dir, journey } = await fixture(false);
  const r = await proposeCommand({ workspace: dir, journeyId: journey, runner: only([]), now: NOW });
  expect(r.code).toBe(1);
  expect(r.lines).toEqual([
    "ERROR capabilities: probed this machine automatically and found no usable harness (claude, gemini, codex, copilot all absent) — install one, then re-run `aipe execution propose`",
  ]);

  // A failed self-heal writes nothing, so the NEXT propose call retries the
  // probe instead of being stuck with a permanent all-absent record.
  const result = await readCapabilities(dir);
  expect(result).toBeNull();
});

test("an existing unconfirmed record is never re-probed or overwritten by propose", async () => {
  const { dir, journey } = await fixture(false);
  const unconfirmed: Capabilities = { ...caps, confirmed: false };
  await writeCapabilities(dir, unconfirmed);

  let called = false;
  const spyRunner: ProbeRunner = async () => {
    called = true;
    throw new Error("propose must not probe when a record already exists");
  };

  const r = await proposeCommand({ workspace: dir, journeyId: journey, runner: spyRunner, now: NOW });
  expect(called).toBe(false);
  expect(r.code).toBe(0);
  expect(r.lines.slice(-2)).toEqual([UNCONFIRMED_NOTE, COST_INDEX_NOTE]);

  const result = await readCapabilities(dir);
  expect(result!.capabilities).toEqual(unconfirmed);
});

test("an unknown journey errors, for propose", async () => {
  const { dir } = await fixture();
  const r = await proposeCommand({ workspace: dir, journeyId: "nope" });
  expect(r.code).toBe(1);
  expect(r.lines).toEqual(["ERROR journey: no ledger for nope"]);
});

test("a journey with no units at all errors, for propose, instead of printing nothing", async () => {
  const dir = await newWorkspace();
  await startJourney(dir, "empty");
  await writeCapabilities(dir, caps);
  const r = await proposeCommand({ workspace: dir, journeyId: "empty" });
  expect(r.code).toBe(1);
  expect(r.lines).toEqual(["ERROR journey: empty has no units yet — nothing to propose for"]);
});

test("unconfirmed capabilities still propose, but say so, as the last note", async () => {
  const { dir, journey } = await fixture(false);
  await writeCapabilities(dir, { ...caps, confirmed: false });
  const r = await proposeCommand({ workspace: dir, journeyId: journey });
  expect(r.code).toBe(0);
  expect(r.lines.slice(-2)).toEqual([UNCONFIRMED_NOTE, COST_INDEX_NOTE]);
});

test("a degraded capabilities record surfaces how many entries were dropped, for propose", async () => {
  const { dir, journey } = await fixture(false);
  await writeRawCaps(dir, ONE_GOOD_ONE_BAD);
  const r = await proposeCommand({ workspace: dir, journeyId: journey });
  expect(r.code).toBe(0);

  const proposal = proposeForUnit("embark", DEGRADED_CAPS, defaultExecutionPolicy(), {});
  const expected = [
    "WARN capabilities: 1 malformed entry discarded from the record — re-run `aipe capabilities probe` to rebuild it",
    "UNIT embark",
  ];
  for (const o of proposal.options) {
    const e = o.envelope;
    const gate = o.gated ? ` GATED (${o.gateReasons.join("; ")})` : "";
    expected.push(`  ${e.mode} ${e.harness} ${e.tier} ${e.intensity} cost-index=${o.costIndex}${gate}`);
  }
  for (const x of proposal.excluded) expected.push(`  -- ${x.harness} excluded: ${x.reason}`);
  expected.push(UNCONFIRMED_NOTE, COST_INDEX_NOTE);

  expect(r.lines).toEqual(expected);
});

test("--journey missing errors via run()", async () => {
  const originalLog = console.log;
  const logged: string[] = [];
  console.log = (msg: string) => logged.push(msg);
  try {
    const { run } = await import("../cli");
    const code = await run(["propose"]);
    expect(code).toBe(1);
    expect(logged).toEqual(["ERROR journey: --journey <id> is required"]);
  } finally {
    console.log = originalLog;
  }
});

// ---------------------------------------------------------------------------
// plan
// ---------------------------------------------------------------------------

test("plan groups the recorded envelopes into one ungated subagent wave", async () => {
  const dir = await newWorkspace();
  await startJourney(dir, "j1");
  await recordDispatch(dir, "j1", {
    repo: "embark", specialist: "Joaquim", branch: "b", worktree: "w", status: "dispatched",
    mode: "subagent", harness: "claude-code", tier: "fast", intensity: "normal",
  });
  await recordDispatch(dir, "j1", {
    repo: "embark", package: "pkgB", specialist: "Marina", branch: "b2", worktree: "w2", status: "dispatched",
    mode: "subagent", harness: "claude-code", tier: "standard", intensity: "normal",
  });
  await writeCapabilities(dir, caps);

  const r = await planCommand({ workspace: dir, journeyId: "j1" });
  expect(r.code).toBe(0);
  expect(r.lines).toEqual([
    "WAVE 1 model=(subagent — model binds per unit) units=embark@Joaquim,embark/pkgB@Marina cost-index=3",
    COST_INDEX_NOTE,
  ]);
});

test("a wave whose recorded envelopes exceed the policy's session gate is reported as GATED, through the real ledger -> planCommand path", async () => {
  const dir = await newWorkspace();
  await startJourney(dir, "j1");
  for (const [pkg, specialist] of [["a", "Joaquim"], ["b", "Marina"], ["c", "Otavio"]] as const) {
    await recordDispatch(dir, "j1", {
      repo: "embark", package: pkg, specialist, branch: `b-${pkg}`, worktree: `w-${pkg}`, status: "dispatched",
      mode: "session", harness: "claude-code", tier: "standard", intensity: "normal", model: "gpt-5",
    });
  }
  await writeCapabilities(dir, caps);

  const r = await planCommand({ workspace: dir, journeyId: "j1" });
  expect(r.code).toBe(0);
  expect(r.lines).toEqual([
    "WAVE 1 model=gpt-5 units=embark/a@Joaquim,embark/b@Marina,embark/c@Otavio cost-index=12 GATED (3 concurrent sessions exceeds the policy's gate of 2 — needs your authorization)",
    COST_INDEX_NOTE,
  ]);
});

test("without capabilities, plan refuses rather than guessing", async () => {
  const dir = await newWorkspace();
  await startJourney(dir, "j1");
  await recordDispatch(dir, "j1", {
    repo: "embark", specialist: "Joaquim", branch: "b", worktree: "w", status: "dispatched",
    mode: "subagent", harness: "claude-code", tier: "fast", intensity: "normal",
  });
  const r = await planCommand({ workspace: dir, journeyId: "j1" });
  expect(r.code).toBe(1);
  expect(r.lines).toEqual([
    "ERROR capabilities: no record — run `aipe capabilities probe` then `aipe capabilities confirm`",
  ]);
});

test("an unknown journey errors, for plan", async () => {
  const dir = await newWorkspace();
  await writeCapabilities(dir, caps);
  const r = await planCommand({ workspace: dir, journeyId: "nope" });
  expect(r.code).toBe(1);
  expect(r.lines).toEqual(["ERROR journey: no ledger for nope"]);
});

test("a journey with no units at all errors, for plan, instead of printing an empty plan", async () => {
  const dir = await newWorkspace();
  await startJourney(dir, "empty");
  await writeCapabilities(dir, caps);
  const r = await planCommand({ workspace: dir, journeyId: "empty" });
  expect(r.code).toBe(1);
  expect(r.lines).toEqual(["ERROR journey: empty has no units yet — nothing to plan for"]);
});

test("a journey whose units carry no recorded envelope tells the human to approve the Orientation Spec first", async () => {
  const dir = await newWorkspace();
  await startJourney(dir, "j1");
  await recordDispatch(dir, "j1", {
    repo: "embark", specialist: "Joaquim", branch: "b", worktree: "w", status: "dispatched",
  });
  await writeCapabilities(dir, caps);
  const r = await planCommand({ workspace: dir, journeyId: "j1" });
  expect(r.code).toBe(1);
  expect(r.lines).toEqual([
    "ERROR journey: no unit in j1 has a chosen envelope yet — approve the Orientation Spec first, then re-run `aipe execution plan`",
  ]);
});

test("a unit with no recorded envelope is excluded from the plan and noted, while the rest still plan", async () => {
  const dir = await newWorkspace();
  await startJourney(dir, "j1");
  await recordDispatch(dir, "j1", {
    repo: "embark", specialist: "Joaquim", branch: "b", worktree: "w", status: "dispatched",
    mode: "subagent", harness: "claude-code", tier: "fast", intensity: "normal",
  });
  await recordDispatch(dir, "j1", {
    repo: "embark", package: "pkgB", specialist: "Marina", branch: "b2", worktree: "w2", status: "dispatched",
  });
  await writeCapabilities(dir, caps);

  const r = await planCommand({ workspace: dir, journeyId: "j1" });
  expect(r.code).toBe(0);
  expect(r.lines).toEqual([
    "NOTE unit embark/pkgB@Marina: no envelope recorded yet — excluded from this plan",
    "WAVE 1 model=(subagent — model binds per unit) units=embark@Joaquim cost-index=1",
    COST_INDEX_NOTE,
  ]);
});

test("a session unit with mode/harness/tier/intensity recorded but no model is excluded, not planned as a mislabeled session wave", async () => {
  const dir = await newWorkspace();
  await startJourney(dir, "j1");
  await recordDispatch(dir, "j1", {
    repo: "embark", specialist: "Joaquim", branch: "b", worktree: "w", status: "dispatched",
    mode: "session", harness: "claude-code", tier: "standard", intensity: "normal",
  });
  await writeCapabilities(dir, caps);

  const r = await planCommand({ workspace: dir, journeyId: "j1" });
  expect(r.code).toBe(1);
  expect(r.lines).toEqual([
    "ERROR journey: no unit in j1 has a chosen envelope yet — approve the Orientation Spec first, then re-run `aipe execution plan`",
  ]);
});

test("a subagent unit with no model recorded is still planned normally — the model genuinely binds per unit there", async () => {
  const dir = await newWorkspace();
  await startJourney(dir, "j1");
  await recordDispatch(dir, "j1", {
    repo: "embark", specialist: "Joaquim", branch: "b", worktree: "w", status: "dispatched",
    mode: "subagent", harness: "claude-code", tier: "fast", intensity: "normal",
  });
  await writeCapabilities(dir, caps);

  const r = await planCommand({ workspace: dir, journeyId: "j1" });
  expect(r.code).toBe(0);
  expect(r.lines).toEqual([
    "WAVE 1 model=(subagent — model binds per unit) units=embark@Joaquim cost-index=1",
    COST_INDEX_NOTE,
  ]);
});

test("a mixed journey plans the complete units and calls out the session unit missing its model", async () => {
  const dir = await newWorkspace();
  await startJourney(dir, "j1");
  await recordDispatch(dir, "j1", {
    repo: "embark", package: "sessionOk", specialist: "Joaquim", branch: "b1", worktree: "w1", status: "dispatched",
    mode: "session", harness: "claude-code", tier: "standard", intensity: "normal", model: "gpt-5",
  });
  await recordDispatch(dir, "j1", {
    repo: "embark", package: "sessionNoModel", specialist: "Marina", branch: "b2", worktree: "w2", status: "dispatched",
    mode: "session", harness: "claude-code", tier: "standard", intensity: "normal",
  });
  await recordDispatch(dir, "j1", {
    repo: "embark", package: "subagentOk", specialist: "Otavio", branch: "b3", worktree: "w3", status: "dispatched",
    mode: "subagent", harness: "claude-code", tier: "fast", intensity: "normal",
  });
  await writeCapabilities(dir, caps);

  const r = await planCommand({ workspace: dir, journeyId: "j1" });
  expect(r.code).toBe(0);
  expect(r.lines).toEqual([
    "NOTE unit embark/sessionNoModel@Marina: no envelope recorded yet — excluded from this plan",
    "WAVE 1 model=gpt-5 units=embark/sessionOk@Joaquim cost-index=4",
    "WAVE 2 model=(subagent — model binds per unit) units=embark/subagentOk@Otavio cost-index=1",
    COST_INDEX_NOTE,
  ]);
});

test("a degraded capabilities record surfaces how many entries were dropped, for plan", async () => {
  const dir = await newWorkspace();
  await startJourney(dir, "j1");
  await recordDispatch(dir, "j1", {
    repo: "embark", specialist: "Joaquim", branch: "b", worktree: "w", status: "dispatched",
    mode: "subagent", harness: "claude-code", tier: "fast", intensity: "normal",
  });
  await writeRawCaps(dir, ONE_GOOD_ONE_BAD);

  const r = await planCommand({ workspace: dir, journeyId: "j1" });
  expect(r.code).toBe(0);
  expect(r.lines).toEqual([
    "WARN capabilities: 1 malformed entry discarded from the record — re-run `aipe capabilities probe` to rebuild it",
    "WAVE 1 model=(subagent — model binds per unit) units=embark@Joaquim cost-index=1",
    UNCONFIRMED_NOTE,
    COST_INDEX_NOTE,
  ]);
});

// ---------------------------------------------------------------------------
// plan — the four merge-blocker regressions, driven through the real
// ledger -> planCommand path (never groupIntoWaves in isolation: that
// isolation is exactly what let the original modeByFqid bug ship).
// ---------------------------------------------------------------------------

test("a dev subagent and a QA session on the same fqid both appear, distinguishable, correctly labelled, with no placeholder text", async () => {
  const dir = await newWorkspace();
  await startJourney(dir, "j1");
  // Dev recorded FIRST, QA SECOND — under the old modeByFqid map keyed by the
  // bare fqid, the QA row (recorded later) would overwrite the dev row's
  // mode for the shared key "embark", mislabeling the dev's subagent wave.
  await recordDispatch(dir, "j1", {
    repo: "embark", specialist: "Joaquim", branch: "b-dev", worktree: "w-dev", status: "dispatched",
    mode: "subagent", harness: "claude-code", tier: "fast", intensity: "normal",
  });
  await recordDispatch(dir, "j1", {
    repo: "embark", specialist: "Marina", branch: "b-qa", worktree: "w-qa", status: "dispatched",
    mode: "session", harness: "claude-code", tier: "standard", intensity: "normal", model: "gpt-5",
  });
  await writeCapabilities(dir, caps);

  const r = await planCommand({ workspace: dir, journeyId: "j1" });
  expect(r.code).toBe(0);
  expect(r.lines).toEqual([
    "WAVE 1 model=gpt-5 units=embark@Marina cost-index=4",
    "WAVE 2 model=(subagent — model binds per unit) units=embark@Joaquim cost-index=1",
    COST_INDEX_NOTE,
  ]);
  expect(r.lines.join("\n")).not.toContain("unreachable");
});

test("a dev and a QA both session on the same fqid, same model, appear twice as DISTINCT units — never the same unit twice in one wave", async () => {
  const dir = await newWorkspace();
  await startJourney(dir, "j1");
  await recordDispatch(dir, "j1", {
    repo: "embark", specialist: "Joaquim", branch: "b-dev", worktree: "w-dev", status: "dispatched",
    mode: "session", harness: "claude-code", tier: "standard", intensity: "normal", model: "gpt-5",
  });
  await recordDispatch(dir, "j1", {
    repo: "embark", specialist: "Marina", branch: "b-qa", worktree: "w-qa", status: "dispatched",
    mode: "session", harness: "claude-code", tier: "standard", intensity: "normal", model: "gpt-5",
  });
  await writeCapabilities(dir, caps);

  const r = await planCommand({ workspace: dir, journeyId: "j1" });
  expect(r.code).toBe(0);
  expect(r.lines).toEqual([
    "WAVE 1 model=gpt-5 units=embark@Joaquim,embark@Marina cost-index=8",
    COST_INDEX_NOTE,
  ]);
  // Exactly what dispatch/law.ts's validateBatch would REJECT as
  // `same-package embark` — a plan must never offer what dispatch refuses.
  expect(r.lines[0]).not.toContain("units=embark,embark");
});

test("three merged units and one dispatched unit — only the pending one is planned; cost and gate reflect it alone", async () => {
  const dir = await newWorkspace();
  await startJourney(dir, "j1");
  for (const [pkg, specialist] of [["a", "Joaquim"], ["b", "Marina"], ["c", "Otavio"]] as const) {
    await recordDispatch(dir, "j1", {
      repo: "embark", package: pkg, specialist, branch: `b-${pkg}`, worktree: `w-${pkg}`, status: "merged",
      mode: "session", harness: "claude-code", tier: "standard", intensity: "normal", model: "gpt-5",
    });
  }
  await recordDispatch(dir, "j1", {
    repo: "embark", package: "d", specialist: "Renata", branch: "b-d", worktree: "w-d", status: "dispatched",
    mode: "session", harness: "claude-code", tier: "standard", intensity: "normal", model: "gpt-5",
  });
  await writeCapabilities(dir, caps);

  const r = await planCommand({ workspace: dir, journeyId: "j1" });
  expect(r.code).toBe(0);
  expect(r.lines).toEqual([
    'NOTE unit embark/a@Joaquim: status "merged" is not pending — excluded from this plan',
    'NOTE unit embark/b@Marina: status "merged" is not pending — excluded from this plan',
    'NOTE unit embark/c@Otavio: status "merged" is not pending — excluded from this plan',
    "WAVE 1 model=gpt-5 units=embark/d@Renata cost-index=4",
    COST_INDEX_NOTE,
  ]);
});

test("a session envelope on codex is excluded with a stated reason, not planned as a clean wave", async () => {
  const dir = await newWorkspace();
  await startJourney(dir, "j1");
  await recordDispatch(dir, "j1", {
    repo: "embark", specialist: "Joaquim", branch: "b", worktree: "w", status: "dispatched",
    mode: "subagent", harness: "claude-code", tier: "fast", intensity: "normal",
  });
  await recordDispatch(dir, "j1", {
    repo: "embark", package: "pkgB", specialist: "Marina", branch: "b2", worktree: "w2", status: "dispatched",
    mode: "session", harness: "codex", tier: "standard", intensity: "normal", model: "codex-model",
  });
  await writeCapabilities(dir, CAPS_WITH_CODEX);

  const r = await planCommand({ workspace: dir, journeyId: "j1" });
  expect(r.code).toBe(0);
  expect(r.lines).toEqual([
    "NOTE unit embark/pkgB@Marina: harness codex excluded — not containable — AIPe never starts a session it cannot govern",
    "WAVE 1 model=(subagent — model binds per unit) units=embark@Joaquim cost-index=1",
    COST_INDEX_NOTE,
  ]);
});

test("only unit is a session envelope on codex (not containable) — outputs the reason, not the approve-spec message", async () => {
  const dir = await newWorkspace();
  await startJourney(dir, "j1");
  await recordDispatch(dir, "j1", {
    repo: "embark", specialist: "Joaquim", branch: "b", worktree: "w", status: "dispatched",
    mode: "session", harness: "codex", tier: "standard", intensity: "normal", model: "codex-model",
  });
  await writeCapabilities(dir, CAPS_WITH_CODEX);

  const r = await planCommand({ workspace: dir, journeyId: "j1" });
  expect(r.code).toBe(1);
  expect(r.lines).toEqual([
    "NOTE unit embark@Joaquim: harness codex excluded — not containable — AIPe never starts a session it cannot govern",
    "ERROR journey: no unit in j1 is eligible for planning — see the exclusion reasons above",
    COST_INDEX_NOTE,
  ]);
});

test("only unit is a session envelope on an absent harness — outputs its reason, not the approve-spec message", async () => {
  const dir = await newWorkspace();
  await startJourney(dir, "j1");
  await recordDispatch(dir, "j1", {
    repo: "embark", specialist: "Joaquim", branch: "b", worktree: "w", status: "dispatched",
    mode: "session", harness: "gemini", tier: "standard", intensity: "normal", model: "some-model",
  });
  // caps only has claude-code, so gemini is absent from this machine
  await writeCapabilities(dir, caps);

  const r = await planCommand({ workspace: dir, journeyId: "j1" });
  expect(r.code).toBe(1);
  expect(r.lines).toEqual([
    "NOTE unit embark@Joaquim: harness gemini excluded — not present on this machine",
    "ERROR journey: no unit in j1 is eligible for planning — see the exclusion reasons above",
    COST_INDEX_NOTE,
  ]);
});

test("--journey missing errors via run() for plan too", async () => {
  const originalLog = console.log;
  const logged: string[] = [];
  console.log = (msg: string) => logged.push(msg);
  try {
    const { run } = await import("../cli");
    const code = await run(["plan"]);
    expect(code).toBe(1);
    expect(logged).toEqual(["ERROR journey: --journey <id> is required"]);
  } finally {
    console.log = originalLog;
  }
});

test("run() shows help for no subcommand, and refuses an unknown one", async () => {
  const { run } = await import("../cli");
  const originalLog = console.log;
  const logged: string[] = [];
  console.log = (msg: string) => logged.push(msg);
  try {
    // HELP is one multi-line string printed in a single console.log, so the
    // whole block lands in logged[0] — assert on its first LINE, not the block.
    const bare = await run([]);
    expect(bare).toBe(0);
    expect(logged[0]!.split("\n")[0]).toBe(
      "aipe execution — price and plan the ways a journey's units could be run",
    );
    expect(logged[0]).toContain("propose --journey");
    expect(logged[0]).toContain("plan    --journey");

    logged.length = 0;
    const help = await run(["--help"]);
    expect(help).toBe(0);

    // An unknown subcommand must NOT exit 0: a caller that carries on as if the
    // work happened is worse than one that stops.
    logged.length = 0;
    const bogus = await run(["bogus"]);
    expect(bogus).toBe(1);
  } finally {
    console.log = originalLog;
  }
});
