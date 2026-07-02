# Dossier 01 — `/context-brain`

**Status:** Merged into `main` (2026-07-01).
**Spec:** `docs/superpowers/specs/2026-07-01-aipe-context-brain-design.md`
**Plan:** `docs/superpowers/plans/2026-07-01-context-brain.md`

> Note: this entry is reconstructed from the design doc and git history — the
> `/context-brain` work predates the dossier convention. Entries 02 and 03 were
> recorded live.

## Purpose

Step 1 of the onboarding pipeline. Produces the **brain file**: the factual map of a
context (repos, URLs, paths, stacks), written to `<workspace>/.aipe/brain.yaml`, and
initializes `<workspace>/.aipe/state.yaml`. It is knowledge only — it does not clone or
analyze code. It is the source of truth the later pipeline stages read.

## Key decisions

- **Interactive, PE-declared input.** The skill runs conversationally: the PE declares
  the context name, the coordinator name, and the repos (URL + intended path). The PE
  can paste a list.
- **YAML format** for the brain — because the PE will want to open and hand-edit it
  (add a repo, fix a path). `stack` is optional at this stage (real stack detection
  needs the code present).
- **Skill + typed CLI split.** The skill collects data conversationally; the
  deterministic work (validate + serialize) lives in a typed, tested CLI
  (`src/context-brain/cli.ts`). The coordinator never hand-writes the YAML.
- **Workspace naming convention:** `aipe-<context.name>`.

## Implementation (`src/context-brain/`)

`types.ts` (BrainFile, StateFile, ContextInput, validation types) · `validate.ts`
(input validation: URL shape, path collisions) · `write.ts` (serializes brain.yaml +
state.yaml) · `init.ts` (orchestration) · `cli.ts` (flag parsing + result reporting) ·
`SKILL.md`.

Built with subagent-driven development (one implementer per task, adversarial review,
fixes), TDD throughout.

## Review findings

- Task 2 (Minor): redundant optional-chaining on required fields in `validate.ts`;
  degenerate `./` path had no test.
- Task 5 (Low): `cli.ts` `JSON.parse` without try/catch (unhandled rejection on
  malformed input); `getFlag` with no value falls through to stdin.
- **Final review (Important):** `cli.ts` `JSON.parse` without try/catch broke the
  `ERROR` output contract on malformed input → **fixed** (commit `cebe8a4`, "CLI
  robustness and path validation for context-brain").

## Final state

Merged; suite green (16 tests at the time). Commits `4349854..f483512` plus the
robustness fix `cebe8a4`.

> The original artifacts were authored in Portuguese; they are being converted to
> English by a separate session, per the English-only standard.
