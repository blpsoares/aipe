# Repo-local session context (persona + PE identity) — design

**Status:** Approved, ready for planning.
**Origin:** brainstorming session, 2026-08-11.

## Purpose

Today AIPe's `SessionStart` awareness (`src/session-hook/awareness.ts`) only
fires when a Claude Code session opens at the **workspace root** (the
`aipe-<context>/` folder). Opening a session **directly inside a specialist's
repo** (e.g. `aipe-<context>/<repo>/`) — which a PE will naturally do once
onboarding is complete and they just want to work in one repo — injects
nothing: no persona identity, no PE name, no workspace/context awareness.
The repo does receive `.claude/skills/<slug>/SKILL.md` and
`.claude/agents/<slug>.md` from `hire-specialists`, but neither is forced —
Claude only picks them up if it independently judges the skill's description
relevant.

This closes that gap: opening a session inside a specialist's repo
automatically identifies the persona, the PE, and the workspace context —
the same kind of automatic awareness the workspace root already gets, scoped
correctly for a specialist rather than a coordinator.

## Non-goals

- Not changing what happens at the workspace root — coordinator awareness
  (the Dispatch Gate, onboarding pointer) is unchanged.
- Not installing anything into a dispatch worktree specifically — the
  upward-search mechanism (see below) covers worktrees as a side effect
  (they're nested under the repo), but no worktree-specific code is added.
- Not building a PE-facing UI for setting their name later — it's captured
  once, during `/context-brain`, like the coordinator name already is.

## Design

### 1. Capture the PE's name

Add `pe?: string` to `ContextMeta` (`src/context-brain/types.ts`). The
`/context-brain` skill asks for it alongside the coordinator name (one
additional question in an existing flow, not a new one). Optional — a
missing `pe` degrades gracefully (personas just don't personalize a greeting
by name).

### 2. Upward search for `.aipe/`

`src/session-hook/read-state.ts`'s `readState` currently does
`join(workspaceDir, ".aipe")` with no upward search — if `CLAUDE_PROJECT_DIR`
(or the hook's `--workspace` flag) resolves to a repo subdirectory, it finds
nothing and `buildAwareness` falls back to the stale "onboarding not started"
message.

Fix: `readState` walks up from the given directory (capped at a fixed depth,
e.g. 8 levels, to bound the search) looking for `.aipe/brain.yaml`, and
returns the **resolved workspace root** alongside the parsed fields so the
caller knows both where `.aipe/` actually lives and what the original CWD
was relative to it. This single change transparently fixes both "opened in
the repo" and "opened in a dispatch worktree nested under the repo" — no
separate worktree-specific mechanism needed.

### 3. Coordinator mode vs. specialist mode

Once the real workspace root is known, compare the original CWD against
`brain.repos[].path` (resolved against the workspace root):

- **CWD == workspace root** → today's behavior, unchanged: coordinator
  awareness (onboarding pointer, or the Dispatch Gate once `done`).
- **CWD is at or under a declared repo's path** → **specialist mode**: a
  new `buildPersonaAwareness` function in `awareness.ts` builds a distinct
  message:
  - Identifies the persona owning that repo (read `.aipe/personas.yaml` —
    matched by repo name; if a repo has multiple packages/personas, match
    the most specific path prefix).
  - States the persona's name and role, the repo name, the context name,
    and the PE's name if `f.pe` is set ("You work for `<pe>` in the
    `<context>` context").
  - Surfaces this repo's relations from `.aipe/relations/graph.yaml` (edges
    touching this repo/package's fqid) so the specialist doesn't have to go
    looking for them.
  - Does **NOT** include the Dispatch Gate MUST-language — that identity
    belongs to the coordinator only, never a specialist working directly in
    its own repo.
  - CWD outside every declared repo path but still under the workspace root
    (a stray subdirectory) → falls back to coordinator-mode text, since
    there's no persona to attribute it to.

### 4. Install the hook into each repo

`hire-specialists`'s `writePersonaFiles` (`src/hire-specialists/run.ts`)
additionally writes `<repo>/.claude/settings.json` with the same
`SessionStart` hook shape already used at the workspace root
(`src/harness/claude-code.ts`'s `installIntegration` — generalized to accept
a target directory rather than hardcoding the workspace root, reused for
both call sites). `src/rehydrate/personas.ts` keeps this file in sync on
re-clone, the same way it already restores the persona skill/agent files.

## Testing

- `read-state.ts`'s upward search: pure, testable with a temp directory tree
  (`workspace/.aipe/brain.yaml` + `workspace/repo-a/`, `readState` called
  with CWD `workspace/repo-a` resolves to the same fields as calling it with
  CWD `workspace`, plus the resolved root and relative path).
- `buildPersonaAwareness`: pure, tested with fixture `Fields` +
  `personas.yaml`/`graph.yaml` content → exact expected string, mirroring
  the existing `awareness.test.ts` pattern.
- `installIntegration` generalization: existing workspace-root tests must
  keep passing unchanged; add one new test asserting a repo-scoped install
  writes the equivalent `.claude/settings.json` at a repo path.
- `hire-specialists`/`rehydrate` integration: extend existing tests to
  assert the new `.claude/settings.json` file is written per persona repo,
  alongside the already-tested skill/agent files.

## Open questions for planning

- Multi-package repos (a persona per package, not per repo): matching CWD
  to "the most specific path prefix" needs the exact tie-breaking rule
  worked out against `personas.yaml`'s actual shape during planning.
- Depth cap for the upward search (proposed: 8) — confirm against realistic
  worktree nesting depth (`<repo>/.worktrees/<journey>-<slug>/`) so it's
  never too shallow.
