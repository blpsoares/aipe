# SDD — bugs-campo (j-20260828-sr)

Package spec + plan for the field-report bugs triaged against v1.6.0. No SDD kit
matched (`aipe skill match --task-type bugfix --size M` → `matched=0 of 0`), so
this is the lightweight spec the brief asks be committed alongside the code.

## Problem

The AIPe breaks in **new-layout workspaces** — the very layout `aipe upgrade`
recommends (`aipe workspace migrate-layout` to move repos under `repos/`). We
were actively recommending a migration that broke the central dispatch flow.

Items 1, 2, 5, 6 were corrected; items 3 and 4 were investigated with a written
verdict (below).

## Per-item decisions

### 1 — `session dispatch` ignored the `repos/` layout when resolving the persona

**Decision:** resolve the persona directory **through the brain**, like the rest
of the CLI, never by assuming a repo lives at `<workspace>/<name>`.

- New pure helper `repoDir(repos, name)` in `src/context-brain/layout.ts` — the
  single seam for "where does this repo live", returning the brain's normalized
  `repo.path` (or `undefined`).
- `src/session/cli.ts` reads the brain once (`readBrain`) and resolves each
  unit's persona via `repoDir`. A workspace with **no brain on disk** (or a repo
  the brain does not name) falls back to the bare name — the legacy behavior, so
  every existing test and every legacy workspace keeps working.
- Evidence: `bun test src/session/__tests__/cli-dispatch.test.ts` — the new test
  *"resolves the persona through the brain's repo path under the repos/ layout —
  no symlink"* is RED before the fix, GREEN after; whole file 20 pass.

**Inventory (the brief asked for it).** Searched every `join(workspace, …)` and
every `join(_, <repo-name>, …)` in `src/`. **`src/session/cli.ts:460` was the
sole offender** — the only place using a repo *name* as a path segment. Every
other consumer already resolves through `repo.path`/the brain:
`worktree/run.ts`, `hire-specialists/run.ts`, `make-workspace/clone.ts`,
`detect-packages/cli.ts`, `toolbox/cli.ts` (spec-kit + pdd both build a
`pathByRepo` map from the brain), `journey/record-target.ts`. No other fix
needed.

### 2 — `workspace migrate-layout` did not update `personas.yaml`

**Decision:** `migrate-layout` **rewrites `personas.yaml`** (chosen over making
`validate-personas` resolve by brain). Justification: a persona's recorded
`path` embeds its repo directory (`./<repo>/.claude/skills/<slug>`) and is a
physical install location. `migrate-layout` physically moves those files and
already rewrites `brain.yaml` to stay truthful to disk; the persona registry is
the same class of record and must stay truthful for the same reason. Resolving
by brain at read time would fix only `validate-personas` and leave every other
reader of `personas.yaml.path` pointing at the old spot.

- New pure helper `reconcilePersonaPaths(brain, entries)` in
  `src/hire-specialists/registry.ts` — recomputes each persona's canonical path
  (`<repo.path>/<personaSkillDir>`, byte-for-byte what `buildRegistry` writes)
  from the brain, returning the rewritten entries + the list of changes.
- `src/migrate-layout/run.ts` reconciles against the **post-migration** brain
  and writes `personas.yaml` when anything changed. New `personas` /
  `writePersonas` deps (injectable, defaulting to `readPersonas` / a
  `renderPersonasYaml` write).
- **Drift detection (the "ninguém avisa" gap).** Reconciling against the
  post-migration brain catches BOTH a repo moving now AND a workspace already
  migrated by an older, persona-blind migration (zero moves, stale registry):
  `migrate-layout` no longer early-returns `nothing-to-do` when persona paths
  drift — dry-run reports each `PLAN persona …`, `--apply` repairs them.
  `validate-personas` additionally emits an **actionable** issue naming
  `aipe workspace migrate-layout` when a recorded path disagrees with the brain,
  so the breakage is loud at the exact spot it was first noticed (0/N ready).
- Evidence: `bun test src/migrate-layout src/validate-personas src/hire-specialists`
  (23 pass) + the end-to-end run in the ledger: `validate-personas` 0/1 → 1/1
  across `migrate-layout --apply`, with `0 repo(s), 1 persona path(s)`.

### 5 — `execution propose` was circular (required dispatches before dispatch)

