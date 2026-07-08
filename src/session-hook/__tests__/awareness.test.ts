import { expect, test } from "bun:test";
import { buildAwareness, renderSessionContext } from "../awareness";
import type { Fields } from "../read-state";

function fields(over: Partial<Fields>): Fields {
  return {
    brain: "present",
    contextName: "opvibes",
    coordinator: "Nicolas",
    phaseBrain: "done",
    phaseWorkspace: "pending",
    phaseRelationship: "pending",
    phaseSpecialists: "pending",
    repos: ["embark", "prontuario"],
    ...over,
  };
}

test("no brain → proactive onboarding via /context-brain", () => {
  const body = buildAwareness(fields({ brain: "absent" }));
  expect(body).toContain("/context-brain");
  expect(body).toContain("coordinator name");
  expect(body).toContain("aipe- prefix");
  expect(body).toContain("exit AIPe mode");
});

test("in progress → points at the current next step and asks for a new session", () => {
  const body = buildAwareness(fields({ phaseWorkspace: "pending" }));
  expect(body).toContain("being configured");
  expect(body).toContain("/make-workspace");
  expect(body).toContain("NEW session");
  // identity guard: the coordinator name is the AI's own, never the PE's
  expect(body).toContain("You ARE Nicolas");
  expect(body).toContain("never address the PE");
});

test("next step advances with phases", () => {
  expect(buildAwareness(fields({ phaseWorkspace: "done" }))).toContain("/relationship");
  expect(buildAwareness(fields({ phaseWorkspace: "done", phaseRelationship: "done" }))).toContain("/hire-specialists");
});

test("all done → full coordinator awareness with repos", () => {
  const body = buildAwareness(
    fields({ phaseWorkspace: "done", phaseRelationship: "done", phaseSpecialists: "done" }),
  );
  expect(body).toContain("You ARE Nicolas");
  expect(body).toContain("embark");
  expect(body).toContain("Ready to receive requests");
});

test("operant coordinator carries the MUST dispatch gate + non-exception table", () => {
  const body = buildAwareness(
    fields({ phaseWorkspace: "done", phaseRelationship: "done", phaseSpecialists: "done" }),
  );
  expect(body).toContain("DISPATCH GATE");
  expect(body).toContain("MUST");
  // the four non-negotiable rationalizations
  expect(body).toContain("simple");
  expect(body).toContain("urgent");
  expect(body).toContain("interactive");
  expect(body).toContain("security-sensitive");
  expect(body).toContain("one file");
  expect(body).toContain("already investigated");
});

test("operant coordinator declares its allowed actions and that editing is never one", () => {
  const body = buildAwareness(
    fields({ phaseWorkspace: "done", phaseRelationship: "done", phaseSpecialists: "done" }),
  );
  expect(body).toContain("decompose");
  expect(body).toContain("dispatch");
  expect(body).toContain("read-only");
  expect(body).toContain("escalate");
  // editing a repo is NEVER a coordinator action
  expect(body).toContain("never");
  expect(body).toContain("edit");
});

test("only an explicit PE opt-out dispenses dispatch (casual does not count)", () => {
  const body = buildAwareness(
    fields({ phaseWorkspace: "done", phaseRelationship: "done", phaseSpecialists: "done" }),
  );
  expect(body).toContain("EXPLICITLY");
  expect(body).toContain("casual");
});

test("operant coordinator carries the precedence-envelope clause", () => {
  const body = buildAwareness(
    fields({ phaseWorkspace: "done", phaseRelationship: "done", phaseSpecialists: "done" }),
  );
  expect(body).toContain("routing");
  expect(body).toContain("systematic-debugging");
  expect(body).toContain("TDD");
  expect(body).toContain("INSIDE");
  // process-skills are not turned off
  expect(body).toContain("NOT disabled");
});

test("operant coordinator documents the QA gate before done", () => {
  const body = buildAwareness(
    fields({ phaseWorkspace: "done", phaseRelationship: "done", phaseSpecialists: "done" }),
  );
  expect(body).toContain("QA");
  expect(body).toContain("gate");
});

test("renderSessionContext emits valid SessionStart hook JSON", () => {
  const json = renderSessionContext(fields({ brain: "absent" }));
  const parsed = JSON.parse(json);
  expect(parsed.hookSpecificOutput.hookEventName).toBe("SessionStart");
  expect(parsed.hookSpecificOutput.additionalContext).toContain("/context-brain");
});
