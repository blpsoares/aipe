# AIPe — Context-injection hook (`SessionStart`)

**Date:** 2026-07-02
**Status:** Design approved
**Sub-project:** foundational piece of AIPe (see
`2026-07-01-aipe-context-brain-design.md`)

---

## 1. Purpose & mechanism

What makes AIPe **be** a living context — not just a set of executable skills.
A `SessionStart` hook of the AIPe plugin that, when a session opens at the root of
an `aipe-<context>/` workspace, injects **a single block** of context
(`additionalContext`) with the coordinator's "awareness": who they are, what the
context is, the repos, the onboarding phase, and the next step. The coordinator
"wakes up" already knowing everything, without the PE needing to explain anything.

It is **passive**: `SessionStart` only injects context, it doesn't make decisions
or block anything. Triggering each pipeline phase remains a deliberate act by the
PE via skills.

---

## 2. Activation (guaranteed by the platform)

The AIPe plugin is installed at **folder scope** — `.claude/settings.json` at the
workspace root, with `enabledPlugins.aipe: true`. Consequence (documented by Claude
Code): hooks of a plugin at project scope **only fire when the session opens in the
exact folder** that contains the `.claude/settings.json`. They don't propagate up
to parent directories nor down into subfolders.

Therefore:
- **Detection = workspace root, guaranteed by the platform.** The hook doesn't need
  to "walk up the tree": it reads directly from `$CLAUDE_PROJECT_DIR/.aipe/` (the
  `$CLAUDE_PROJECT_DIR` is the launch folder = workspace root).
- **The boundary with personas is natural:** opening a session inside a repo
  (`aipe-opvibes/embark/`) **does not trigger** this hook — the plugin isn't active
  there. Persona injection inside a repo is the responsibility of the personas
  sub-project, installed at that repo's scope. Zero conflict.

**Matcher:** `startup|resume|clear|compact`. It reappears after `/clear` and after
automatic compaction — otherwise the coordinator's "awareness" would disappear in
the middle of a long journey.

**Input available to the hook:** environment variables `$CLAUDE_PROJECT_DIR`
(workspace root) and `$CLAUDE_PLUGIN_ROOT` (plugin root); JSON on stdin with `cwd`,
`hook_event_name`, `session_id`, etc. The reading base is `$CLAUDE_PROJECT_DIR`.

**Output:** JSON on stdout in Claude Code's format:
```json
{ "hookSpecificOutput": { "hookEventName": "SessionStart", "additionalContext": "<text>" } }
```
Exiting with code 0 and empty stdout (or `{}`) injects nothing, cleanly.

---

## 3. The single block, in 3 states

The hook emits **exactly one** `additionalContext` per session. A `switch` over the
onboarding state chooses **which** block — never two, never accumulated.

**State 1 — no `brain.yaml`** (bootstrap: plugin active, context not yet started)
> AIPe workspace detected, but no `brain.yaml` yet. Run `/context-brain` to
> map the context and get started.

**State 2 — brain exists, some phase `pending`** (onboarding in progress)
> Context *\<name\>* being configured. Coordinator: *\<coordinator\>* (in formation).
> Status: brain ✅ · workspace ⏳ · relationship ⏳ · generator ⏳.
> **Next step: `/<first-pending-phase>`.** Guide the PE to complete onboarding;
> do not yet operate as a full coordinator.

The "next step" is derived from the **first** `pending` phase in pipeline order
(workspace → relationship → generator), mapped to its skill.

**State 3 — all phases `done`** (full coordinator)
> You ARE *\<coordinator\>*, coordinator of the *\<name\>* context. Repos: \<list\>.
> Operate like this: decompose the PE's demands, hire specialists (cap of 16, the
> same-repo law serializes, distinct repos run in parallel), escalate cross-repo
> issues to the PE, each specialist opens the final PR. Ready to receive demands.

**Common to all states** — the opt-out line:
> AIPe mode active by default. If the PE explicitly asks to leave AIPe mode, stop
> following these instructions for this session.

**Note on state 1 (bootstrap):** the hook firing already means the folder is an
AIPe workspace (the plugin at folder scope only fires where it was enabled). So the
**absence of `brain.yaml` — with or without the `.aipe/` folder** — is state 1: the
first session, before `/context-brain`. The hook injects state 1 in that case; it
doesn't stay silent. The no-op `{}` is reserved only for the defensive case where
the workspace is indeterminable (`$CLAUDE_PROJECT_DIR` empty).

---

## 4. Components & boundaries

Split: **bash orchestrates and emits** (style preference, like superpowers); **Bun
parses** the YAML (a fragile point since `brain.yaml` is hand-editable) — Bun is
already a mandatory dependency of AIPe, so there's no new dependency.

```
hooks/
  ├── hooks.json          ← registers SessionStart (matcher startup|resume|clear|compact)
  └── session-start       ← bash: entrypoint
src/session-hook/
  ├── read-state.ts       ← typed Bun: reads+parses brain.yaml+state.yaml, prints clean fields
  └── __tests__/
```

