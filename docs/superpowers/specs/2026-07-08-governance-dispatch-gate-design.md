# Spec — MUST dispatch gate + envelope precedence + QA gate

Journey: j-20260708-n8 / stream governance

## Problem

AIPe's enforcement today is descriptive ("the coordinator doesn't edit the
repo", "dispatch specialists"). Description doesn't hold: under pressure
("it's simple", "it's urgent", "I already know the fix") the coordinator
rationalizes and edits the repo directly, breaking the per-specialist PR
model. There is also no guarantee that the repo's QA runs before anything is
reported as "done".

## Goal (two axes + QA gate)

### A. Non-negotiable dispatch gate (MUST)
Every demand from the PE to the coordinator MUST go through: decompose ->
dispatch specialist in a worktree -> specialist opens a PR. MUST-language +
a **non-exceptions table** with the forbidden rationalizations:
- "it's simple / it's trivial"
- "it's urgent"
- "it's interactive"
- "it's security-sensitive"
- "it's just one file / one line"
- "I already investigated and I know the fix"

The only legitimate way out: the PE **explicitly** asking for inline
execution (explicit human user-instruction > skills; a casual mention does
NOT count).

Actions PERMITTED to the coordinator: **decompose**, **dispatch**,
**investigate in read-only mode**, **escalate**. EDITING a repo is NEVER an
action of the coordinator.

### B. Envelope precedence
AIPe governs **routing** (who does it / how it flows) and **overrides**. The
process-skills (systematic-debugging, TDD, brainstorming) are NOT switched
off — they run **INSIDE the dispatched specialist**, never on the
coordinator. The coordinator doesn't "debug" nor "do TDD" on the repo; it
routes to whoever does.

### D1. QA gate
After every dev delivery (a PR from the dev-fullstack), the **QA of the same
repo** is dispatched as a gate before anything is reported as "done" to the
PE. Only after the QA verdict does the unit count as delivered.

## Where it lands (files in scope)

- `src/session-hook/awareness.ts` — identity injected into the coordinator:
  MUST dispatch gate + non-exceptions table + permitted actions + envelope
  clause.
- `skills/operate/SKILL.md` — same MUST gate + table + envelope + the QA
  gate step in the flow.
- the other `SKILL.md` files (context-brain, make-workspace, relationship,
  hire-specialists, toolbox, aipe-add-repo) — harden behavioral steps that
  are descriptive today into MUST-language + a reference to the gate.
- `src/harness/*` — QA gate support wherever it fits (the QA persona's
  label/description reflects that it is the delivery gate).

## Acceptance (verify for real)

1. The dispatch gate with MUST-language + non-exceptions table appears in
   `awareness.ts` AND in `operate/SKILL.md`.
2. Explicit envelope clause in both.
3. Only an explicit PE opt-out waives dispatch (casual doesn't count).
4. QA gate step documented in `operate/SKILL.md`.
5. awareness/session-start tests updated and green; `bun test` passing.

## Plan

1. Spec (this file) + commit.
2. TDD: extend `awareness.test.ts` and `session-start.test.ts` with
   asserts for the gate/table/envelope/permitted-actions; watch it fail.
3. Implement `awareness.ts` (GATE/envelope constants injected into every
   operating-coordinator state).
4. Rewrite `operate/SKILL.md` (MUST gate + table + envelope + QA gate).
5. Harden the other SKILL.md files.
6. Harness support for the QA gate (QA persona label).
7. `bun test` + build smoke; commit; push; PR.
