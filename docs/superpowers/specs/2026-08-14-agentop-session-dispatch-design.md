# Session-mode dispatch via agentop — design

**Status:** Approved, ready for planning.
**Origin:** brainstorming session, 2026-08-14.

## Purpose

Today a specialist is always dispatched as an **in-process subagent**: the
coordinator reads the persona body, starts a subagent with the hiring brief,
and receives `{ status, pr, evidence }` back synchronously. That subagent
lives inside the coordinator's session — it shares the session's lifetime, and
its work is lost if the coordinator dies.

`agentop` (v1.9.0+, from the agentistics project) can start **real, detached
assistant sessions**, tmux-backed, grouped under a task:

```
agentop session batch --task "<name>" [--cwd <path>] [--model <id>] [--effort <lvl>] \
                      --session "<harness>[@<cwd>]: <prompt>" [--session "..."] [--json]
agentop session list --json | open "<task>" | attach | kill | note
```

That maps almost 1:1 onto an AIPe dispatch wave: `--task` is the journey, each
`--session` is a unit, and `@<cwd>` is the worktree `aipe worktree create`
already provisions. Dispatching this way gives each specialist its **own full
context window** — and lets a unit run under `ultracode`, which is a
session-level opt-in that a subagent cannot carry.

This spec adds session-mode dispatch as a **second route** alongside the
existing subagent route, without changing worktrees, the dispatch law, the
journey ledger, or the QA gate.

### Non-goal

Replacing subagent dispatch. Subagent stays the default: it is synchronous,
cheaper, and returns evidence directly. Session mode is for heavy or long
units where a dedicated context window (and possibly `ultracode`) earns its
cost.

## Dependency: agentop is a soft dependency

`agentop` **cannot** be a `package.json` dependency. Two facts:

- The installed tool is a native ELF binary at `~/.local/bin/agentop`, part of
  the agentistics project — not published to npm.
- The npm package named `agentop` is an **unrelated project**
  (`ktamas77/agentop`, v0.5.8, a `top`-like dashboard for agent sessions).
  Depending on it would install the wrong software.

So agentop enters as a **soft dependency with a preflight**:

- `src/session/probe()` returns `{ present, version, ok }` against a minimum
  version, shelling out to `agentop --version`.
- `aipe doctor` (and the `make-workspace` preflight) reports it and prints
  install instructions when missing or stale.
- Without agentop, AIPe operates exactly as it does today. Only `mode: session`
  becomes unavailable, with an explicit message — nothing silently degrades.

## Architecture

Three new pieces, each with one purpose.

### `src/session/` — the agentop wrapper

The **only** part of AIPe that knows agentop exists. Rationale: the repo's
stated invariant is that everything past raw agent output on disk is a
deterministic, tested `aipe` subcommand. Composing
`--session "claude@/path: <40-line brief>"` by model judgement in a shell
string is a quoting bug waiting to happen; behind a subcommand the brief goes
by file and the shell never sees its content.

Surface:

- `probe(): Promise<{ present: boolean; version: string | null; ok: boolean }>` —
  minimum version **1.9.0**, the version verified to carry
  `session batch`/`open`/`list` with `--json`. That is the verified floor, not
  necessarily the earliest release that works.
- `dispatch(journey, units, opts): Promise<SessionId[]>` — composes one prompt
  file per unit, runs a single `agentop session batch --task aipe/<journey>
  --json`, returns the started ids.
- `poll(journey): Promise<UnitState[]>` — cross-references
  `agentop session list --json` with the journey ledger.

agentop is invoked through an **injectable runner**, so tests never execute the
binary.

New CLI subcommands (registered under a `session` command in `src/cli.ts`):

- `aipe session dispatch --journey <id> --workspace <dir>`
- `aipe session collect --journey <id> --workspace <dir> [--timeout <s>]`
- `aipe session guard` — called by the PreToolUse hook, reads the hook payload
  on stdin, prints the decision.

