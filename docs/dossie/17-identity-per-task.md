# Dossier 17 — Identity per task (`Persona · task` — concurrency for roles that don't write)

**Status:** Merged (`f203fc6`, PR #28, 2026-08-27; journey `j-20260826-uv`).
**Spec:** [`docs/identity-per-task-sdd.md`](../identity-per-task-sdd.md).

> **Second link of the parallelism chain** —
> [16 atomic claim](16-atomic-claim.md) → **17 identity per task** →
> [18 path-lock](18-path-lock.md). It only became buildable once the claim was
> physical ([16](16-atomic-claim.md)); it deliberately stops short of the third
> link. See the [chain overview](README.md#the-parallelism-chain).

## The question this link answers

*A persona can only be dispatched to one place at a time. How does one QA review
PR #24 while another QA reviews PR #23 — at the same time, in the same repo —
without the two colliding?*

A dispatch is addressed as **persona-on-unit** `(repo, package, specialist)`. A
second dispatch of the same unit is therefore read as a *re-dispatch* (needs
`--reason`) and collides everywhere: the ledger upserts over it, the
worktree/branch names are identical, and the physical per-repo claim of
[dossier 16](16-atomic-claim.md) serializes it. That is exactly right for a **fix
loop** and exactly wrong for **genuine concurrency**.

The distinction that makes concurrency safe is stated in one sentence, and the
whole chapter turns on it: **a QA writes nothing to the repo.** Two QA runs on
two PRs cannot conflict because there is no write to conflict over. Two **devs**
in one package *can*, and stay forbidden here — sharing a package between two
writers is the third link, not this one.

## The new axis: `task`

The design introduces one optional, slug-safe field: `task?: string` (validated
`^[a-z0-9][a-z0-9-]*$`, the same shape as a journey id), minted by the
coordinator. It names the *specific piece of work* a persona is doing, distinct
from *which persona* does it. The addressable identity becomes **`Persona ·
task`** on a unit.

It is **backward compatible by construction**: `task` absent ⇒ the implicit
single task, byte-for-byte today's behavior. Every legacy ledger row, worktree
and lock has no `task`, so they all group under the `task = undefined` identity
and nothing changes for them (`docs/identity-per-task-sdd.md:26`). The new axis
is threaded through six layers that previously keyed on the unit alone:

| Layer | Old key | New key |
|---|---|---|
| ledger row (`recordDispatch` upsert) | `repo, package, specialist` | `+ task` |
| ledger gate / fix-loop (`unitStatus`) | `repo, package` | `+ task` |
| QA-gate audit (`verifyJourney` grouping) | `repo, package` | `+ task` |
| claim lock key (`lockKey`) | `repo[__package]` | `+ [__task]` *(non-writing roles only)* |
| worktree branch/path | `aipe/<j>/[pkg--]persona` | `…[__task]` |
| session label | `Specialist-journey-project` | `…-task` |

`__` (double underscore) is the task delimiter in branch/path names: `personaSlug`
emits only `[a-z0-9-]`, so `__` never collides with a package (`--`) or persona
segment, it is legal in a git ref, and it keeps the branch a single level
(`docs/identity-per-task-sdd.md:42`).

## Concurrency stated in terms of *writes*, not names

`validateBatch` (`src/dispatch/law.ts:17`) groups a batch by unit. For a unit
that appears more than once (`anyWrites`, `src/dispatch/law.ts:124`):

- if **any** entry's role *writes to the repo* → serialize (reject `same-repo` /
  `same-package`, exactly as before). **Two devs in one package stay forbidden.**
- if **all** entries are *non-writing* roles → admit them **iff each carries a
  distinct `task`**; a missing or duplicate task is rejected `same-task` — a new
  message, so a coordinator reading `REJECT` knows *which* rule it hit and why
  one case is allowed and another is not (`docs/identity-per-task-sdd.md:57`).

"Writes / does not write" is derived from the persona's `role` via
`roleWritesToRepo(role)` (`src/dispatch/roles.ts:21`), **not** a hardcoded name
list. `qa` is non-writing today; a future non-writing role survives by being
added to one set. An unknown role is treated as writing — the safe default is to
serialize.

## Four surfaces that had to learn the axis

1. **Fix-loop protection, per task.** `unitStatus` keys on `(repo, package,
   task)`. Re-dispatching the *same* task still sees its prior delivered/verified
   → still needs `--reason`; a `merged` task stays immutable. *Another* task on
   the same unit is a different identity → admitted with no reason. The new axis
   is another task, not another try at the same one.
2. **The physical claim, per task — for non-writing roles only.** `lockKey` takes
   an optional `task` (`src/dispatch/lock.ts:40`), and `dispatch claim` passes it
   **only when the claiming role is non-writing**. Two different tasks of a QA get
   distinct lock files and do not serialize; the *same* task still resolves to
   exactly one winner under contention (the atomicity of [dossier 16](16-atomic-claim.md)
   is unchanged). A writing role's lock key **ignores** `task`, so two devs still
   contend on the one unit lock — the serialization link 16 added is not removed.
3. **The QA gate, per task.** `verifyJourney` used to judge one "most-advanced"
   status per unit; with two tasks sharing a unit, a `verified` on task A could
   mask a `delivered` on task B — a mis-paired gate reporting safety that is not
   there. The per-task audits (failed-open, delivered-not-verified,
   merged-skipped-qa, escalated/blocked-open) now group by `(repo, package,
   task)`; unit-level audits (dependency-landed, no-evidence) are unchanged
   (`docs/identity-per-task-sdd.md:81`).
4. **The human/parser surfaces.** Worktree list, dashboard pipeline and the
   serve `DispatchCard` render the task, so two concurrent runs of one persona are
   distinguishable; the session prompt's recorded `aipe journey record` example
   carries `--task`, so a detached specialist records against the right identity.

The `MAX_CONCURRENT = 16` cap is unchanged (`src/dispatch/law.ts:26`): N
concurrent dispatches of one persona are N entries in the batch and count toward
it like any others.

## Why this link could not be skipped

Concurrency for non-writing roles is only *safe* because a physical claim already
guarantees that the *same* task resolves to one winner — without
[dossier 16](16-atomic-claim.md)'s atomic lock, "two QA on two PRs" would have no
floor under it and a re-dispatch of one task could still double-provision. And it
deliberately stops at non-writing roles: letting two **devs** share a repo needs
the lock to reason about *which files* each touches, which is exactly what
[dossier 18](18-path-lock.md) builds next. Identity-per-task is "the safe half" —
it ships concurrency where nothing can collide, and leaves the colliding case
locked.

## How it was proven

RED-first per the plan (`docs/identity-per-task-sdd.md:100`): two QA with distinct
tasks admitted; two devs rejected; two QA with the same or no task rejected
`same-task`; a per-task contention proof (same task → one winner, racing,
repeated); a ledger test that a `verified` on task A does not clear task B; and a
gate test that task-A `verified` does not hide task-B `delivered-not-verified`.
The acceptance included driving two concurrent QA gates for real.

## Left open (documented, and it is exactly link 3)

Path-level lock and view auto-discovery — what lets two *devs* share a package —
were explicitly out of scope (`docs/identity-per-task-sdd.md:116`). This chapter
delivered only the safe half; [dossier 18](18-path-lock.md) delivers the rest.
