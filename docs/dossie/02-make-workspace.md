# Dossier 02 — `/make-workspace`

**Status:** Merged into `main` (2026-07-02, merge `a4bc54f`).
**Spec:** `docs/superpowers/specs/2026-07-01-make-workspace-design.md`
**Plan:** `docs/superpowers/plans/2026-07-01-make-workspace.md`

## Purpose

Step 2 of the onboarding pipeline. Reads `<workspace>/.aipe/brain.yaml` and
**materializes** each repo on the machine via `git clone`, idempotently and
non-destructively, then updates `<workspace>/.aipe/state.yaml`. Clone-only.

## Key decisions (from brainstorming)

1. **Scope = clone only.** Per-journey worktree setup was pulled out of this skill and
   became its own foundational sub-project. `/make-workspace` just materializes repos.
2. **Idempotent: skip + report.** If a path exists and is a git repo with the same
   remote → `skipped`. If it doesn't exist → clone. Never overwrites or deletes.
   Re-running is safe and only completes what's missing.
3. **Binary `state.workspace`.** Becomes `done` only if *all* repos are present
   (`cloned` or `skipped`); any `error` → stays `pending`. Keeps the existing
   `pending | done` enum.
4. **Stack detection deferred** to `/relationship` (which reads the code in depth
   anyway) — keeps this skill single-purpose. Closes an open question from the
   foundation spec.
5. **Skill + typed CLI, sequential clone.** Mirrors `/context-brain`. The CLI reads the
   brain, clones repo by repo (clean, predictable output), and reports per-repo status.

## Plan (6 TDD tasks)

1. `types.ts` + `read.ts` (read/validate brain)
2. `clone.ts` (per-repo decision via injectable `Inspector`/`Cloner` + `remotesMatch`)
3. `state.ts` (update workspace phase, preserving the others)
4. `run.ts` (`makeWorkspace` orchestration + phase aggregation)
5. `git.ts` (real git adapters) + `cli.ts` (`renderReport`) + manual e2e
6. `skills/make-workspace/SKILL.md`

The injectable `Inspector`/`Cloner` boundary lets all logic be tested without network;
real git is isolated in `git.ts`.

## Execution & review findings

Each task: fresh implementer → task review → fixes. Notable outcomes:

- **Task 1 (Critical, fixed):** the plan's own example code failed strict type-checking
  (`tsc --noEmit`) — an invalid cast and `noUncheckedIndexedAccess` violations. Fixed
  (`7f61ac3`). **Process lesson adopted for the rest of the project:** `bun test` does
  NOT type-check, so `bunx tsc --noEmit` must run before every commit.
- **Task 5 (Important, fixed):** `realInspect` used `git rev-parse
  --is-inside-work-tree`, which returns true when the path is inside *any* ancestor git
  tree — so an existing empty dir nested under a git-tracked workspace would block a
  legitimate clone with "path occupied". Fixed by comparing `--show-toplevel` against
  the realpath-normalized path, with a regression test using local `git init`
  (`2859609`).
- **Final whole-branch review (opus) — Important, fixed:** `git clone` ran without a
  `--` separator or transport guard (argument-injection via leading-dash URL; `ext::`
  arbitrary-command transport). Hardened to `git -c protocol.ext.allow=never clone --
  <url> <path>` (`3ec664e`). The same fix wave added per-repo resilience (an
  inspection failure on one repo no longer aborts the batch — spec §5) and a test
  locking the `skipped → done` invariant (spec §4).

**Accepted Minor issues** (non-blocking, logged): generic file-read catch reporting all
errors as "not found"; `canonicalizeRemote` edge cases (ssh port, path lowercasing);
untyped state parse; a repo with no `origin` remote reported as error.

## Final state

Merge `a4bc54f`, 8 implementation commits (`f9baf01..3ec664e`). Test suite: **45
pass / 0 fail**, `tsc --noEmit` clean. Later translated to English (`24cab0d`,
`75674a9`).