### `src/dispatch/` — a `mode` axis on the batch

`DispatchEntry` (`src/dispatch/types.ts`) gains:

```ts
mode?: "subagent" | "session";   // default: "subagent"
intensity?: "normal" | "ultracode";  // default: "normal"
```

`validateBatch` (`src/dispatch/law.ts`) keeps its existing role — concurrency
cap, same-package serialization, known-specialist check — and gains two
rejections:

- `agentop-unavailable` when any entry is `mode: "session"` and `probe()` fails.
- `session-cap-exceeded` when session-mode entries exceed their own cap.

**On the cap:** `MAX_CONCURRENT = 16` (`src/dispatch/types.ts:16`) was
calibrated for subagents. Sixteen real Claude sessions — each with its own
context window, some running `ultracode` and fanning out Workflow agents — is a
different order of cost. Session mode gets its own cap of **4** concurrent
sessions per wave, adjudicated by the same `validateBatch`. The subagent cap
stays at 16; a mixed wave is checked against both.

### The containment hook

Installed by the claude-code adapter into the workspace's
`.claude/settings.json`, alongside the `SessionStart` hook that already exists
(`src/harness/claude-code.ts:50`). It is a thin shim: it calls
`aipe session guard` and applies the printed decision, so the "is this a
session spawn?" question is a pure, tested function rather than a regex loose
in a shell script.

Rules:

| Condition | Decision |
| --- | --- |
| `AIPE_ROLE` is not `specialist` | allow (the coordinator passes through) |
| specialist, `agentop session <harness>` or `session batch` | **deny**, unless a grant is available |
| specialist, `agentop session kill` | **deny** — nothing in a specialist's job requires killing a session, and a specialist must never be able to kill a sibling's |
| specialist, `agentop session list/attach/rename/note` | allow |

The escape valve is `AIPE_SESSION_GRANT=<n>`, injected into the session
environment by the coordinator at dispatch time. The guard decrements it
against an on-disk counter in the journey directory, using the same lock
mechanism as `aipe dispatch claim` (`src/dispatch/lock.ts`) — without an
atomic counter, a grant of 1 becomes unbounded spawning.

#### Stated limit: the gate is Claude Code-only

`PreToolUse` is a Claude Code mechanism. A specialist started under another
harness agentop can launch — codex, gemini, copilot, antigravity, kimi — does
**not** pass through this gate; for those, the prohibition is prose only.

Design consequence: **while the gate exists only for Claude Code, session-mode
dispatch is restricted to the `claude` harness.** Multi-harness dispatch is a
door agentop opens that this spec deliberately does not walk through.

## Flow: a session-mode wave

Steps 0–3 of `/operate` are unchanged (read the ledger, open the journey,
decompose into per-package tasks, sequence into waves).

**3.5 — the Orientation Spec gains two fields per unit:** `mode` and
`intensity`. Both go through the PE's existing approval gate. The PE is the
role that approves budget in AIPe's model, so turning on `ultracode` — which
multiplies token spend via Workflow — belongs to the gate they already sign.
The coordinator executes what was approved; it does not raise intensity on its
own judgement.

**4 — provisioning is identical for both modes:** `aipe dispatch claim`
(physical per-repo lock), `aipe worktree create`, `aipe journey record --status
dispatched`.

**5 — dispatch.** `aipe session dispatch` reads the ledger for units marked
`dispatched` with `mode: session` and, for each, composes a prompt file:

1. the persona body, read from `<repo>/.claude/skills/<slug>/SKILL.md` — the
   same source the coordinator already reads for subagent dispatch, so it does
   not depend on the worktree carrying `.claude/`;
2. that unit's slice of the approved Orientation Spec (scope, acceptance,
   relevant files, relations, definition of done);
3. the **return contract** (below).

When `intensity: ultracode`, the composed prompt includes the literal keyword
`ultracode` — that is how the opt-in actually works; there is no CLI flag for
it.

