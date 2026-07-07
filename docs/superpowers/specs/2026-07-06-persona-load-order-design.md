# Persona load-order validation — design spec

**Date:** 2026-07-06
**Status:** Design approved — ready for implementation
**Depends on:** `2026-07-03-hire-specialists-design.md` (§8 load order)

---

## 1. The problem, and what can vs cannot be automated

Onboarding installs each specialist as a persona `SKILL.md` inside its repo
(`<repo>/.claude/skills/<slug>/SKILL.md`). The open question (spec §8, dossier 05)
is **empirical**: when the PE opens a live Claude Code session inside that repo
and invokes a *third-party* skill on top (e.g. `superpowers:brainstorming`), does
the persona identity **survive** — does the harness load the persona and keep it
framing the assistant while the third-party skill runs?

That question can only be answered by a **live interactive session**. A headless
/ autonomous run cannot observe it. So this sub-project splits the work:

- **Automatable (this sub-project ships it):** a deterministic *preflight* that
  checks every static precondition which, if wrong, would guarantee the persona
  can't load — regardless of the live behavior. This removes all "did I set it up
  right?" ambiguity, so the remaining live step observes exactly one thing.
- **Not automatable (documented, not claimed done):** the live observation. The
  dossier records the exact command and expected result the PE runs, and states
  plainly that it is **not yet validated**.

## 2. `aipe validate-personas`

A new subcommand. Pure checks over a workspace — no LLM, no network, fully
unit-testable. For each non-coordinator persona in `.aipe/personas.yaml`:

1. **File present** — `<workspace>/<path>/SKILL.md` exists (`path` from the
   roster entry).
2. **Frontmatter well-formed** — the file opens with a `---` block that closes,
   and yields a `name` and a `description`.
3. **Name matches slug** — the frontmatter `name` equals `personaSlug(persona.name)`
   (Claude Code keys a skill by its frontmatter `name`; a mismatch means the
   coordinator's `personas.yaml` and the on-disk skill disagree).
4. **Description non-empty** — the harness shows/relies on it for skill
   selection.
5. **Path shape** — `path` ends with `.claude/skills/<slug>` under the persona's
   repo, i.e. a location the harness auto-discovers.

Output (same `OK/PROBLEM ... STATE` style as the other CLIs):

```
OK    Joaquim  embark          .claude/skills/joaquim/SKILL.md
PROBLEM Marina  embark  frontmatter `name` is "marina-qa", expected "marina"
STATE personas-ready=4/5 (1 problem)
```

Exit `0` when every persona passes, `1` otherwise. The coordinator is skipped
(it has no repo skill; it's injected by the SessionStart hook).

A `--print-live-steps` flag (default on when everything passes) appends the
**manual live-validation protocol** — the exact steps, command, and expected
result the PE must run in a real session. This is documentation the tool emits,
not a claim that it ran.

## 3. Module shape (mirrors the other CLIs)

- `src/validate-personas/check.ts` — pure `checkPersonaReadiness(workspaceDir)`
  → `{ results: PersonaCheck[]; ready: number; total: number }`, plus a pure
  `parseFrontmatter(text)` helper.
- `src/validate-personas/steps.ts` — the pure `liveValidationSteps()` string
  (the manual protocol), so it's asserted by a test and reused by the dossier.
- `src/validate-personas/cli.ts` — flag parsing + `renderReport` (pure) + wiring.
- Wired into `src/cli.ts` as `validate-personas`.

## 4. Out of scope

- Running the live session (impossible headless).
- Editing/repairing a broken persona (report only; the PE re-runs
  `/hire-specialists` or `aipe rehydrate`).
