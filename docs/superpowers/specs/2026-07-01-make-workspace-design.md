# AIPe — `/make-workspace`

**Date:** 2026-07-01
**Status:** Design approved
**Sub-project:** step 2 of the onboarding pipeline (see
`2026-07-01-aipe-context-brain-design.md`)

---

## 1. Purpose & scope

`/make-workspace` is **step 2** of the onboarding pipeline: it turns the factual
map (the `brain.yaml`) into **code present on the machine**. It reads
`<workspace>/.aipe/brain.yaml`, materializes each repository at the declared `path`
(via `git clone`), and updates `<workspace>/.aipe/state.yaml`.

### Does
- Reads and validates `<workspace>/.aipe/brain.yaml`.
- Clones each repo declared, at its `path` relative to the workspace.
- Updates the `workspace` phase in `state.yaml`.
- Reports to the PE, per repo, what was cloned / skipped / failed.

### Does NOT do (explicit boundaries)
- **Does not** create a worktree per journey → that's its **own foundational
  sub-project** (removed from this skill's scope).
- **Does not** detect stack → that's the responsibility of `/relationship`, which
  reads the code in depth (closes the open question §8 of the foundation spec: who
  fills in `stack` is `/relationship`).
- **Does not** edit `brain.yaml` → only reads it. The brain is `/context-brain`'s
  source of truth.
- **Does not** inject session context → that's the `SessionStart` hook, the next
  foundational sub-project (see §7).

---

## 2. Flow (skill orchestrates, CLI executes)

Same pattern as `/context-brain`: the **skill** is conversational and orchestrates;
the deterministic work (read/validate/clone/serialize) lives in a **typed, testable
CLI**.

1. The skill confirms the **workspace** (by default, the current directory; must be
   an `aipe-<context>` folder).
2. The skill checks `state.phase.brain == done`. If the brain doesn't exist yet or
   isn't `done`, it guides the PE to run `/context-brain` first — it makes no sense
   to clone without a map.
3. The skill runs:
   ```bash
   bun <plugin-path>/src/make-workspace/cli.ts --workspace <workspace>
   ```
4. The CLI does the work and prints **status per repo**.
5. The skill reads the output and **reports to the PE** in natural language: what
   was cloned, what was already present, what failed and why. No YAML edited by
   hand.

---

## 3. Typed CLI — behavior

### Input
- Flag `--workspace <path>` (default: current directory).
- Reads `<workspace>/.aipe/brain.yaml` and **validates** it against the existing
  types in `src/context-brain/types.ts` (`BrainFile`, `RepoEntry`). Missing or
  malformed brain → clear error, nothing is cloned.

### Materialization (sequential, repo by repo)
For each `repo` in the brain, in file order:

| `path` situation | Action | Status |
|---|---|---|
| Doesn't exist | `git clone <url> <path>` | `cloned` |
| Exists, is a git repo with the **same** remote | untouched | `skipped` |
| Exists, but **diverges** (not git, or different remote) | untouched | `error` (path occupied) |
| Clone fails (auth/network) | — | `error` (git message) |

- **Sequential** by design choice: clean, predictable output, aligned with the
  reliability priority.
- Uses the user's **already-configured git/ssh credentials**. **Never** prompts for
  a password interactively nor tries to work around authentication — on auth
  failure, it fails cleanly and reports the git message.
- **Idempotent and non-destructive:** never overwrites or deletes anything.
  Re-running only completes what's missing.

### Output (readable by the skill)
One line per repo, with a stable prefix for the skill to parse and translate to
the PE. Examples:
```
OK cloned embark
SKIP prontuario (already present)
ERROR faturamento: Permission denied (publickey)
```
And a final aggregate state line, e.g.:
```
STATE workspace=pending (1 error out of 5 repos)
```

### Injectable boundary for testing
The real `git clone` sits behind an injectable abstraction (a "cloner": a function/
interface that takes `url`+`path` and returns success/error, plus an "inspector" of
an existing repo that reports whether a path is git and what its remote is). This
lets tests run without network access and without touching real repositories.

---

## 4. `state.yaml`

- The `workspace` phase becomes `done` **only if all** repos in the brain are
  materialized (`cloned` **or** `skipped`). Any `error` → stays `pending`.
- **Binary** semantics, keeping the current `Phase = "pending" | "done"` enum
  without extending the schema. No per-repo granular status in the state (the
  granular detail lives only in the execution output, for the PE).
- Consequence: `/relationship` (step 3) should only run with `workspace == done`,
  i.e. with all repos present.

---

## 5. Errors & robustness

- **Missing/malformed brain:** aborts before cloning, with a message pointing at
  the problem. `state` is not altered.
- **Occupied, divergent path:** reported as `error`; nothing is touched. The PE
  decides (move the folder, fix the brain, etc.) and re-runs.
- **Auth/network failure on one repo:** doesn't interrupt the others — the CLI
  continues with the remaining repos and aggregates the result; the phase stays
  `pending` while any error remains.
- **Re-execution:** always safe (idempotence from §3).

---

## 6. Tests (`bun test`, repo standard)

- Validation: missing / malformed brain → clear error, no cloning.
- Happy clone: nonexistent path → `cloned` (via fake cloner).
- Idempotence: path present with same remote → `skipped`, without calling the
  cloner.
- Occupied, divergent path (non-git or different remote) → `error`, without
  overwriting.
- Cloner failure (auth/network) → `error`, other repos proceed.
- State aggregation: all ok → `workspace=done`; any error → `workspace=pending`.
- Preservation: `brain.yaml` is never modified by the execution.

---

## 7. Roadmap impact (recorded in the foundation doc)

Two decisions from this session that update the foundation spec:

1. **`/make-workspace` = clone-only.** Per-journey worktree setup **is removed from
   the scope** of this skill and becomes its own foundational sub-project.
2. **Context-injection hook (`SessionStart`)** enters as a foundational sub-project.
   Core idea (to be specified in its own cycle): when a session opens in an
   `aipe-<context>/` with the plugin installed at folder scope, the hook reads
   `.aipe/` (`brain.yaml` + `state.yaml`) and **injects the coordinator's
   "awareness"** — who they are (name), what the context is, the repos, the
   pipeline phase, and the suggested next step. **Active by default** (installing
   it there means "operate this way"); it stops being injected/followed only if the
   PE **explicitly** asks to leave AIPe mode (opt-out).

Suggested order for the next cycles: **`/make-workspace`** (this one) → **context
hook (`SessionStart`)** → **worktree-per-journey** → **`/relationship`** →
**`/context-brain-generator`** → **`/aipe-add-repo`**.

---

## 8. Proposed code structure

Mirrors `src/context-brain/`:

```
src/make-workspace/
  ├── types.ts        # reuses BrainFile/RepoEntry from context-brain; per-repo result types
  ├── read.ts         # reads + validates the workspace's brain.yaml
  ├── clone.ts         # injectable cloner + inspector; per-repo decision logic
  ├── run.ts          # orchestrates: reads brain → materializes each repo → aggregates state
  ├── cli.ts          # flag parsing, calls run, prints per-repo status + STATE
  └── __tests__/
skills/make-workspace/SKILL.md
```