Prompt files are written to `.aipe/journeys/<id>/prompts/<unit-fqid>.md` and
**kept** — they are the audit trail of exactly what each specialist was told,
which the in-memory subagent brief never left behind.

Then one `agentop session batch --task aipe/<journey> --json` for the whole
wave. The returned session ids are written back to the ledger.

**Ledger fields added by this spec** (per unit): `mode`, `intensity`, and
`sessionId`. Nothing else in the ledger schema changes.

### The return contract

A detached session does not return a value. The contract that replaces the
subagent's return is appended to every dispatched prompt:

- operate strictly inside `<worktree>` (for a monorepo package: stay within
  `<package-path>`);
- run spec-driven first (`aipe skill match`), then TDD;
- run `/verify-before-done` and gather evidence before claiming done;
- push `<branch>` and open the PR;
- **then record the result in the ledger:**
  `aipe journey record --journey <id> … --status delivered --pr <url>
  --evidence-cmd "…" --evidence-summary "…"`;
- then stop;
- you are `AIPE_ROLE=specialist`; opening sessions is forbidden.

The ledger remains the source of truth. The session does not *return* — it
*records*.

**6 — collection.** `aipe session collect --journey <id> --timeout <s>` polls,
cross-referencing `agentop session list --json` with the ledger, and classifies
each unit:

- `landed` — a record with evidence exists;
- `running` — session alive, no record yet;
- `dead-silent` — session gone, nothing recorded.

The coordinator waits actively and reports to the PE once the wave closes — one
interaction for the PE, same as today.

**7 — QA gate, unchanged.** Every delivery still goes through an independent QA
persona in its own worktree, which may itself be subagent- or session-mode.
Then `journey record --status verified`, then `aipe dispatch release`.

## Failure modes

| Failure | Response |
| --- | --- |
| agentop absent or below minimum version | `validateBatch` rejects `mode: session`; preflight prints install instructions; subagent mode unaffected |
| `dead-silent` unit | `collect` returns worktree + branch. The coordinator inspects the branch read-only (`git log`) and either re-dispatches with a brief that says *continue from what is on the branch*, or escalates to the PE. **Never a blind re-dispatch** — the same ledger law that forbids re-dispatching a `merged` unit applies |
| Session still `running` past the timeout | `collect` returns it with its session id; the **PE** decides whether to wait or `agentop session kill`. The coordinator does not kill sessions |
| `delivered` recorded without evidence | Already REJECTed by the ledger. Unchanged |
| Two sessions on the same repo | Already blocked physically by `aipe dispatch claim` |
| Coordinator dies mid-wait | Sessions survive — they are detached. On return, `/operate` already mandates reading the ledger first, and `collect` reconciles via the `aipe/<journey>` task |

That last row is a genuine gain, not just a mitigation: under subagent
dispatch, a dead coordinator takes the work with it. Under session dispatch it
does not.

## Testing

agentop enters through an injectable runner; no test executes the binary.

- **Prompt composition** — persona body + spec slice + return contract are all
  present; the `ultracode` keyword appears if and only if
  `intensity: ultracode`.
- **argv assembly** — the batch argv is well-formed, and specifically **no
  brief content appears in argv** (it goes by file).
- **agentop `--json` parsing** — started ids and `session list` output.
- **State classification** — `landed` / `running` / `dead-silent` against a
  fake ledger.
- **`probe()`** — absent binary, below-minimum version, ok.
- **`validateBatch`** — rejects session mode without agentop; rejects above the
  session cap; existing rejections unchanged.
- **`session guard`** — allow/deny table across command shapes, plus the grant
  counter decrementing and exhausting under concurrent calls.

## Out of scope

- Replacing subagent dispatch.
- Multi-harness dispatch (codex/gemini/…), until the containment gate covers
  them.
- A dedicated supervisor session per journey.
- Any change to worktree lifecycle, the relations graph, the QA gate, or the
  ledger's schema beyond the new per-unit fields.
