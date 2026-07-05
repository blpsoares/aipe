# Dossier 10 — Spec-first operation (Orientation Spec + specialist SDD)

**Status:** Built on `claude/aipe-web-console-aownq8`.
**Spec:** `2026-07-05-spec-first-orientation-design.md`.

Turns "just build it" into a two-layer, spec-driven flow — the PE's directive
that specialists should not work without specs.

## Decisions (PE, 2026-07-05)
- **Coordinator's spec:** a **dedicated lightweight** template (cross-module
  requirements + contracts + acceptance), not the full SDD kit.
- **PE gate:** **mandatory** — nothing dispatches until the PE approves the
  Orientation Spec.
- **Specialist SDD:** the default for non-trivial tasks, **routed by `aipe skill
  match`** so trivial edits skip the heavy flow.

## Two layers
1. **Orientation Spec (coordinator, durable, PE-gated).** Per journey,
   `.aipe/journeys/<id>/orientation.md`: Problem · Cross-module contracts (from
   `graph.yaml`) · Per-module scope + acceptance · Sequencing · Out of scope.
   Cross-module scope is pinned here before any dispatch (the coordinator's
   domain under the escalation law). An escalation amends it (new version) → PE
   re-approves → next wave.
2. **Specialist SDD (intra-module, in the PR).** Each specialist gets its slice
   and runs SDD scoped to its module — module spec + plan committed alongside the
   code (reviewable in the PR), routed by `skill match`.

## What shipped (TDD)
- **`src/journey/spec.ts`** — canonical template (`renderOrientationTemplate`)
  and structure validator (`validateOrientation`: every section + a `### <unit>`
  per batch unit). Pure.
- **Journey ledger** gains `spec: {path, version, approved}` (`setJourneySpec`,
  preserved across dispatch writes).
- **`aipe journey spec`** — `--units` scaffold (never clobbers an edited file),
  `--check` validate, `--approve` (the gate), `--amend` (bump version), `--show`.
- **`/operate` rewrite** — step 3.5 writes the Orientation Spec and **waits for
  PE approval** (`approved=true`) before dispatching; the hiring brief carries the
  unit's slice, `module` + `modulePath` confinement, and a `workingMethod` that
  runs `skill match` and commits the SDD spec/plan into the PR.

## Verification
`journey spec` driven end-to-end (scaffold → check → approve → show); pure
template/validator + ledger round-trip unit-tested; full suite green; compiled
binary verified.

## Boundary
The CLI is deterministic (template + validator + ledger fields + the gate flag).
Authoring the spec's *content* and running the specialist SDD are coordinator/
subagent prose — the discipline is the durable artifact + the committed plan in
the PR, not mechanical enforcement inside the subagent.
