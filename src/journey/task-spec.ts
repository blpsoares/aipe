// The TASK SPEC (layer 2 of the approved spec-writer design) — the per-unit
// implementation spec that a specialist RECEIVES, never authors.
//
// Layer 1 (Orientation Spec, spec.ts) is the coordinator's cross-package "what
// and why", approved by the PE. Layer 3 is the specialist's code. Between them
// sat nothing, and that gap is the measured defect: the acceptance criteria a
// QA verified against were free prose, so the QA invented its own proxy for
// "done" — it proved a stream connected, it proved a header summary changed —
// while the thing the PE asked for (being able to TYPE in the terminal) was
// never anyone's criterion. Three features, six approved gates, three PE
// rejections of work that had already passed.
//
// So this file's whole job is to make one shape impossible: acceptance that
// describes MECHANISM. From the post-mortem of the specialist who ran seven
// rounds of the same scene:
//
//   "mecanismo eu transcrevo literal; consequência eu teria que fazer ACONTECER."
//
// Wrong: "use the --st-escalated token" · "load previousCycle".
// Right: "a task in progress is distinguishable from a stopped one — prove it
// by alternating" · "when it finishes, the final frame stays populated".
//
// A validator cannot judge whether prose describes a consequence — that is
// substance, and gates that claim to check substance are lying. What it CAN do
// is refuse a shape that lets mechanism hide: every acceptance item must name
// the ACTION exercised and the EFFECT observed, as two separate obligations.
// Naming the effect is where a mechanism-only criterion falls apart, because
// "use token X" has no observable effect to write down.
import { findPlaceholders, hashOrientationContent } from "./spec";

// The Task Spec's version tracks CONTENT, by the same rule and the same hash as
// the Orientation Spec's — a spec edited after approval must be detectable
// without anyone remembering to bump a counter. Deliberately the same function:
// two content-hash rules that could drift is exactly one rule too many.
export const hashTaskSpecContent = hashOrientationContent;

export const TASK_SPEC_SECTIONS = [
  "Objective",
  "Acceptance",
  "Tests the QA runs",
  "Constraints",
  "Anti-regression",
  "Out of scope",
] as const;

// Renders the canonical Task Spec scaffold for one unit. Every slot is a
// `<...>` placeholder, so an unedited scaffold can never pass `--approve`.
export function renderTaskSpecTemplate(journeyId: string, fqid: string): string {
  return `# Task Spec — ${fqid} (${journeyId})

> Written for this unit by a spec writer, **approved by the PE before any code**.
> The specialist implementing this does NOT write it — it receives it, and may
> REFUSE it (record \`blocked\` with the reason) if it is ambiguous, not
> implementable, or contradicted by the code. The QA does not invent criteria
> either: it runs what "Tests the QA runs" says, item by item.

## Objective
<the CONSEQUENCE the PE wants — what becomes true for a person using this.
Not the mechanism that will produce it.>

## Acceptance
> One item per criterion. Each names the ACTION exercised and the EFFECT
> observed. If you cannot write an effect someone could see, you are describing
> mechanism and this is not yet an acceptance criterion.

- **A1** — Action: <what someone does to exercise it> · Effect: <what they
  observe as a result — the part that would be missing if the work failed>

## Tests the QA runs
> These are the tests, agreed BEFORE the code exists. The QA executes these; it
> does not author its own. One entry per acceptance item above.

- **A1** — <the exact command, interaction, or measurement, and what its output
  must show>

## Constraints
> First-class restrictions the implementation may not trade away: the medium
> (animation, latency, layout), contracts it must not break, platforms it must
> keep working.

- <constraint>

## Anti-regression
> One test per defect already reported on this unit, so a fixed defect cannot
> come back silently. Empty only if nothing has ever been reported here.

- <defect already reported> → <the test that now catches it>

## Out of scope
- <what this unit explicitly does not touch>
`;
}

export interface AcceptanceItem {
  label: string; // e.g. "A1", or the raw bullet text when unlabelled
  hasAction: boolean;
  hasEffect: boolean;
}

