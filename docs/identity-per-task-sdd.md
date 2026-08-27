# SDD — Identity per task + safe concurrency for non-writing roles (j-20260826-uv)

## Problem

One persona can only be dispatched to one place at a time. A dispatch is addressed
as **persona-on-unit** `(repo, package, specialist)`, so a second dispatch of the
same unit is treated as a *re-dispatch* (needs `--reason`) and collides everywhere:
the ledger upserts over it, the worktree/branch names are identical, and the
per-repo claim lock serializes it. That is correct for a **fix loop** and wrong for
**genuine concurrency** — e.g. one QA reviewing PR #24 while another reviews PR #23.

The distinction that makes concurrency safe: **a QA writes nothing to the repo.** Two
QA runs on two PRs cannot conflict because there is no write to conflict over. Two
**devs** in one package *can*, and stay forbidden here (path-level locking is a later
journey).

## Design

### The new axis: `task`

Introduce an optional, slug-safe `task?: string` (validated `^[a-z0-9][a-z0-9-]*$`,
same shape as a journey id), minted by the coordinator. It names the *specific piece
of work* a persona is doing, distinct from *which persona* does it.

**Backward compatible by construction:** `task` absent ⇒ the implicit single task,
byte-for-byte today's behavior. Every legacy ledger row, worktree and lock has no
`task`, so they all group under the `task = undefined` identity — nothing changes for
them.

The addressable identity becomes **`Persona · task`** on a unit. Threaded through:

| Layer | Today's key | New key |
|---|---|---|
| ledger row (`recordDispatch` upsert) | `repo, package, specialist` | `repo, package, specialist, task` |
| ledger gate / fix-loop (`unitStatus`) | `repo, package` | `repo, package, task` |
| QA-gate audit (`verifyJourney` grouping) | `repo, package` | `repo, package, task` |
| claim lock key | `repo[__package]` | `repo[__package][__task]` *(non-writing roles only)* |
| worktree branch/path | `aipe/<j>/[pkg--]persona` | `…[__task]` |
| session label | `Specialist-journey-project` | `…-task` |

`__` (double underscore) is the task delimiter in branch/path names: `personaSlug`
emits only `[a-z0-9-]`, so `__` never collides with a package (`--`) or persona
segment, it is legal in a git ref, and it keeps the branch a single level (no
directory/file ref conflict a nested `…/task` would risk).

### (1) Fix-loop protection is preserved, per task

The ledger gate's `unitStatus` — which enforces immutability of `merged` and
`--reason` on re-dispatch — keys on `(repo, package, task)`. So:
- Re-dispatching the **same task** still sees its prior delivered/verified → still
  needs `--reason`. A `merged` task stays immutable.
- **Another task** on the same unit is a *different* identity → admitted without a
  reason. The new axis is *another task*, not *another try at the same one*.

### (2) Concurrency where nothing can collide — stated in terms of *writes*

`validateBatch` groups a batch by unit. For a unit that appears more than once:
- if **any** entry's role *writes to the repo* → serialize (reject `same-repo` /
  `same-package`, exactly as today). **Two devs in one package stay forbidden.**
- if **all** entries are *non-writing* roles → admit them **iff each carries a
  distinct `task`**; a missing or duplicate task is rejected `same-task` (a new
  message so a coordinator reading `REJECT` knows *which* rule it hit and why one
  case is allowed and another is not).

"Writes / does not write" is derived from the persona's `role` via
`roleWritesToRepo(role)` (`src/dispatch/roles.ts`), not a hardcoded name list —
`qa` is non-writing today; the rule survives a future non-writing role by adding it
to one set. Unknown role ⇒ treated as writing (safe default: serialize).

### (3) The claim lock is per task for non-writing roles

The physical claim (D3) makes the same-repo law real. For concurrency, two *different
tasks* of a non-writing role must not serialize, but **the same task must still
resolve to exactly one winner** under contention. So `lockKey` takes an optional
`task`, and `dispatch claim` passes it **only when the claiming role is non-writing**
(resolved from the roster). A writing role's lock key ignores `task`, so two devs
still contend on the one unit lock — the serialization D3 added is not removed.

### (4) The QA gate is per task

`verifyJourney` grouped `byUnit` and judged one "most-advanced" status per unit. With
two tasks sharing a unit, a `verified` on task A masked a `delivered` on task B — a
mis-paired gate that reports safety that is not there. The per-task audits
(failed-open, delivered-not-verified, merged-skipped-qa, escalated/blocked-open) now
group by `(repo, package, task)`. Unit-level audits (dependency-landed, no-evidence)
are unchanged. `task` absent ⇒ identity == unit ⇒ identical findings.

### (5) The cap still holds

`MAX_CONCURRENT = 16` is unchanged; N concurrent dispatches of one persona are N
entries in the batch and count toward it like any others.

### Surfaces

- Worktree list / dashboard pipeline / serve DispatchCard render the task so two
  concurrent runs of one persona are distinguishable to a human and a parser.
- The session prompt's recorded `aipe journey record` example commands carry
  `--task`, so a detached specialist records against the right task identity.

## Plan (test-first)

1. `roles.ts` + law: role-aware concurrency (RED: two QA distinct tasks admitted; two
   devs rejected; two QA same/no task rejected `same-task`).
2. `lock.ts` + claim CLI: per-task lock key for non-writing roles; contention proof
   (same task → one winner, racing, repeated).
3. `ledger.ts`: task in upsert key + `unitStatus` (RED: verified on task A does not
   clear task B; same-task re-dispatch needs reason; merged task immutable).
4. `verify.ts`: per-task gate grouping (RED: task-A verified does not hide task-B
   delivered-not-verified).
5. `naming.ts` / worktree `run`/`cli` / `types`: task in branch/path/row.
6. `journey/cli.ts`, `session` label + prompt + sessionId write, dashboard + serve.
7. Full `bun test`, `typecheck`, `build:host`; `journey verify` before/after; drive
   two concurrent QA gates for real.

## Out of scope

Path-level lock and view auto-discovery (what lets two *devs* share a package) — a
later journey. This delivers only the safe half: identity per task + concurrency for
non-writing roles.