**Decision:** `propose` (pre-choice pricing) consumes the **spec's units** — the
`### <unit>` subsections under `## Per-package scope` of the Orientation Spec,
which exist before any dispatch. `plan` (post-choice) legitimately keeps needing
dispatched units (a chosen envelope lives on a dispatch record), so its
requirement stays but its **error message is now actionable** (points at
`propose` + recording the envelope), instead of the old dead end.

- New pure `parseOrientationUnits(md)` in `src/journey/spec.ts`, scoped to the
  Per-package scope section so prose `###` headings elsewhere are never counted.
- `propose` derives units from the spec; only when the spec declares none yet
  does it fall back to the ledger's dispatched fqids (so post-dispatch pricing
  and spec-less journeys still work). Deduped — a unit is priced once even when
  a dev and a QA row share its fqid.
- Evidence: `bun test src/execution` (80 pass) + the ledger run: an approved
  spec with `dispatches=0` prices `UNIT embark` fully.

### 6 — `agentop events` was undocumented; subagent-default hid the coordinator

**Decision (docs, `skills/operate/SKILL.md`):**

- Teach `agentop events watch --task aipe/<id> --on
  waiting,waiting-approval,exited --notify <session>` as the **standard step
  right after `session dispatch`**, with `events tail --since` to recover missed
  events (it's a file, survives reboot). Explicit boundary: a `waiting-approval`
  session waits on **a person** — neither the coordinator nor another session may
  answer for it.
- Write the mode criterion: **when the PE needs real-time visibility (dashboard,
  demo, follow-along), the mode is `session`, not subagent** — a subagent runs
  in-process and is invisible to `agentop session list` and the dashboard.
- Authored to `skills/authoring-rules/SKILL.md` (modals paired with the why, an
  explicit "what it does NOT do" boundary).

## Items 3 & 4 — verdicts (investigate & conclude)

### 3 — prompt instructing `--workspace .` → **DOES NOT REPRODUCE**

The reporter saw a composed prompt telling the specialist to run
`aipe journey record --workspace .`, which from the worktree resolves wrong.
Against v1.6.0 this does not reproduce:

- `src/session/cli.ts:358` — `const workspace = resolve(opts.workspace)` — the
  workspace is resolved to **absolute once**, at the top of `dispatchCommand`,
  before anything is composed.
- `src/session/prompt.ts:59` interpolates `${input.workspace}` (that resolved
  absolute path) into every recorded command; there is no literal `--workspace
  .` anywhere in the emitted prompt.
- The code comment at `cli.ts:350–358` documents that a relative `--workspace .`
  *used to* write a relative prompt path "that agentop, running with cwd at the
  worktree, could never find — the session booted blind", and that it was fixed.
- The regression test already exists: `cli-dispatch.test.ts` asserts the prompt
  `not.toContain("--workspace .")` and `toContain("--workspace <abs>")`.

**Conclusion:** residue of the reporter's older version — the exact hypothesis
the orientation flagged. No fix written (a fix for a non-existent bug is debt).

### 4 — specialist born without the brief → **NOT an aipe defect** (cross-repo)

Claim: the specialist starts idle because the composed prompt lives at
`.aipe/journeys/<id>/prompts/<fqid>.md`, **outside** the worktree the containment
hook confines it to, so it can't read it.

Findings:

- The prompt IS handed to the session: `src/session/batch.ts:63` passes it as
  `--session "<harness>@<cwd>: @<promptFile>"` — the `@<file>` reference the
  AIPe authors intend agentop to expand.
- **The containment hook does not restrict file reads.** It is a Claude Code
  `PreToolUse` hook with `matcher: "Bash"` running `aipe session guard`
  (`src/harness/claude-code.ts:27`, `src/harness/types.ts:34`), and `guard.ts`
  only governs `agentop session` spawn/kill for a specialist. It never touches
  Read/Edit/Write and never confines the working directory. So a persona CAN
  read a prompt file outside its worktree.
- **First-hand evidence:** this very session (a dispatched specialist) read its
  own brief from
  `/home/mithrandir/aipe-blpsoares/.aipe/journeys/j-20260828-sr/prompts/aipe.md`
  — outside its worktree — with no denial.

**Conclusion:** the "containment blocks the brief" hypothesis is **false**; the
file's location is irrelevant to readability. To the extent the "sits idle"
symptom is real (the coordinator's daily `tmux send-keys` habit), it is about
**agentop's** initial-prompt delivery / auto-submit of the `@<file>` reference to
a fresh detached session — a cross-repo (`agentistics`) contract, escalated to
the coordinator, not an aipe fix. No aipe change made for item 4.
