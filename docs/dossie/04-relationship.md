# Dossier 04 — `/relationship`

**Status:** Implemented on `feat/relationship`, ready to merge into `main`.
**Spec:** `docs/superpowers/specs/2026-07-02-relationship-design.md`
**Plan:** `docs/superpowers/plans/2026-07-03-relationship.md`

## Purpose

Step 3 of the onboarding pipeline. Once all repos in a context are cloned
(`state.phase.workspace == done`), `/relationship` discovers cross-repo relations
— code imports, API/network contracts, shared infrastructure, shared packages —
by dispatching one read-only subagent per repo at runtime, then merging their
structured reports deterministically into `.aipe/relations/graph.yaml` (machine
source of truth) and `.aipe/relations/README.md` (derived, human-readable). It
also backfills empty `stack` entries in `brain.yaml`, since it already reads
each repo's code in depth — closing the last open item from the foundation spec.

## Key decisions (from brainstorming)

1. **Fan-out = 1 agent per repo, not per relation type.** Every agent reports
   *all* relation types it finds in one schema-forced call, keeping token cost
   at N regardless of how many relation types exist.
2. **Closed enum for `type`:** `imports | published-by | consumes | exposed-by |
   shares-infra`. Required for the merge step to reliably pair complementary
   edges reported from opposite sides of the same real-world relation.
3. **Two-file output, one source of truth.** `graph.yaml` is what agents/personas
   read programmatically; `README.md` is a plain-template rendering of the same
   data (zero extra LLM cost, never a second source of truth).
4. **Deterministic merge by heuristic**, not a second LLM pass: complementary
   edges (`consumes`↔`exposed-by`, `imports`↔`published-by`, `shares-infra`
   symmetric) fold into one `MergedEdge` with both sides' wording preserved as
   `perspectives`.
5. **Fan-out happens live in the coordinator's session** (SKILL.md instructs
   dispatching `Agent()` calls), not via a formal `Workflow()` script — AIPe's
   default. Everything past "N JSON reports on disk" is a deterministic,
   testable CLI, mirroring `/make-workspace`'s skill+CLI split.
6. **Staging via files, not stdin.** Each agent's structured result is saved to
   `.aipe/relations/.reports/<repo>.json` before the CLI runs — inspectable for
   debugging, fixture-testable for the merge logic.
7. **Stack backfill only fills empty values** — never overwrites a stack the PE
   already declared in `brain.yaml`.
8. **Partial failure doesn't abort** (same posture as `/make-workspace`):
   `state.phase.relationship` is `done` only if every repo has a report;
   otherwise `pending`, and `.reports/` is retained (not deleted) so a
   coordinator retry can add just the missing repos without losing successful
   ones. `.reports/` is deleted only when the phase reaches `done`.
9. **Full re-runs always overwrite from scratch** — no incremental merge across
   separate full `/relationship` invocations, since it runs rarely (onboarding
   + deliberate refresh).

## Plan (7 TDD tasks)

1. `types.ts` + `merge.ts` — closed-enum types + deterministic canonicalization/merge of raw edges into `MergedEdge[]`.
2. `render.ts` — pure `graph.yaml` + `README.md` rendering from `MergedEdge[]`.
3. `backfill.ts` + `reports.ts` — pure stack backfill (never overwrites) + disk report reading/validation.
4. `state.ts` — `updateRelationshipPhase`, preserving other phases (mirrors `make-workspace/state.ts`).
5. `run.ts` — orchestration: read brain + reports → merge → render → backfill → state → conditional `.reports/` cleanup.
6. `cli.ts` + manual end-to-end verification (simulated agent JSON, no live agents needed).
7. `skills/relationship/SKILL.md` — the coordinator-facing flow, including the exact `Agent()` schema to force per repo.

Executed via subagent-driven-development: a fresh implementer per task (Haiku
for mechanical transcription tasks 1-4/6-7, Sonnet for the integration-heavy
orchestration task 5), each followed by an independent task review (spec
compliance + code quality) on Sonnet.

## Execution & review findings

All 7 tasks were approved on first review pass — no fix/re-review loops were
needed at the task level. Notable Minor findings accepted as known, non-blocking
issues (logged in the SDD ledger, triaged again at the final review): a
`noUncheckedIndexedAccess` type-assertion in the `shares-infra` sort in
`merge.ts`; narrow coverage of multi-perspective/three-way-merge cases; no
explicit corrupt-YAML test in `state.ts` (matches the accepted sibling
`make-workspace/state.ts` pattern); the plan's own `run.ts` example code has no
disk-error handling around `mkdir`/`writeFile` (caught at the `cli.ts` boundary
instead, confirmed acceptable at final review).

**Final whole-branch review (Opus) — Important, fixed:** `reports.ts`'s
`isValidReport` only checked that `relations` was an array, not that each
element had a valid shape — a report with an out-of-enum `type` (e.g.
`"depends-on"`) or a missing required field would pass validation and reach
`graph.yaml` unfiltered, defeating the closed-enum invariant the whole merge
step depends on. Fixed by deep-validating every `relations[]` element
(`to`/`detail`/`evidence` as non-empty strings, `type` checked against the
five-value `RelationType` enum) in `reports.ts`; a report with any invalid
relation is now rejected entirely, same as any other malformed report (`df41035`
→ `2c5dd25`). Re-review confirmed the fix with two new tests exercising the
real `readReports` path against real temp-directory files, verified independently.

All other issues raised across task and final reviews were Minor and accepted
as-is (see the SDD progress ledger for the full triage).

## Final state

Branch `feat/relationship`, 9 commits (`c0341ab..2c5dd25`) on top of `main`
(merge-base `211a936`). Test suite: **29 relationship tests / 0 fail** (86
total across the repo), `bunx tsc --noEmit` clean. Worktree:
`../aipe-worktree-relationship`.
