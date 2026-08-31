// The coordinator's Orientation Spec: a durable, PE-approved, cross-package
// specification for a demand, written before any dispatch. Lightweight and
// cross-package by design (the implementation detail is the specialist's own SDD,
// scoped to its package and committed into its PR). Pure template + validator.
import { createHash } from "node:crypto";

// D1 (j-20260830-w0) — the ORIGIN of a spec's version, so it tracks CONTENT
// rather than a hand-typed counter. A coordinator who edits orientation.md
// directly (no `--amend`) used to leave `spec.version` frozen at whatever it
// was, so nothing downstream could tell the file had changed. This hash is
// the ground truth the write path (journey/cli.ts specCommand) and the
// dispatch path (session/cli.ts dispatchCommand) both compare the CURRENT
// file against, bumping the recorded version only when it genuinely differs.
// Whitespace-only edits do not count as content change (trimmed first).
export function hashOrientationContent(md: string): string {
  return createHash("sha256").update(md.trim()).digest("hex").slice(0, 8);
}

export const SPEC_SECTIONS = [
  "Problem",
  "Cross-package contracts",
  "Per-package scope",
  "Sequencing",
  "Out of scope",
] as const;

// Renders the canonical template with one scope section per unit (a unit is a
// package fqid, or a bare repo name for a flat repo).
export function renderOrientationTemplate(journeyId: string, units: string[]): string {
  const perUnit = (units.length ? units : ["<unit>"])
    .map((u) => `### ${u}\n- **Scope:** <what this unit must do — this unit only>\n- **Acceptance:** <how we know it's done: behaviour + green tests>\n`)
    .join("\n");
  return `# Orientation Spec — ${journeyId}

> The coordinator's cross-package orientation for this demand. The PE **approves**
> this before any dispatch. Amend it (bump the version) when an escalation changes
> the cross-package shape, then get re-approval. Implementation detail belongs to
> each specialist's own SDD (committed into its PR), not here.

## Problem
<why this matters / the objective, from the PE's demand>

## Cross-package contracts
<the contracts between units, pulled from relations/graph.yaml: who
consumes/imports what, and which unit must change first>

## Per-package scope
${perUnit}
## Sequencing
- **Wave 1:** <units with no unmet dependency>
- **Wave 2:** <units depending on wave 1>

## Out of scope
- <what this demand explicitly does not touch>
`;
}

// The section whose `### <unit>` subsections ARE the journey's units. Kept as a
// named constant so the writer (renderOrientationTemplate) and the reader
// (parseOrientationUnits) can never drift on the heading text.
const PER_PACKAGE_SCOPE = "Per-package scope";

/**
 * Pure: the units a spec declares, read back from its rendered form — the
 * `### <unit>` subsections under `## Per-package scope`.
 *
 * A journey's units are never persisted structurally; the orientation.md
 * headings are the record, and they exist BEFORE any dispatch. This is what lets
 * `execution propose` price a spec's units with zero dispatches on the ledger.
 * Scoped to the Per-package scope section on purpose: a real spec carries `###`
 * headings under other sections too (`### Confirmados`, `### A verificar`), and
 * those are prose, not units.
 */
export function parseOrientationUnits(md: string): string[] {
  const units: string[] = [];
  let inScope = false;
  for (const line of md.split("\n")) {
    const h2 = line.match(/^##\s+(.+?)\s*$/);
    if (h2) {
      inScope = h2[1] === PER_PACKAGE_SCOPE;
      continue;
    }
    if (!inScope) continue;
    const h3 = line.match(/^###\s+(.+?)\s*$/);
    if (h3) units.push(h3[1]!.trim());
  }
  return units;
}

// An unsubstituted template slot: angle-bracketed guidance text left intact from
// renderOrientationTemplate (`<why this matters …>`, `<unit>`, `<what this unit
// must do …>`). A real, filled spec has none — the PE replaces every one before
// approval. A URL autolink (`<https://…>`, `<mailto:…>`) is NOT a slot, so those
// shapes are excluded and a spec may legitimately cite a link. Matches are single
// runs on one line (no nesting, no newline) so a stray `<` can't swallow a page.
const PLACEHOLDER_RE = /<(?!https?:\/\/|mailto:)[^<>\n]+>/g;

// Markdown code — fenced blocks (``` / ~~~) and inline spans (`…`) — is QUOTED
// material, not template slots. A spec that cites a command's real output or an
// example invocation legitimately carries chevron-shaped text inside code
// (`--pr <url>`, `<command you ran>`, an `<html>` tag in a doc about rendering
// HTML). Flagging those forced people to mutilate the evidence to get a spec
// approved (#82). Stripping code before scanning keeps the check honest: it
// flags only unfilled slots in the prose the PE is meant to substitute. Prose
// chevrons outside code are still slots — the only reliable place to quote
// literal `<…>` is inside code, which is where markdown puts it anyway.
function stripCode(md: string): string {
  const out: string[] = [];
  let fence: string | null = null; // the ``` / ~~~ run that opened the current block
  for (const line of md.split("\n")) {
    const m = line.match(/^\s*(```+|~~~+)/);
    if (fence) {
      // Inside a fenced block: drop the line; close on a fence of the same kind,
      // at least as long as the opener (CommonMark's closing rule).
      if (m && m[1]![0] === fence[0] && m[1]!.length >= fence.length) fence = null;
      continue;
    }
    if (m) {
      fence = m[1]!; // opening fence line is code too — drop it
      continue;
    }
    // Outside a fence: strip inline code spans on this line. A run of N
    // backticks opens and the next run closes; the rough `+…`+ match is enough
    // to erase quoted `<…>` without touching prose.
    out.push(line.replace(/`+[^`]*`+/g, ""));
  }
  return out.join("\n");
}

// The distinct unsubstituted placeholders still present in the body — order-
// preserving, de-duplicated. An empty array means every slot was filled. Code
// (fenced or inline) is quoted evidence, not slots, so it is stripped first.
export function findPlaceholders(md: string): string[] {
  const seen = new Set<string>();
  for (const m of stripCode(md).matchAll(PLACEHOLDER_RE)) seen.add(m[0]);
  return [...seen];
}

export interface OrientationCheck {
  ok: boolean;
  missingSections: string[];
  missingUnits: string[];
  placeholders: string[];
}

// Validates that every canonical section heading is present, that every unit
// in the batch has a `### <unit>` scope subsection, AND that no unsubstituted
// `<...>` placeholder survives — a template with its slots intact is not a
// filled spec, so a structurally-complete-but-unedited scaffold is NOT ok.
export function validateOrientation(md: string, units: string[]): OrientationCheck {
  const missingSections = SPEC_SECTIONS.filter((s) => !new RegExp(`^##\\s+${escapeRe(s)}\\s*$`, "m").test(md));
  const missingUnits = units.filter((u) => !new RegExp(`^###\\s+${escapeRe(u)}\\s*$`, "m").test(md));
  const placeholders = findPlaceholders(md);
  return {
    ok: missingSections.length === 0 && missingUnits.length === 0 && placeholders.length === 0,
    missingSections,
    missingUnits,
    placeholders,
  };
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
