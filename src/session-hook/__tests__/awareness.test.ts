import { expect, test } from "bun:test";
import { buildAwareness, buildPersonaAwareness, renderSessionContext } from "../awareness";
import type { Fields } from "../read-state";

function fields(over: Partial<Fields>): Fields {
  return {
    brain: "present",
    contextName: "opvibes",
    coordinator: "Nicolas",
    pe: "",
    phaseBrain: "done",
    phaseWorkspace: "pending",
    phaseRelationship: "pending",
    phaseSpecialists: "pending",
    repos: ["embark", "prontuario"],
    root: "/tmp/aipe-opvibes",
    repoAtCwd: null,
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

test("buildPersonaAwareness lists every persona hired for the repo, without guessing a single identity", () => {
  const body = buildPersonaAwareness(
    fields({ pe: "Bruno" }),
    { name: "embark", path: "./embark" },
    { personas: [{ name: "Alice", role: "dev-fullstack" }, { name: "Bob", role: "qa" }], edges: [] },
  );
  expect(body).toContain("Alice");
  expect(body).toContain("dev-fullstack");
  expect(body).toContain("Bob");
  expect(body).toContain("qa");
  expect(body).not.toContain("DISPATCH GATE");
});

test("buildPersonaAwareness includes the PE's name when set", () => {
  const body = buildPersonaAwareness(
    fields({ pe: "Bruno" }),
    { name: "embark", path: "./embark" },
    { personas: [], edges: [] },
  );
  expect(body).toContain("Bruno");
});

test("buildPersonaAwareness degrades gracefully when the PE's name is not set", () => {
  const body = buildPersonaAwareness(
    fields({ pe: "" }),
    { name: "embark", path: "./embark" },
    { personas: [], edges: [] },
  );
  expect(body).toContain("opvibes");
  expect(body).not.toContain("undefined");
});

test("buildPersonaAwareness surfaces this repo's relations", () => {
  const body = buildPersonaAwareness(
    fields({}),
    { name: "embark", path: "./embark" },
    {
      personas: [],
      edges: [
        { from: "embark", to: "prontuario", type: "consumes", perspectives: [{ detail: "calls the payments API", evidence: "x.ts:1" }] },
      ],
    },
  );
  expect(body).toContain("prontuario");
  expect(body).toContain("consumes");
  expect(body).toContain("calls the payments API");
});

test("buildPersonaAwareness with no relations states so explicitly", () => {
  const body = buildPersonaAwareness(fields({}), { name: "embark", path: "./embark" }, { personas: [], edges: [] });
  expect(body.toLowerCase()).toContain("no known relations");
});

test("renderSessionContext with repoAtCwd + personaCtx emits persona-mode text", () => {
  const json = renderSessionContext(
    fields({ repoAtCwd: { name: "embark", path: "./embark" } }),
    { personas: [{ name: "Alice", role: "dev-fullstack" }], edges: [] },
  );
  const parsed = JSON.parse(json);
  expect(parsed.hookSpecificOutput.additionalContext).toContain("Alice");
  expect(parsed.hookSpecificOutput.additionalContext).not.toContain("DISPATCH GATE");
});

test("renderSessionContext with repoAtCwd null still emits coordinator-mode text (unchanged)", () => {
  const json = renderSessionContext(fields({ brain: "absent" }));
  const parsed = JSON.parse(json);
  expect(parsed.hookSpecificOutput.additionalContext).toContain("/context-brain");
});

test("buildPersonaAwareness sanitizes C0 control chars in persona names and relation details", () => {
  const body = buildPersonaAwareness(
    fields({}),
    { name: "emb\x0bark", path: "./embark" },
    {
      personas: [{ name: "Al\x0bice", role: "dev-fullstack" }],
      edges: [
        {
          from: "emb\x0bark",
          to: "prontuario",
          type: "consumes",
          perspectives: [{ detail: "calls\x0bthe API", evidence: "x.ts:1" }],
        },
      ],
    },
  );
  // biome-ignore lint: needs to explicitly test C0 control characters
  expect(/[\x00-\x1f]/.test(body.replace(/\n/g, ""))).toBe(false);
  expect(body).toContain("Al ice");
  expect(body).toContain("calls the API");
});
