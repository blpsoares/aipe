# The session return channel — five fixes in one seam (SDD)

> Journey `j-20260825-84`, unit `aipe` (Jesse, dev-fullstack). This is the
> committed spec + plan that travels with the PR. Cross-package shape lives in
> the approved Orientation Spec (`.aipe/journeys/j-20260825-84/orientation.md`);
> implementation detail lives here.
> `aipe skill match --task-type session --size normal` → `matched=0 of 0` (no
> SDD kit installed in this workspace), so this is a hand-authored SDD.

## Problem (from the Orientation Spec)

The coordinator cannot reliably tell what its own session-mode specialists are
doing. Everything meant to close that gap either lies or does not resolve. Four
diagnosed defects and one missing capability, all in the dispatch↔ledger↔collect
seam:

- **D7** — the composed prompt hands the specialist paths that do not resolve
  from its worktree cwd. Dispatches are born blind.
- **D8** — a `--workspace .` record from a worktree writes a *phantom* ledger
  inside the worktree; the real ledger never sees the delivery.
- **D6** — `session collect` flattens live/unknown/dead into two states and its
  exit code lies (0 while a unit is not landed / mislabels unknown as running).
- **D5-twin** — `journey verify` fires `dependency-not-landed` for repos outside
  the demand (it reads graph nodes, not the journey's units).
- **NEW** — there is no first-class "I am blocked, I need the coordinator"
  signal, distinct from `escalated` and `delivered`.

## D7 — absolute coordinates for the specialist

**Root cause.** `dispatchCommand` (`src/session/cli.ts`) builds the prompt file
path and the embedded `--workspace`/`--worktree` values from `opts.workspace`,
which is `getFlag("--workspace") ?? process.cwd()`. When the coordinator passes
`--workspace .` (the documented, ironic habit), `opts.workspace === "."`, so:
- the prompt file is written to a **relative** path and handed to `agentop
  session batch` as `@<relative>`. agentop starts the session with cwd at the
  **worktree**, resolves `@<relative>` against it, and finds nothing — the
  specialist boots with an empty brief ("*nenhuma demanda chegou até mim*").
- every `--workspace` / `--worktree` inside the recorded example commands is
  relative too, so the specialist's own `aipe journey record` misfires (→ D8).

**Fix.** Resolve to absolute once, at the top of `dispatchCommand`, and thread
the absolute values everywhere: `const workspace = resolve(opts.workspace)`, and
per unit `const worktree = resolve(workspace, d.worktree)` (a no-op when the
ledger already holds an absolute worktree, which `createWorktree` guarantees —
this is the safety net for a hand-typed relative one). The prompt file path
inherits the absolute workspace; `composePrompt` interpolates the absolute
worktree/workspace into the lane text and every `--workspace`/`--worktree`. cwd
pairing against agentop's echo stays consistent because the cwd we *send* is the
absolute one we also key on.

**Proof (acceptance).** A dispatch given a *relative* `--workspace` still emits
an absolute `@<promptFile>` and absolute `--workspace` lines; proven end-to-end
with a real dispatch into a worktree.

## D8 — a misdirected ledger write is impossible, not merely discouraged

**Root cause.** `aipe journey record --workspace <dir>` writes
`<dir>/.aipe/journeys/<id>.yaml` unconditionally. Handed a worktree, it creates a
phantom ledger there.

**Fix.** A workspace is marked by `.aipe/brain.yaml`; a worktree is not, and sits
under a `.worktrees/` segment. `recordCommand` classifies the handed directory
before writing (`classifyRecordTarget`):
- has `.aipe/brain.yaml` → a real workspace, proceed.
- no brain **and** under a `.worktrees/` segment → a worktree. Walk ancestors for
  one carrying `.aipe/brain.yaml`: if found, **say so and use it** (the write
  lands on the real ledger); if not, **REJECT** naming the correct invocation.
  Never create `.aipe/` inside the worktree.
- no brain and *not* under `.worktrees/` → left untouched (legacy/first-run and
  the whole existing test corpus, which uses bare temp dirs).

Both signals are required, exactly as the Orientation Spec frames them, so the
guard is narrow: it refuses the trap without refusing legitimate bare-dir use.

**Phantom ledgers already on disk.** `findPhantomLedgers(workspace)` scans each
repo's `.worktrees/*/.aipe/journeys/*.yaml` and reports them; surfaced as
`FINDING WARNING phantom-ledger …` by `journey verify`. Detected and reported,
never auto-deleted (destructive, and the coordinator must reconcile them).

## D6 — collect is honest, including in its exit code

**Root cause.** Two failures: (1) the fail-open path presumes every outstanding
session *running* when the live list is unreadable — asserting a liveness it
cannot verify; (2) exit code collapses everything-but-landed onto one value.

**Fix.** Liveness carries a *reliability* bit. `poll.ts` returns
`{reliable, ids}`: `reliable` only when `session list` exited 0 **and** parsed.
`classify(ledger, ids, reliable)` (reliable defaults true for the pure callers):

| ledger / liveness                                   | phase          |
|-----------------------------------------------------|----------------|
| status ∈ {delivered,verified,merged}                | `landed`       |
| status = redirected                                 | `redirected`   |
| status = blocked (NEW)                              | `waiting`      |
| in-flight, **no** sessionId                          | `dead-silent`  |
| in-flight, sessionId, **not** reliable              | `unknown`      |
| in-flight, sessionId, reliable, present in list     | `running`      |
| in-flight, sessionId, reliable, absent from list    | `dead-silent`  |

`unknown` never falls through to dead. agentop's `activity` field is never
consulted (it returns `waiting` mid-tool-call — an unreliable ground truth). The
collect loop keeps polling while any unit is `running` **or** `unknown`, so a
transient list failure is retried and only a *persistent* one surfaces as
`unknown` at the deadline — the fail-open safety (never declare live work dead)
is preserved, now without the dishonest `running` label.

**Exit code = the worst finding.** `landed:0`; `running`/`redirected:2` (needs
attention, no work at risk); `unknown:4` (can't tell); `dead-silent:5` (work may
be lost); `waiting:6` (a human is blocked on the coordinator now). The command
exits the max over all units. `0` iff every unit truly landed.

## D5-twin — verify's landing gate is scoped to the journey's own units

**Root cause.** `verifyJourney` gates `dependency-not-landed` on
`contextUnits.has(producer)` — the context-wide graph nodes, which include repos
the demand merely consumes (e.g. `agentistics`). Such a node can never reach
verified/merged in this journey, so it is a permanent false critical.

**Fix.** Mirror PR #18's `dispatch validate` narrowing: gate on the journey's own
units — the set of units present in *this ledger* (`byUnit` keys). An edge to a
producer outside the demand is not an unmet dependency; a real in-journey
producer that has not landed still fires. `contextUnits` is dropped from the
signature (the CLI no longer reads the graph for verify's purposes).

**Caveat (not smuggled).** As Jesse recorded on the sibling: the ledger cannot
see a producer of a *later, not-yet-dispatched* wave. Closing that needs the
demand's units persisted at spec time — **proposed, not built here** (see below).

## NEW — a "blocked, needs the coordinator" signal

**Two halves.**

1. *The specialist can declare it.* A new terminal-ish status `blocked` on the
   ledger, recorded via `aipe journey record --status blocked --reason "…"`.
   Distinct from `escalated` (cross-repo scope — the PE's call) and `delivered`.
   The ledger gate requires the reason (the whole value of the signal is *what
   the specialist needs*), stored as `blockedReason`. The session prompt now
   documents the command, so a stuck specialist has a first-class move.
2. *The coordinator discovers it without reading a terminal.* `collect` surfaces
   a `blocked` unit as `WAITING-ON-COORDINATOR …reason=…`, and `poll.classify`
   maps it to the `waiting` phase. `journey verify` flags a still-open blocked
   unit as `WARNING blocked-open`. When `aipe status` lands (j-20260825-yn) it
   reads the same ledger field.

**The honest boundary (escalation to the PE).** The Orientation Spec asks that a
specialist that *simply stops* not be indistinguishable from one that is
thinking. That half cannot be built honestly today: distinguishing "idle at a
prompt" from "mid-tool-call" requires a trustworthy per-session activity/idle
signal, and agentop's only such field (`activity`) demonstrably lies (it
reported `waiting` for a session mid-tool-call). We therefore ship the
**declared** signal (physical, ledger-backed) and the honest `unknown`
degradation, and **escalate the auto-detection half** to the PE:

> agentop would need to expose, per session in `session list --json`, a
> **reliable** last-activity timestamp (or an idle flag that is *not* set during
> tool execution). Given that, `collect` could classify a long-idle,
> nothing-recorded session as `waiting` automatically instead of `running`.
> Until then, undeclared silence is honestly reported as `running` (the process
> is verifiably alive; progress is not independently verifiable) and true
> blockage relies on the declared signal.

This keeps the standard the evidence gate sets: what we assert is physical, and
what we cannot verify we do not assert.

## Plan (test-first, RED→GREEN)

1. D7 — `prompt.test`/`cli-dispatch.test`: relative `--workspace` ⇒ absolute
   `@promptFile` + absolute embedded paths. Resolve in `dispatchCommand`.
2. D8 — new `cli-record-worktree.test`: a `--workspace <worktree>` record is
   refused (or retargeted to the resolved real workspace); `findPhantomLedgers`.
3. types — add `blocked` status + `blockedReason`; rank tables in `ledger.ts`
   and `verify.ts`.
4. NEW — ledger gate `blocked-needs-reason`; `recordCommand` wiring; prompt doc.
5. D6 — `poll.test`/`cli-collect.test`: reliability bit, `unknown`/`waiting`
   phases, worst-finding exit code.
6. D5-twin — `verify.test`: silent on out-of-demand edge, still fires in-journey.
7. Proven end-to-end with a real dispatch; `bun test` green; `tsc` silent; no
   `any`; `build:host` carries it; CI green with `gh pr checks` attached.

## Proposal (out of scope here — for the PE)

Persist the demand's declared units on the ledger at spec-approval time (a
`units:` list on `JourneySpec`), so both `dispatch validate` and `journey verify`
can gate against the *full* demand — including a producer whose wave has not been
dispatched yet — instead of the ledger∪batch approximation. This closes the
caveat both D5 and D5-twin share. Not built here.
