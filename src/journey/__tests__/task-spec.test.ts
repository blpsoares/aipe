// The Task Spec validator — R5 of the approved design, and the one place the
// day's core defect can be refused mechanically.
//
// The failure being removed: acceptance written as MECHANISM, which a QA can
// "verify" by transcribing it, versus acceptance written as CONSEQUENCE, which
// a QA has to make HAPPEN. A validator cannot judge that prose is truly a
// consequence — that is substance, and a gate claiming to check substance lies.
// It can refuse the SHAPE that lets mechanism hide: name the action AND the
// effect, and pair every criterion with the test the QA will run.
import { expect, test } from "bun:test";
import {
  parseAcceptanceItems,
  renderTaskSpecTemplate,
  sectionBody,
  validateTaskSpec,
} from "../task-spec";

// A complete, well-formed Task Spec, written the way the design demands.
const GOOD = `# Task Spec — aipe/serve (j1)

## Objective
The live terminal can be typed into.

## Acceptance
- **A1** — Action: type \`ls\` into the terminal and press Enter · Effect: the
  command runs and its output appears in the pane
- **A2** — Action: open a session that is already finished · Effect: the final
  frame stays populated instead of clearing

## Tests the QA runs
- **A1** — drive a real browser, send keystrokes, assert the pane text contains
  the listing
- **A2** — open a closed session, assert \`pane.textContent\` is non-empty

## Constraints
- No change to the wire protocol.

## Anti-regression
- disableStdin blocked typing → a test that asserts keystrokes reach the pty

## Out of scope
- Session recording.
`;

test("a complete, consequence-shaped Task Spec validates", () => {
  const c = validateTaskSpec(GOOD);
  expect(c.ok).toBe(true);
  expect(c.missingSections).toEqual([]);
  expect(c.untestedItems).toEqual([]);
});

test("the untouched scaffold NEVER validates — a template is not a spec", () => {
  const c = validateTaskSpec(renderTaskSpecTemplate("j1", "aipe/serve"));
  expect(c.ok).toBe(false);
  expect(c.placeholders.length).toBeGreaterThan(0);
});

test("MECHANISM-shaped acceptance is refused, naming what the item lacks", () => {
  // The real one from the incident: it names a token to use, and there is
  // nothing a person could observe — so no Effect can be written for it.
  const md = GOOD.replace(
    "- **A2** — Action: open a session that is already finished · Effect: the final\n  frame stays populated instead of clearing",
    "- **A2** — use the `--st-escalated` token and load `previousCycle`",
  );
  const c = validateTaskSpec(md);
  expect(c.ok).toBe(false);
  expect(c.mechanismOnly).toHaveLength(1);
  expect(c.mechanismOnly[0]!.missing).toEqual(["an Action", "an Effect"]);
});

test("an item with an Action but no observable Effect is refused", () => {
  const md = GOOD.replace(
    "· Effect: the\n  command runs and its output appears in the pane",
    "",
  );
  const c = validateTaskSpec(md);
  expect(c.ok).toBe(false);
  expect(c.mechanismOnly[0]!.missing).toEqual(["an Effect"]);
});

test("an acceptance item with no QA test is refused — the QA must not invent one", () => {
  // drop A2's line from the QA section, leaving the criterion untested
  const md = GOOD.split("\n").filter((l) => !/^- \*\*A2\*\* — open a closed session/.test(l)).join("\n");
  const c = validateTaskSpec(md);
  expect(c.ok).toBe(false);
  expect(c.untestedItems).toEqual(["A2"]);
});

test("an Acceptance heading with no items is refused — a heading is not a criterion", () => {
  const md = `## Objective
x

## Acceptance

## Tests the QA runs
none

## Constraints
- none

## Anti-regression
- none

## Out of scope
- none
`;
  const c = validateTaskSpec(md);
  expect(c.ok).toBe(false);
  expect(c.noAcceptance).toBe(true);
});

test("a missing section is reported AS a missing section, never as a placeholder problem", () => {
  // The measured trap: the operator-facing message said "replace every
  // placeholder" when what was actually absent was a required section, sending
  // people hunting for chevrons that were not there.
  const md = GOOD.replace("## Anti-regression\n- disableStdin blocked typing → a test that asserts keystrokes reach the pty\n\n", "");
  const c = validateTaskSpec(md);
  expect(c.ok).toBe(false);
  expect(c.missingSections).toEqual(["Anti-regression"]);
  expect(c.placeholders).toEqual([]);
});

test("a chevron inside a code block is quoted evidence, not an unfilled slot", () => {
  const md = GOOD.replace("## Constraints\n- No change to the wire protocol.", "## Constraints\n- Keep the generic signature:\n\n```ts\nfunction f<T>(x: T): T\n```\n");
  const c = validateTaskSpec(md);
  expect(c.placeholders).toEqual([]);
  expect(c.ok).toBe(true);
});

test("a criterion may wrap across lines without becoming a second, empty item", () => {
  expect(parseAcceptanceItems(GOOD)).toHaveLength(2);
});

test("blockquote guidance in the template is never read as a criterion", () => {
  const items = parseAcceptanceItems(renderTaskSpecTemplate("j1", "u"));
  expect(items).toHaveLength(1); // only the A1 slot, not the `>` guidance lines
});

test("sectionBody stops at the next heading", () => {
  expect(sectionBody(GOOD, "Objective").trim()).toBe("The live terminal can be typed into.");
});