- **`hooks/hooks.json`** — points `SessionStart` to `session-start` via
  `$CLAUDE_PLUGIN_ROOT`.
- **`hooks/session-start`** (bash) — the entrypoint. Steps:
  1. Determines the workspace: `$CLAUDE_PROJECT_DIR` (fallback `$PWD`). If
     indeterminable (empty) → emits `{}` and exits 0 (defense).
  2. Calls `bun $CLAUDE_PLUGIN_ROOT/src/session-hook/read-state.ts --workspace
     $CLAUDE_PROJECT_DIR`, which returns shell-friendly fields (see below). If bun
     fails, the fields come back empty → treated as state 1.
  3. Decides the state (1/2/3) from the fields: `BRAIN=absent` → state 1; present
     with some phase ≠ `done` → state 2; all `done` → state 3.
  4. Builds the block's text and emits it as `hookSpecificOutput.additionalContext`,
     with JSON escaping (same technique as superpowers' `session-start`:
     slash/quote/newline substitutions via parameter expansion).
- **`src/session-hook/read-state.ts`** (Bun, typed, tested) — reads
  `<workspace>/.aipe/brain.yaml` and `state.yaml` with the `yaml` package; reuses
  `BrainFile`/`StateFile` from `src/context-brain/types.ts`. Prints a stable format
  that's easy to consume in bash. **Degrades gracefully:** if `brain.yaml` is
  missing → signals state 1; if `state.yaml` is missing/malformed → assumes
  `pending` phases; never throws in a way that breaks the hook (errors become a
  marker that bash treats as "no brain"/degraded).

### `read-state.ts` output contract
Shell-friendly format, one key per line (easy to read with `while read` / `grep`):
```
BRAIN=present            # or absent
CONTEXT_NAME=opvibes
COORDINATOR=Nicolas
PHASE_BRAIN=done
PHASE_WORKSPACE=pending
PHASE_RELATIONSHIP=pending
PHASE_GENERATOR=pending
REPOS=embark,prontuario  # names, comma-separated; empty if none
```
If `BRAIN=absent`, the other fields may come back empty — bash decides state 1
based only on that marker. Values are sanitized (no newlines) so they don't
corrupt bash parsing.

---

## 5. Errors & robustness

- **`$CLAUDE_PROJECT_DIR` empty/indeterminable:** empty output (`{}`), defense.
- **`brain.yaml` missing (with or without `.aipe/`):** state 1 ("run
  `/context-brain`") — this is the normal bootstrap of the first session.
- **`brain.yaml` hand-edited with quotes/comments/flow style:** parsing via the
  `yaml` package (in Bun) absorbs it — that's precisely why parsing isn't done in
  bash.
- **`brain.yaml`/`state.yaml` malformed to the point of not parsing:**
  `read-state.ts` catches it and returns a degraded state (treated as "no brain" or
  `pending` phases) instead of crashing the hook. The hook must **never** make
  session startup fail.
- **`state.yaml` missing but brain present:** assumes all non-`brain` phases are
  `pending` → state 2, next step `/make-workspace`.

---

## 6. Tests (`bun test` + bash smoke test)

**`read-state.ts` (unit, robust):**
- brain+state complete (all done) → `BRAIN=present`, correct fields and `REPOS`.
- brain missing → `BRAIN=absent`.
- partial state (workspace pending) → flags reflect it; next step derivable.
- state missing with brain present → non-brain phases become `pending`.
- brain with quotes/comment/flow style → still extracts name/coordinator/repos.
- malformed brain (invalid YAML) → degrades without throwing; signals a
  handleable state.
- sanitization: values with odd characters don't emit newlines.

**`session-start` (bash, smoke):** given an `.aipe/` fixture, the emitted JSON
contains the right markers for each state (1/2/3) and, in the "no `.aipe/`" case,
the output is empty. The emitted JSON is valid (parseable).

---

## 7. Roadmap impact (foundation doc)

- Context-injection hook (`SessionStart`) — **this spec**; foundational piece.
- Injection of **persona within a repo** remains with the personas sub-project
  (`/context-brain-generator`) — this hook never fires inside a repo, so there's no
  overlap.
- Suggested order of subsequent cycles remains: **worktree-per-journey** →
  `/relationship` → `/context-brain-generator` → `/aipe-add-repo`.

---

## 8. Decisions closed this session

- **A single block**, chosen by `switch` on the onboarding state — never two, no
  context accumulation.
- **Activation only at the workspace root**, enforced by the platform (plugin at
  folder scope); the boundary with personas is automatic.
- **Opt-out is conversational only** (per session): the block is always injected
  and carries the instruction to stop if the PE asks; no persistent kill-switch
  file.
- **Bash orchestrates + emits; Bun parses the YAML** (robustness for a
  hand-editable brain, without a new dependency).
- **Matcher `startup|resume|clear|compact`** to survive `/clear` and compaction.
