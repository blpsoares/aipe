# Dossier 11 — Harness adapters (`HarnessAdapter` seam)

**Status:** Spec **and implementation** on `claude/aipe-finalize-i6443p`
(frente 4 of 4). After reviewing the spec the PE approved implementing the seam
now (option a). The `HarnessAdapter` seam, the Claude Code extraction, a second
`generic` adapter, and the threading are shipped and tested; the **live**
validation of the generic adapter inside a real non-Claude harness is left to the
PE (same live-session constraint as load-order).
**Spec:** `2026-07-06-harness-adapters-design.md`.

## How this went (propose → decide → build)

The PE's instruction was to first propose the abstraction (what is
Claude-Code-specific vs. what an adapter is) and ask before building a whole
harness. That proposal is the spec; the PE then approved option (a) — implement
the behavior-preserving extraction now plus one file-based demonstrator adapter,
leaving its live validation to them. This entry records both.

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

## What shipped (option a, TDD)

**New `src/harness/` module:**
- `types.ts` — the `HarnessAdapter` interface (install / startup-delivery /
  persona-target + wrap / mcp-config-path) + plain `PersonaMeta` (so the module
  imports nothing from hire-specialists — no cycle).
- `skills.ts` — the embedded flow-skill texts (moved from `start/install.ts`),
  shared by every adapter.
- `claude-code.ts` — the Claude Code adapter: the `.claude/settings.json`
  SessionStart hook + `.claude/skills/`, personas as `.claude/skills/<slug>/
  SKILL.md` (the frontmatter/description assembly moved here), `.mcp.json`.
  **Behavior-preserving** — every prior test passes unchanged.
- `generic.ts` — a file-based demonstrator: `AGENTS.md` bootstrap + `.aipe/flows/`,
  personas as `.aipe-personas/<slug>.md` (plain markdown, no frontmatter), shared
  `.mcp.json`. Marked EXPERIMENTAL until live-validated.
- `registry.ts` — `getAdapter(id)` (unknown/absent → claude-code) +
  `writeHarness`/`readHarness` (`.aipe/harness`) + `resolveAdapter`.

**Threading (each hard-coded Claude Code path now goes through the adapter):**
- `start/cli.ts` installs via `getAdapter(harness.id).installIntegration` and
  records the harness — so `aipe start --harness generic` now works
  end-to-end. `start/install.ts` became a thin wrapper (kept for its tests).
- `hire-specialists/run.ts` writes the **repo** persona copy via the recorded
  adapter (`personaTarget` + `wrapPersona`); the published `.aipe/personas/`
  source stays canonical SKILL.md for rehydrate. `render.ts`'s `renderSkillMd`
  now delegates to the Claude Code adapter (single source for the format).
- `toolbox/mcp.ts` resolves the MCP config filename from the adapter.
- `HARNESSES`: `generic` flipped to `supported` (it has a real installer);
  `codex`/`gemini`/`copilot`/`antigravity`/`cursor` stay `coming-soon`.

**Verification:** repo-wide 221 pass / 1 known env-only fail; `tsc` clean;
`build:host` OK. End-to-end through the compiled binary: `aipe start --harness
generic --name demo` created `aipe-demo/` with `AGENTS.md`, `.aipe/flows/` (7
flows), and `.aipe/harness = generic`; a generic-recorded workspace writes
personas as `.aipe-personas/<slug>.md` while the published source stays SKILL.md.

## Left to the PE + follow-up

- **Live validation of the `generic` adapter** — running AIPe inside a real
  non-Claude/AGENTS.md harness and watching a session pick it up. Not doable
  headless (dossier 09's constraint); the adapter is marked EXPERIMENTAL until
  then.
- **Remaining adapter surfaces (documented, not yet routed):** `rehydrate` (still
  restores to `.claude/skills`) and toolbox **skill** install location are still
  Claude-Code-shaped; they read from the canonical source and are additive to
  route through `personaTarget` when a non-CC harness is validated.
- Picking the *named* first non-Claude target (Codex/Cursor/…) and giving it a
  format-specific adapter beyond the `generic` demonstrator.
