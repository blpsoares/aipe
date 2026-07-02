# Dossier 03 — `SessionStart` hook (coordinator context injection)

**Status:** Merged into `main` (2026-07-02, merge `acb4ccc`).
**Spec:** `docs/superpowers/specs/2026-07-02-session-hook-design.md`
**Plan:** `docs/superpowers/plans/2026-07-02-session-hook.md`

## Purpose

The piece that makes AIPe *behave like* a live context rather than a set of executable
skills. A `SessionStart` hook that, when a session opens at the root of an
`aipe-<context>/` workspace (folder-scoped plugin), injects **one** block of
`additionalContext` carrying the coordinator's "awareness" — who they are, the context,
the repos, the onboarding phase, and the next step. It is passive: `SessionStart` only
injects context; it never decides or blocks.

## Key decisions (from brainstorming)

1. **One block, three states, driven by `state.yaml`.** The PE's worry was context
   pollution ("will two contexts be injected?"). Resolved: the hook emits *exactly one*
   `additionalContext` per session, chosen by a `switch` on onboarding state — never two.
   - **State 1** — no `brain.yaml` (bootstrap, first session): "run `/context-brain`".
   - **State 2** — brain present, onboarding incomplete: setup guide + next step (the
     first pending phase mapped to its skill).
   - **State 3** — all phases `done`: the full coordinator identity + operating rules.
   The coordinator's *name* exists from the start (it comes from the brain), but the
   *full operating behavior* only "wakes up" when onboarding completes.
2. **Activation at the workspace root only — enforced by the platform.** A folder-scoped
   plugin's hooks fire *only* where `.claude/settings.json` enables them (the root),
   never in subdirectories. So opening a session inside a repo does not fire this hook —
   the boundary with the future persona sub-project is automatic, with no conflict. The
   hook reads `$CLAUDE_PROJECT_DIR/.aipe/`.
3. **Opt-out is conversational, per session.** The block is always injected and carries
   an instruction to stop following it if the PE explicitly asks to leave AIPe mode. No
   persistent kill-switch file.
4. **Bash orchestrates + emits; Bun parses the YAML.** `brain.yaml` is hand-editable, so
   parsing it robustly (quotes, comments, flow style) is the fragile part — delegated to
   a typed, tested Bun helper. Bun is already a hard dependency of AIPe, so this adds
   nothing new. Matcher `startup|resume|clear|compact` so the awareness survives
   `/clear` and compaction.

A spec inconsistency was caught during planning and reconciled: State 1 triggers on
"no brain" regardless of whether `.aipe/` exists (the hook firing already means it is an
AIPe workspace); the `{}` no-op is reserved for an indeterminable workspace.

## Plan (2 TDD tasks)

1. `src/session-hook/read-state.ts` (typed Bun): robust parse of `brain.yaml` +
   `state.yaml`, graceful degradation, emits shell-friendly `KEY=value` lines.
2. `hooks/session-start` (bash: state switch + JSON emit) + `hooks/hooks.json`
   (registration) + a `bun test` smoke test that spawns the bash and validates the JSON
   per state.

## Execution & review findings

- Both task reviews passed cleanly (read-state degradation never throws; the 8-line
  output contract holds; the bash is defensive under `set -euo pipefail`; JSON escaping
  is safe).
- **Final whole-branch review (opus) — Important, fixed:** `sanitize()` only stripped
  carriage-return / newline / tab, so any other C0 control character (code point below
  `0x20`) in a hand-edited `brain.yaml` value leaked into `additionalContext`, producing
  **invalid JSON** that Claude Code rejects — silently dropping the entire coordinator
  injection. Since the spec commits to graceful degradation for hand-edited brains,
  emitting invalid JSON is a real defect. Fixed by broadening the sanitize regex to
  strip every C0 control character (all code points from U+0000 through U+001F), with
  regression tests at both layers (`c5ec188`).

**Accepted Minor issues** (non-blocking, logged): `REPOS` joined by comma (never
re-split downstream); shebang on an imported module; `CLAUDE_PLUGIN_ROOT` fallback not
unit-tested (verified manually); state 3 doesn't re-check `phaseBrain` (unreachable in
practice).

## Final state

Merge `acb4ccc`, commits `e4549a4..c5ec188`. Test suite: **59 pass / 0 fail**,
`tsc --noEmit` clean. Bash↔Bun `KEY=value` contract verified end-to-end; the hook cannot
make session startup fail (traced across empty-dir, no-brain, malformed-YAML, and
unset-plugin-root paths). Later translated to English (`b597608`, `75674a9`).
