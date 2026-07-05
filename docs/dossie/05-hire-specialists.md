# Dossier 05 — `/hire-specialists`

**Status:** Implemented on `claude/project-understanding-review-66rt1w`.
**Spec:** `docs/superpowers/specs/2026-07-03-hire-specialists-design.md`
**Plan:** `docs/superpowers/plans/2026-07-03-hire-specialists.md`

> Renamed from `/context-brain-generator` at the PE's request: the old name
> echoed the unrelated `/context-brain` sub-project and didn't describe what
> the step does. `/hire-specialists` matches the company analogy (it "hires"
> each repo's specialists) and the step's output. The `state.yaml` phase was
> renamed in lockstep, `generator` → `specialists`.

## Purpose

Step 4 (last) of the onboarding pipeline. Once relations are discovered and
`stack` is backfilled (`state.phase.relationship == done`), `/hire-specialists`
materializes the **specialists** of the company analogy: for every repo,
exactly **2 personas** — a **dev-fullstack** and a **QA** — each installed as a
two-mode skill inside that repo (`<repo>/.claude/skills/<name>/SKILL.md`), plus
a cross-repo registry (`.aipe/personas.yaml`) listing the coordinator + every
persona.

## Key decisions (from the design spec)

1. **Always 1 dev-fullstack + 1 QA per repo** — never more, never fewer,
   regardless of how polyglot the repo's `stack` is. No sub-repo splitting
   (`/relationship` produces no sub-repo scoping to split on).
2. **`role` is a closed enum** (`coordinator | dev-fullstack | qa`); the
   coordinator gets a `personas.yaml` entry too, so the registry is a full
   roster.
3. **Interactive naming, CLI-backed.** The PE names personas per repo (or asks
   the coordinator to); a dedicated `--resolve-names` CLI mode fills gaps from
   a built-in pool and guarantees uniqueness across the whole context
   (case-insensitive, including the coordinator) **before** dispatch — an agent
   must know its final name to write coherent identity prose.
4. **Fan-out = 2N agents (one per repo × role), one parallel batch.** Dev and
   QA for a repo are siblings, not dependents.
5. **Deterministic materialization past "2N JSON reports on disk"**: read +
   deep-validate reports, assemble frontmatter (`name` slugified;
   `description` from a fixed template), write each `SKILL.md`, full-rewrite
   `personas.yaml`, update `state.phase.specialists`. Defensive dedupe by name
   (first wins; anything colliding with the coordinator dropped).
6. **Partial failure doesn't abort** (same posture as `/relationship`):
   `specialists` is `done` only if every `(repo, role)` pair has a valid
   report; otherwise `pending`, and the staging dir
   `.aipe/specialists/.reports/` is retained for a targeted retry. Deleted only
   on `done`.
7. **The hiring brief is never a persisted artifact** — each persona's
   `SKILL.md` documents in prose how to interpret one; its concrete shape is
   decided by the coordinator at dispatch time in future work sessions.
8. **Two-mode persona content:** one shared identity paragraph grounded in the
   repo's `stack` + `graph.yaml` relations, then a subagent section (scoped
   task, stay in-repo, report through the coordinator) and an interactive
   section (pair directly with the PE as this repo's dev/QA).

## Plan (8 code modules + skill)

`types → naming → render → reports → registry → state → run → cli`, then
`skills/hire-specialists/SKILL.md`. Same skill+CLI split as `/relationship`,
with the extra `--resolve-names` mode before dispatch.

## Execution & review findings

Implemented directly on the session branch (not a separate worktree, contrary
to the plan's per-task `~/aipe-worktree-*` commands — those are historical).
All modules transcribed from the plan with the rename adaptations
(`generator`→`specialists`, staging under `.aipe/specialists/.reports/`,
`runHireSpecialists`/`updateSpecialistsPhase`). Wired as the `aipe
hire-specialists` subcommand of the unified CLI (see dossier 06) rather than a
standalone `bun …/cli.ts` entry point.

**Verification:** 29 hire-specialists tests pass (0 fail); `bunx tsc --noEmit`
clean. End-to-end smoke test through *both* `bun src/cli.ts hire-specialists`
and the *compiled* `bin/aipe` binary: `--resolve-names` emits 2N uniquely-named
personas + the coordinator; materialize writes each `SKILL.md`, the 5-entry
`personas.yaml`, flips `state.phase.specialists=done`, and removes the staging
dir. The partial-failure path (one report present) keeps the dir and reports
`pending`.

## Load-order validation — DEFERRED

Design spec §8 calls for an empirical check: generate one persona, open a real
interactive session inside its repo, invoke a third-party skill (e.g.
`superpowers:brainstorming`) on top, and observe whether the persona identity
survives. This needs a **live interactive session**, which the autonomous
implementation run could not perform. It is **not yet done** — tracked in
`OPEN-DECISIONS.md`. The generated two-mode `SKILL.md` format is in place and
unit-tested; only the human-in-the-loop observation is outstanding.

## Final state

Branch `claude/project-understanding-review-66rt1w`. Relevant commits:
`aff3fe9` (phase rename) and `bed3c17` (hire-specialists module). Repo-wide:
**116 pass / 1 fail**, the single failure being an environment-only
`make-workspace/git.test.ts` case (this container's global
`url.https://github.com/.insteadOf git@github.com:` rewrite changes the remote
URL the test reads back — passes on a clean runner). `bunx tsc --noEmit` clean.
