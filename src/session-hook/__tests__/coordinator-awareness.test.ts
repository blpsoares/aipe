import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { coordinatorAwareness, pickPid, pickSessionName } from "../coordinator-awareness";
import type { Fields } from "../read-state";
import { DEFAULT_STATUS_PREF } from "../../status/types";

let ws: string;
beforeEach(async () => {
  ws = await mkdtemp(join(tmpdir(), "aipe-coord-aware-"));
});
afterEach(async () => {
  await rm(ws, { recursive: true, force: true });
});

function onboarded(root: string): Fields {
  return {
    brain: "present",
    contextName: "blpsoares",
    coordinator: "Heisenberg",
    pe: "bryao",
    phaseBrain: "done",
    phaseWorkspace: "done",
    phaseRelationship: "done",
    phaseSpecialists: "done",
    repos: ["aipe"],
    root,
    repoAtCwd: null,
    statusUpdates: DEFAULT_STATUS_PREF,
  };
}

test("pickSessionName prefers the agentop session name, falls back to the coordinator name", () => {
  expect(pickSessionName({ AGENTOP_SESSION_NAME: "COORDENADOR" }, "Heisenberg")).toBe("COORDENADOR");
  expect(pickSessionName({}, "Heisenberg")).toBe("Heisenberg");
});

test("pickPid reads a real pid from env, else 0 (unverifiable, treated alive)", () => {
  expect(pickPid({ AIPE_SESSION_PID: "4242" })).toBe(4242);
  expect(pickPid({ AGENTOP_SESSION_PID: "77" })).toBe(77);
  expect(pickPid({})).toBe(0);
  expect(pickPid({ AIPE_SESSION_PID: "not-a-pid" })).toBe(0);
});

test("a fresh coordinator session registers and gets a solo-identity awareness line", async () => {
  const txt = await coordinatorAwareness(onboarded(ws), { AGENTOP_SESSION_NAME: "COORDENADOR", AIPE_SESSION_PID: "111" });
  expect(txt).toContain("coordinator identity");
  expect(txt).toContain("COORDENADOR");
});

test("a SECOND coordinator session on the same workspace is warned, actionably", async () => {
  // No pid supplied ⇒ the real coordinator case: pid 0, unverifiable, treated as
  // alive — so the first is NOT pruned and the second must warn about it.
  await coordinatorAwareness(onboarded(ws), { AGENTOP_SESSION_NAME: "COORDENADOR" });
  const txt = await coordinatorAwareness(onboarded(ws), { AGENTOP_SESSION_NAME: "COORD-2" });
  expect(txt).toContain("SECOND coordinator");
  expect(txt).toContain("Heisenberg");
  expect(txt.toLowerCase()).toContain("attach");
});

test("mid-onboarding there is no coordinator identity to register — awareness is empty (degrade)", async () => {
  const f = onboarded(ws);
  f.phaseSpecialists = "pending";
  expect(await coordinatorAwareness(f, {})).toBe("");
});

test("a broken workspace never throws — awareness degrades to empty", async () => {
  const f = onboarded("/no/such/path/at/all");
  expect(await coordinatorAwareness(f, {})).toBe("");
});
