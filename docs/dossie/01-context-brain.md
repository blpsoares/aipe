# Dossier 01 — `/context-brain`

**Status:** Merged into `main` (2026-07-01, merge `d89881d`); translated to English (2026-07-02, `20d6191`).
**Spec:** `docs/superpowers/specs/2026-07-01-aipe-context-brain-design.md`
**Plan:** `docs/superpowers/plans/2026-07-01-context-brain.md`

## Purpose

Step 1 of the onboarding pipeline and the factual foundation the whole framework reads
from. Interactively collects a context (a team's repos) from the PE and
**deterministically** writes `<workspace>/.aipe/brain.yaml` + `<workspace>/.aipe/state.yaml`.
It is knowledge only — it does **not** clone or analyze code.

## Key decisions (from brainstorming)

1. **Conversational skill + deterministic typed CLI.** The model never hand-writes YAML —
   that is where format hallucination breaks reliability. The `SKILL.md` gathers data from
   the PE; a Bun/TypeScript CLI validates and serializes. This split became the template
   for every later sub-project (`/make-workspace` mirrors it).
2. **YAML for the brain file.** The PE will open and edit it by hand (add a repo, fix a
   path), so human-editability beats raw JSON.
3. **The PE declares the repos; the skill does not scan.** Input is interactive: context
   name, coordinator name, and a pasteable list of repos (URL + intended path).
4. **Separate *knowing* from *materializing*.** The brain stores URLs + intended relative
   paths only — no cloning. Cloning is `/make-workspace`'s job. This keeps the brain pure,
   portable across machines, and valid at any plugin scope (global or per-project).
5. **Hybrid persistence.** Cross-repo artifacts (brain, relations, personas, state) live in
   `<workspace>/.aipe/`; per-repo persona skills live inside each repo. The plugin is the
   tool; these files are the data it produces.
6. **Workspace naming `aipe-<context.name>`.** Ties the folder to the framework, inherits
   the declared context name, and is short and sortable. The workspace is simply the folder
   where the session is opened with the plugin installed at folder scope.
7. **`state.yaml` for phase tracking.** Records `brain/workspace/relationship/generator`
   so any future session reads where the coordinator left off. Firing each phase stays a
   deliberate PE act (control + cost).
8. **`stack` optional at this stage.** Real stack detection needs the code present, so it is
   declared by the PE if known, otherwise backfilled later (deferred to `/relationship`).

## Plan (6 TDD tasks)

1. `types.ts` — shared type contract (scaffold + strict tsconfig).
2. `validate.ts` — pure `validateContext` (slug, git URL, relative path, duplicates).
3. `write.ts` — `writeBrainFiles` + `initialState` (I/O only, YAML via the `yaml` package).
4. `init.ts` — `initContextBrain` orchestration (validate → write; nothing written on
   invalid input).
5. `cli.ts` — thin adapter: JSON via `--input`/stdin, `--workspace`, `OK`/`ERROR` output +
   exit codes.
6. `skills/context-brain/SKILL.md` + `.claude-plugin/plugin.json`.

## Execution & review findings

Each task: fresh implementer subagent → task review (spec + quality) → fixes. Every task
was approved; Tasks 1–5 landed clean, Task 6 verified end-to-end manually. Models: scaffold
and skill on a standard tier, the transcription-heavy middle tasks on the cheapest tier.

**Final whole-branch review (opus) — Ready to merge, one fix:**

- **Important (fixed):** `cli.ts` called `JSON.parse` with no try/catch and `main()` had no
  `.catch`. A malformed `--input`/stdin payload — or valid-but-non-object JSON like `null`
  (which would also crash `validateContext` before optional chaining helps) — became an
  unhandled rejection with a stack trace instead of the clean `ERROR <field>: <message>` +
  exit 1 contract the SKILL.md depends on for its fix-and-retry loop. Fixed (`cebe8a4`):
  wrapped read+parse, added a non-object guard emitting `ERROR input: ...`, and a `.catch`
  backstop.

The same fix wave (`cebe8a4`) also cleared bundled Minors: tightened path validation to
reject degenerate/traversal paths (`./`, `.//x`, `./../foo`) with regression tests;
guarded `getFlag` against a dangling flag consuming the next flag as its value; and aligned
the SKILL.md copy with the validator (https `.git` is optional). The suite grew 16 → 22.

**Accepted Minor issue** (non-blocking, logged): redundant optional chaining on
required-typed fields in `validate.ts` — intentional defense at the untyped-JSON CLI
boundary, left as-is.

## Final state

Merge `d89881d`, 7 implementation commits (`dbc711d..cebe8a4`). Test suite: **22 pass / 0
fail**, `bunx tsc --noEmit` clean. Later translated to English (`20d6191`) with tests kept
green (full suite **59 pass / 0 fail** at that point).
