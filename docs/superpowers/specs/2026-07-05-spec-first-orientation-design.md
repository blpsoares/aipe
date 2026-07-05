# AIPe Spec-First Operation — design spec

**Date:** 2026-07-05
**Status:** Planned (approved by the PE, 2026-07-05).
**Depends on:** `/operate`, the journey ledger, the toolbox (`skill match`),
the module-granularity model (the coordinator's slices are per **module**).

## 1. Problem

Today `/operate` hands each specialist a one-paragraph `task` inside an
**ephemeral** hiring brief and asks for a PR. There is no durable, approvable
specification and no enforced spec-driven method — "just building" without specs.
The PE wants **two layers of spec**, one per actor.

## 2. Two-layer model

### Layer 1 — the coordinator's **Orientation Spec** (cross-module, durable, PE-gated)
A dedicated, **lightweight** artifact per journey (NOT the full SDD kit — the
coordinator owns *what* + *how modules connect* + *acceptance*, never
implementation detail). Written to `.aipe/journeys/<id>/orientation.md`:

- **Problem / objective** — the "why", from the PE's demand.
- **Cross-module contracts** — pulled from `graph.yaml`: who consumes/imports
  what, and what must change first. Cross-module scope is pinned **here**, before
  any dispatch (the coordinator's exclusive domain under the escalation law).
- **Per-module scope + acceptance criteria** — one section per unit in the batch.
- **Sequencing / waves** — dependency-first.
- **Out of scope.**

**Mandatory PE gate:** nothing is dispatched until the PE approves the orientation
spec. A cross-module need surfaced by an escalation **amends** it (a new version),
which the PE re-approves before the next wave. This is the durable, approved
upstream from which each per-specialist brief slice is derived.

### Layer 2 — the specialist's **SDD** (intra-module, routed, travels in the PR)
Each specialist receives **its slice** of the orientation spec and runs a
spec-driven loop **scoped to its module**: derive a module spec + plan → TDD →
implement → **commit the spec/plan alongside the code** → open the PR. The spec is
reviewable inside the PR itself.

**Routed by `aipe skill match`:** SDD is the default for non-trivial tasks; a
trivial edit (one-liner, copy, styling) **skips** the heavy flow via the toolbox
`routing` signals (`taskTypes`, `minSize`). Reuses what already exists — no
overhead where it isn't warranted.

## 3. Flow (the new `/operate`)

1. PE brings a demand → coordinator opens a journey.
2. Coordinator writes the **orientation spec** (`aipe journey spec` scaffolds it).
3. **PE approves** (hard gate).
4. Coordinator dispatches each specialist with **its slice** of the spec.
5. Specialist runs **SDD in its module** (if `skill match` says so) → spec/plan
   committed → PR.
6. Escalation reveals a cross-module need → **amend the orientation spec (v2)** →
   PE re-approves → next wave.

## 4. What gets built (deterministic + tested)

- **CLI `aipe journey spec`** — scaffolds `.aipe/journeys/<id>/orientation.md`
  from a canonical template; validates required sections and that every unit in
  the batch has a scope section; records the spec path (and version) in the
  journey ledger. Pure/tested (template render + validator).
- **Canonical orientation-spec template** (the sections in §2, Layer 1).
- **Journey ledger** gains `spec` (path + version + `approved` flag set when the
  PE approves).
- **`/operate` rewrite** — the write-spec → **PE gate** → derive-slice →
  dispatch-with-SDD steps, and the amend-on-escalation loop.
- **Hiring brief** — references the module's **slice path** + a "run SDD via
  `aipe skill match`; commit the spec/plan to the branch before implementing"
  instruction.
- **Web console (bonus)** — surface the orientation spec + each specialist's SDD
  stage from the ledger, live.

## 5. Boundary
The durable, tested surface: the orientation-spec template + validator, the
`journey spec` CLI, and the ledger `spec`/approval fields. The PE gate and the
specialist SDD behaviour are coordinator/subagent **prose** in `/operate` and the
persona brief. No LLM in the CLI.

## 6. Out of scope
- Auto-writing the orientation spec's content (the coordinator authors it; the
  CLI scaffolds + validates structure).
- Enforcing SDD inside the subagent mechanically (routed by `skill match`; the
  discipline is prose + the committed artifact, reviewable in the PR).
