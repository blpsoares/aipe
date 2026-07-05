// The coordinator's Orientation Spec: a durable, PE-approved, cross-module
// specification for a demand, written before any dispatch. Lightweight and
// cross-module by design (the implementation detail is the specialist's own SDD,
// scoped to its module and committed into its PR). Pure template + validator.
export const SPEC_SECTIONS = [
  "Problem",
  "Cross-module contracts",
  "Per-module scope",
  "Sequencing",
  "Out of scope",
] as const;

// Renders the canonical template with one scope section per unit (a unit is a
// module fqid, or a bare repo name for a flat repo).
export function renderOrientationTemplate(journeyId: string, units: string[]): string {
  const perUnit = (units.length ? units : ["<unit>"])
    .map((u) => `### ${u}\n- **Scope:** <what this unit must do — this unit only>\n- **Acceptance:** <how we know it's done: behaviour + green tests>\n`)
    .join("\n");
  return `# Orientation Spec — ${journeyId}

> The coordinator's cross-module orientation for this demand. The PE **approves**
> this before any dispatch. Amend it (bump the version) when an escalation changes
> the cross-module shape, then get re-approval. Implementation detail belongs to
> each specialist's own SDD (committed into its PR), not here.

## Problem
<why this matters / the objective, from the PE's demand>

## Cross-module contracts
<the contracts between units, pulled from relations/graph.yaml: who
consumes/imports what, and which unit must change first>

## Per-module scope
${perUnit}
## Sequencing
- **Wave 1:** <units with no unmet dependency>
- **Wave 2:** <units depending on wave 1>

## Out of scope
- <what this demand explicitly does not touch>
`;
}

export interface OrientationCheck {
  ok: boolean;
  missingSections: string[];
  missingUnits: string[];
}

// Validates that every canonical section heading is present and that every unit
// in the batch has a `### <unit>` scope subsection.
export function validateOrientation(md: string, units: string[]): OrientationCheck {
  const missingSections = SPEC_SECTIONS.filter((s) => !new RegExp(`^##\\s+${escapeRe(s)}\\s*$`, "m").test(md));
  const missingUnits = units.filter((u) => !new RegExp(`^###\\s+${escapeRe(u)}\\s*$`, "m").test(md));
  return { ok: missingSections.length === 0 && missingUnits.length === 0, missingSections, missingUnits };
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
