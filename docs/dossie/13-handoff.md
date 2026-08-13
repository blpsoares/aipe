# Dossier 13 — `/handoff` (portable context export)

**Status:** Merged into `main`.
**Spec:** `docs/superpowers/specs/2026-08-11-handoff-design.md`
**Plan:** `docs/superpowers/plans/2026-08-11-handoff.md`

## Purpose

A technical PE frequently needs to give a non-technical collaborator (a
UI/UX designer who "vibe codes", a PM, anyone whose own Claude Code should
already understand a multi-repo context) a working environment without that
person ever installing AIPe, running `aipe start`, or answering a technical
question. `aipe handoff` generates a single, portable `CLAUDE.md` file — the
PE builds it once with AIPe (which they already have), and hands it to the
recipient, who drops it into an empty folder, opens Claude Code there, and
the harness already knows: which repos exist, where to clone them, what each
one is for, and how they relate to each other.

This reuses the cross-repo relationship-discovery contract `/relationship`
already established (the five-value `RelationType` enum, the merge logic in
`src/relationship/merge.ts`) but produces a lightweight, standalone artifact
instead of a full publishable workspace — no `.aipe/` state, no
`brain.yaml`, no personas, no dispatch. It sits outside the onboarding
pipeline entirely: a one-shot export, not a fifth onboarding step.

## Key decisions (from brainstorming)

1. **New command, not a `/relationship` flag.** `/relationship` is coupled to
   workspace concepts (`brain.yaml`, `state.yaml` phases, `fqid`) that don't
   apply to a one-shot recipient who never gets a workspace. A separate
   `src/handoff/` module reuses the pure pieces (`mergeEdges`, `buildNodes`,
   `renderGraphYaml` from `src/relationship`) without dragging the workspace
   machinery along.
2. **Single output file, not the `graph.yaml` + `README.md` split.**
   `/relationship`'s two-file split (machine source of truth + human
   rendering) exists because a real AIPe workspace consumes `graph.yaml`
   programmatically elsewhere. A handoff recipient has neither — one
   `CLAUDE.md` embeds the same structured graph as a fenced YAML block inside
   the human-readable markdown, so both the recipient and their harness read
   the identical file.
3. **Two CLI subcommands, mirroring `make-workspace` + `relationship`'s
   skill+CLI split.** `aipe handoff clone` materializes repos (URL or
   already-local path) and writes a manifest; `aipe handoff render` reads the
   manifest plus staged per-repo agent reports and writes the final
   `CLAUDE.md`. The coordinator's `skills/handoff/SKILL.md` dispatches one
   read-only subagent per repo between the two CLI calls — same
   stage-to-disk-then-merge pattern as `/relationship`.
4. **Repo purpose is a new required report field.** `/relationship`'s
   `RepoReport` has no top-level description (only per-package
   `ModuleEntry.description`) because it can read that from `brain.yaml`
   elsewhere. `handoff` has no `brain.yaml`, so its per-repo agent contract
   adds `purpose: string` — a one-sentence summary — alongside the same
   `stack`/`relations` shape.
5. **Partial failure never aborts.** A repo that fails to clone, or never
   gets a valid agent report, still appears in the final `CLAUDE.md` under a
   `## Pending` section with a retry hint — same posture as
   `/make-workspace` and `/relationship`.

## Plan (7 TDD tasks)

1. `types.ts` + `resolve.ts` — `RepoInput`/`HandoffRepoReport`/`ManifestEntry`
   types + URL-vs-local-path resolution for a `--repo` value.
2. `clone.ts` — `materializeHandoffRepo` (reuses `Inspector`/`Cloner` from
   `make-workspace/clone.ts`) + manifest read/write.
3. `reports.ts` — validates staged per-repo agent JSON reports against the
   closed `RelationType` enum plus the new `purpose` field.
4. `render.ts` — pure `renderClaudeMd`: Setup (clone commands) + Repositories
   table + Relations prose + `## Pending` + embedded YAML graph.
5. `run.ts` — orchestration: `runHandoffClone` / `runHandoffRender`, wiring
   `merge.ts`'s `mergeEdges`/`buildNodes` in unchanged.
6. `cli.ts` — `aipe handoff clone|render` subcommands + registration in the
   unified `aipe` binary (`src/cli.ts`).
7. `skills/handoff/SKILL.md` + README — the coordinator-facing orchestration
   flow, plus documenting the command in the repository layout.

Executed via subagent-driven-development: implementer + task reviewer per
task (Haiku for the mechanical transcription tasks, Sonnet for the
integration-heavy orchestration tasks), on `main` directly by explicit PE
consent (no worktree).

## Execution & review findings

All 7 tasks passed task review on the first pass except Task 4, which
carried one accepted Minor (unescaped `|`/newlines in table cells — low
risk, fixed in the final pass anyway) and Task 5, which carried one accepted
Minor (no test for the un-thrown exception path inside
`runHandoffClone`'s per-repo try/catch — coverage gap, not a defect).

**Final whole-branch review (Opus) — 1 Critical, 4 Important, all fixed:**

- **Critical:** `skills/handoff/SKILL.md` was written but never registered
  in `src/harness/skills.ts`'s `FLOW_SKILLS` map — the only mechanism that
  ships a skill into a compiled `aipe` binary. The CLI shipped; the
  orchestration skill that tells a coordinator how to use it did not. Fixed
  by adding the import + map entry.
- **Important:** re-running `render` after a successful (`"done"`) handoff
  read an empty manifest (already cleaned up) and silently overwrote a
  completed `CLAUDE.md` with an empty shell, then exited 1 — inviting a
  destructive retry. Fixed with a `"no-manifest"` phase that bails before
  writing.
- **Important:** `reports.ts` copy-pasted `/relationship`'s
  `isValidRelation`/`isValidModule` instead of reusing them — two sources of
  truth for the closed `RelationType` enum. Fixed by exporting and importing
  them from `src/relationship/reports.ts`.
- **Important:** `skills/handoff/SKILL.md` told the coordinator to read a
  repo's local path "from the OK line," but `renderCloneReport` never
  printed it. Fixed by adding the path to the `OK` line's output.
- **Important:** cloning a URL-only repo into an already-occupied,
  non-git-or-remote-mismatched path was reported as a successful clone
  (inherited from an under-specified plan step, not an implementer slip).
  Fixed by mirroring `make-workspace/clone.ts`'s `remotesMatch` check.

Re-verified independently after the fix pass: `FLOW_SKILLS` registers
`handoff`; full suite and typecheck clean.

## Final state

7 tasks + 1 final-review fix pass, all committed directly to `main` (PE
consent, no worktree). New module `src/handoff/` (types, resolve, clone,
reports, render, run, cli), new `skills/handoff/SKILL.md`, `aipe handoff
clone|render` registered in the unified CLI, README updated. 619 tests green
at merge, `bunx tsc --noEmit` clean.
