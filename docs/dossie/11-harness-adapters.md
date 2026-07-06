# Dossier 11 — Harness adapters (architecture spec)

**Status:** Spec written on `claude/aipe-finalize-i6443p` (frente 4 of 4).
**No implementation** — this frente's deliverable is the design + a decision for
the PE. Nothing under `src/` changed.
**Spec:** `2026-07-06-harness-adapters-design.md`.

## Why spec-only

The PE's instruction was explicit: first propose the abstraction layer (what is
Claude-Code-specific today vs. what a real adapter is), show the design, and ask
whether to implement now or bank it as documented foundation — do **not** build a
whole harness without approval. This entry records that proposal and the open
decision.

## The finding (what's portable vs. Claude-Code-specific)

Audited every source path. The **portable core already exists**: the entire
`aipe` CLI data model + logic (brain, state, relationship graph, personas roster,
journeys, worktrees, dispatch law, toolbox, dashboard, validate-personas), git
worktree isolation, and even the coordinator *awareness content*
(`buildAwareness`) are harness-agnostic.

Exactly **five surfaces are Claude-Code-specific**, and today they are hard-wired
rather than behind an abstraction (spec §2.2):

- **A** install — `.claude/settings.json` SessionStart hook + `.claude/skills/`
  (`start/install.ts`).
- **B** session-context delivery — the Claude Code hook JSON
  (`renderSessionContext`).
- **C** persona/skill file format + location —
  `<repo>/.claude/skills/<slug>/SKILL.md` (hire-specialists, rehydrate, toolbox).
- **D** flow packaging — the `skills/*/SKILL.md` slash-command surface.
- **E** MCP config target — `.mcp.json`.

All five are *delivery to a specific harness's loader*, never *what the
coordinator says* or *what data is computed* — a clean cut line.

## The proposal

A single `HarnessAdapter` interface (install / render-startup-context /
persona-file / flow-files / mcp-config-path), one implementation per harness,
resolved from the existing `HARNESSES` catalog by id. Extracting the current
behavior into a `claude-code` adapter is a **behavior-preserving move** (existing
tests keep passing); each further harness is then additive (~1 file + registry
entry + fixture test). The workspace records its harness so later commands
resolve the same adapter. Full refactor footprint and a concrete second-adapter
sketch (`generic`/AGENTS.md, or Cursor rules) are in spec §4–§5.

## Why "propose, then decide"

An adapter can be *written* headlessly but only *validated* by running AIPe
inside that harness in a live session — the same constraint as persona
load-order (dossier 09). Shipping a second adapter unvalidated would be the very
"claimed it worked without checking" failure to avoid.

## Decision for the PE (open)

- **(a) Implement the seam now** — the behavior-preserving Claude-Code extraction
  + registry + threading through install/hire/rehydrate/toolbox, plus one
  file-based `generic` adapter with fixture tests (its *live* validation left to
  the PE). Moderate, low-risk refactor; ~2 new source files + tests.
- **(b) Keep as documented foundation** — land the spec, ship v1 on Claude Code,
  build the seam when the PE has named and can live-test the first second harness.

**Recommendation:** do the **extraction now** (removes the hard-coding, makes
"any harness" true in code) but **defer the live second adapter** until the PE
picks the target. Absent a decision this session (it became non-interactive), the
default state is **(b): documented foundation** — no code was changed. The PE's
answer flips it to (a).
