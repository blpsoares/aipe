# Dossier 09 — Persona load-order validation

**Status:** Preflight implemented on `claude/aipe-finalize-i6443p` (frente 2 of 4).
**The live observation is NOT yet done** — it requires a human in a real
interactive session (see "What is still pending" below). This entry does not
claim otherwise.
**Spec:** `2026-07-06-persona-load-order-design.md`.

## The question

Onboarding installs each specialist as a persona `SKILL.md` inside its repo
(`<repo>/.claude/skills/<slug>/SKILL.md`). The open empirical question (hire
spec §8, dossier 05) is: in a **live** Claude Code session opened inside that
repo, does the persona identity **load and survive** when a third-party skill
(e.g. `superpowers:brainstorming`) is invoked on top of it?

That can only be answered by a human observing a real session. So the work was
split: automate every *static precondition* (done, tested), and document the one
remaining *live* step precisely (below).

## What shipped (automatable, TDD)

`aipe validate-personas` — a deterministic preflight (`src/validate-personas/`).
For each non-coordinator persona in `.aipe/personas.yaml` it checks, with no LLM
and no network:

1. the `SKILL.md` exists on disk at the roster's `path`;
2. the frontmatter block is well-formed (`parseFrontmatter`, minimal, no yaml dep);
3. the frontmatter `name` equals `personaSlug(persona.name)` (the harness keys a
   skill by its frontmatter `name` — a mismatch means the roster and the on-disk
   skill disagree and the persona will not be found under its expected id);
4. the `description` is non-empty;
5. the `path` ends with `.claude/skills/<slug>` (a location the harness
   auto-discovers).

Output: `OK/PROBLEM <name> <repo> …` per persona + `STATE personas-ready=R/T`;
exit `0` only when every persona passes. When green (or with
`--print-live-steps`), it appends the manual live-validation protocol verbatim
(`liveValidationSteps()`), so the PE runs exactly the documented steps.

**Verification:** 9 unit tests (check + cli) green; `tsc` clean; `build:host` OK.
Smoke-tested through the compiled binary: a workspace with one good and one
broken persona reports `PROBLEM … name is "WRONG", expected "marina"; …
description is empty` and exits 1; after repair it reports `2/2` and prints the
live steps and exits 0.

## What is still pending (YOU, in a live session)

The preflight removes every "did I set it up right?" failure mode. The one thing
left is the live observation. Run this in a **real interactive Claude Code
session** (the container this was built in cannot):

```bash
# from an onboarded workspace, with personas already ready:
aipe validate-personas            # confirm STATE personas-ready = N/N first
cd <workspace>/<repo>             # a repo that has a persona skill
claude                            # open a real session here
```

Then, interactively:

1. Ask: *"who are you and what repo/module are you specialized in?"* — the
   assistant should answer **as the persona** (its name + repo/module), proving
   the persona `SKILL.md` auto-loaded.
2. Invoke a third-party skill on top, e.g. `/superpowers:brainstorming`, on a
   trivial prompt.
3. **Observe and record**: does the persona identity remain in force during and
   **after** the third-party skill runs, or does the skill override it?

**Expected result:** the persona identity survives; the third-party skill layers
on top of it rather than replacing it.

When you have run it, replace this section with what you actually observed —
`survived` / `overridden` / `partial`, with the concrete assistant behavior seen
(not a guess). Until then, load order is **built and preflighted but not
empirically validated**.
