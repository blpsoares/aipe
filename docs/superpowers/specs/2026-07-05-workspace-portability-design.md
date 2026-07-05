# Workspace portability & publishing — design spec

**Date:** 2026-07-05
**Status:** Design approved + implemented (same session)
**Depends on:** `2026-07-01-aipe-context-brain-design.md` (§3 persistence model),
`2026-07-03-hire-specialists-design.md` (personas installed inside repos).

---

## 1. Purpose

Make an `aipe-<context>/` workspace a **publishable, portable brain**. The PE
can push the workspace to a private remote and continue on another machine
without redoing onboarding. Only the AIPe working files travel; the cloned
repositories and any credentials never do — repos are *referenced* (by URL in
`brain.yaml`) and re-cloned on demand.

## 2. What publishes, what doesn't

Published (the "brain"): `.aipe/` (brain, state, relations, personas registry +
persona sources, journeys, toolbox catalog + skill sources) and `.claude/`
(AIPe skills + SessionStart hook). Never published: the cloned repos (whatever
their path), their nested `.worktrees/`, `.mcp.json` files, secrets.

**Mechanism — allowlist `.gitignore`** written by `aipe start`:
```
/*
!/.aipe/
!/.claude/
!/.gitignore
!/README.md
.aipe/**/.reports/
```
`/*` ignores every top-level entry (all repos + their worktrees); the negations
re-include only the brain. `aipe start` also `git init`s the workspace and
writes a workspace `README.md`. Idempotent: never clobbers a PE-customized
`.gitignore`/README, never re-inits.

## 3. The persona portability problem — store + rehydrate

Personas are installed *inside* each repo (`<repo>/.claude/skills/<slug>/`), and
repos aren't published — so a re-clone on a new machine would lose them. Chosen
resolution (PE, 2026-07-05): **store a committed source of truth + rehydrate**,
not regenerate (which would re-spend LLM tokens and could drift names/prose).

- `/hire-specialists` **dual-writes** each persona: into the repo *and* into
  `.aipe/personas/<repo>/<slug>/SKILL.md` (published).
- `aipe rehydrate` (and `make-workspace` automatically, post-clone) copies
  `.aipe/personas/` back into each present repo — no LLM cost. Repos not yet
  cloned are reported `repo-missing` and restored on the next clone.

The same store+rehydrate pattern covers the **toolbox** (§ its own spec): catalog
skills re-install from `.aipe/skills/`, and `.mcp.json` files regenerate from
`.aipe/toolbox.yaml`.

## 4. Boundary

Deterministic CLI only: `aipe start` (scaffold), `aipe rehydrate` (restore),
the `/hire-specialists` dual-write. No LLM, no network beyond the existing
clone. Fully unit/integration-tested.

## 5. Out of scope / open

- **Secrets in MCP config** — the catalog is published, so MCP `config` must be
  secret-free (env-var references). Enforced by convention + docs today; a
  validator/redactor is a possible follow-up (open question for the PE).
- Auto-committing/pushing the workspace — left to the PE; AIPe only makes it
  publishable, it doesn't push on the PE's behalf.