// The body of one `## <name>` section, up to the next `##` heading of the same
// or higher level. Returns "" when the section is absent.
export function sectionBody(md: string, name: string): string {
  const lines = md.split("\n");
  const start = lines.findIndex((l) => new RegExp(`^##\\s+${escapeRe(name)}\\s*$`).test(l));
  if (start < 0) return "";
  const end = lines.findIndex((l, i) => i > start && /^#{1,2}\s/.test(l));
  return lines.slice(start + 1, end < 0 ? undefined : end).join("\n");
}

// Acceptance items are the top-level `- ` bullets of the Acceptance section.
// Blockquote lines (`>`) are guidance in the template, never criteria, and
// continuation lines belong to the bullet they follow — so a criterion may wrap
// across lines without becoming a second, half-empty item.
export function parseAcceptanceItems(md: string): AcceptanceItem[] {
  const items: AcceptanceItem[] = [];
  let current: string | null = null;
  const flush = (): void => {
    if (current === null) return;
    const text = current;
    const label = /\*\*([^*]+)\*\*/.exec(text)?.[1]?.trim() ?? text.trim().slice(0, 40);
    items.push({
      label,
      hasAction: /\bAction:/i.test(text),
      hasEffect: /\bEffect:/i.test(text),
    });
    current = null;
  };
  for (const line of sectionBody(md, "Acceptance").split("\n")) {
    if (/^\s*>/.test(line)) continue;
    if (/^\s*[-*]\s+/.test(line)) {
      flush();
      current = line;
    } else if (current !== null && line.trim() !== "") {
      current += `\n${line}`;
    }
  }
  flush();
  return items;
}

export interface TaskSpecCheck {
  ok: boolean;
  missingSections: string[];
  placeholders: string[];
  // Acceptance items that name no ACTION and/or no EFFECT — the mechanism-shaped
  // criteria this validator exists to refuse.
  mechanismOnly: { label: string; missing: string[] }[];
  // An Acceptance section with no items at all: structurally present, says
  // nothing. A heading is not a criterion.
  noAcceptance: boolean;
  // Acceptance items with no matching entry under "Tests the QA runs": the QA
  // would have to invent that one, which is the whole failure being removed.
  untestedItems: string[];
}

export function validateTaskSpec(md: string): TaskSpecCheck {
  const missingSections = TASK_SPEC_SECTIONS.filter(
    (s) => !new RegExp(`^##\\s+${escapeRe(s)}\\s*$`, "m").test(md),
  );
  const placeholders = findPlaceholders(md);
  const items = parseAcceptanceItems(md);
  const mechanismOnly = items
    .map((i) => ({
      label: i.label,
      missing: [...(i.hasAction ? [] : ["an Action"]), ...(i.hasEffect ? [] : ["an Effect"])],
    }))
    .filter((i) => i.missing.length > 0);

  // Every acceptance item must be named in the QA section. Matched by LABEL, so
  // the two lists stay coupled by identity rather than by count — three items
  // and three tests that test the wrong three would otherwise pass.
  const tests = sectionBody(md, "Tests the QA runs");
  const untestedItems = items
    .filter((i) => !new RegExp(`\\b${escapeRe(i.label)}\\b`).test(tests))
    .map((i) => i.label);

  return {
    ok:
      missingSections.length === 0 &&
      placeholders.length === 0 &&
      items.length > 0 &&
      mechanismOnly.length === 0 &&
      untestedItems.length === 0,
    missingSections,
    placeholders,
    mechanismOnly,
    noAcceptance: items.length === 0,
    untestedItems,
  };
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Where a unit's Task Spec lives, relative to the workspace. One deterministic
// path per (journey, unit) so the scaffolder, the approver, the dispatcher and
// the specialist all name the same file without passing it around. `/` in an
// fqid (`repo/package`) becomes `__`: a nested directory would make the file
// collide with a repo of that name and complicate nothing usefully.
export function taskSpecRelPath(journeyId: string, fqid: string): string {
  return `.aipe/journeys/${journeyId}/task-specs/${fqid.replace(/\//g, "__")}.md`;
}
