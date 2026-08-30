# Dossier 16 — Atomic claim (`aipe dispatch claim` — the same-repo law becomes physics)

**Status:** Merged (`f351801`, PR #27, 2026-08-27; journey `j-20260826-1i`).
**Spec:** [`src/dispatch/CLAIM.md`](../../src/dispatch/CLAIM.md) and
[`docs/atomic-claim-completion-sdd.md`](../atomic-claim-completion-sdd.md).

> **First link of the parallelism chain.** This chapter is the first of three
> that must be read in order — [16 atomic claim](16-atomic-claim.md) →
> [17 identity per task](17-identity-per-task.md) →
> [18 path-lock](18-path-lock.md). Each link answers a question the previous one
> opened; none could have been built before the one before it. See the chain
> overview in the [README](README.md#the-parallelism-chain).

## The question this link answers

*How do two coordinator sessions, running against the same repo on the same
disk at the same time, avoid both provisioning a worktree for it at once?*

Until this landed, the **same-repo law** — "at most one specialist writing to a
given repo at a time" — was only a *convention*, adjudicated by `aipe dispatch
validate` over a single in-memory batch (`src/dispatch/law.ts`). `validate` sees
its own batch and nothing else: two coordinator sessions each pass their own
validation and then race the classic read-decide-write on the journey ledger,
both winning the same repo. The law needed to stop being an argument and become
**physics**: a physical mutual exclusion per repo, resilient to a process that
dies mid-flight.

## The mechanism: an atomic file, not a lock server

`aipe dispatch claim <repo> --journey <id> --specialist <name> [--package p]
[--branch b] [--force]` creates `.aipe/locks/<key>.lock`, where `key` is the
repo (or `repo__package`, since the same-repo law is already package-keyed —
`lockKey`, `src/dispatch/lock.ts:40`).

The atomicity is the whole point, and it is bought from the operating system,
not from a daemon. The content is written to a unique temp file and then
`link(tmp, lock)` publishes it (`src/dispatch/lock.ts:234`). `link()` carries
`O_CREAT|O_EXCL` semantics: it is atomic and fails `EEXIST` if the target
exists. Two consequences fall out for free — the lock file, once *visible*, is
already *complete* (there is no empty-file window that `open('wx')` would leave
open), and among N racers exactly one `link()` succeeds. There is no lock
server, no lease renewal, no network — the serialization point is a single
syscall.

The lock body is YAML: `repo, package?, journey, specialist, branch?, pid,
timestamp` (`src/dispatch/CLAIM.md:29`). On a live collision with another owner
the claim does **not** hard-block — it prints `COLLISION …` and exits non-zero
(2), leaving the incumbent untouched (`src/dispatch/lock.ts:241`). The
coordinator's `operate` flow reads that exit code and does not dispatch.

## Staleness: a dead coordinator must not lock a repo forever

A physical lock raises a physical problem: the holder can crash. `isLockActive`
(`src/dispatch/lock.ts:139`) decides liveness by **three signals, in order of
authority** — and getting this ordering right was where the real defect lived
(below):

1. **Tracked pid dead** — `pid > 0 && !isPidAlive(pid)` ⇒ overwritable now (the
   holder crashed). The `--pid` a coordinator passes is its own long-lived
   *session* pid; `pid <= 0` means "no pid tracking — the ledger governs"
   (`isPidAlive`, `src/dispatch/lock.ts:68`; `EPERM` counts as alive, only
   `ESRCH` as dead).
2. **A `dispatched`/`redirected` ledger row exists** for the same unit ⇒ alive
   (the durable primary signal — a session that finishes calls `dispatch
   release`, moving the status away from `dispatched`).
3. **Freshness** — `now - lock.timestamp < STALE_ORPHAN_GRACE_MS` (10 minutes,
   `src/dispatch/lock.ts:117`) ⇒ alive *even with no `dispatched` row yet*.

An orphan (no signal) or a dead pid makes the lock overwritable: the claim
reconciles it, takes it, and exits 0 reporting `RECONCILED prev=…`. The take-over
is itself atomic — `unlink` the stale lock, `link` the temp in a short loop; if a
rival recreates an active lock in the gap, the loser sees the collision again
(`src/dispatch/CLAIM.md:51`).

## The bug this journey actually closed (Mike's review)

The delivering session's first cut had a hole that no test caught, because every
concurrency test **wrote `dispatched` before the claim** — the inverse of the
real order. The real `operate` order is `dispatch claim` → `worktree create` →
`journey record --status dispatched`. Between the claim and the record there is a
**window** with no `dispatched` row yet. The original `isLockActive` treated a
lock as live *only if* that row existed — so a just-created `pid 0` lock read as
an **orphan**, and the rival session overwrote it with no collision: **two
winners on one repo.** Reproduced in the real order, `pid 0`: **20/20 rounds with
two winners** (`docs/atomic-claim-completion-sdd.md:84`).

Signal 3, the 10-minute freshness grace, is the fix, and the reasoning behind it
is worth keeping. The alternative — have the claim write the `dispatched` marker
atomically — was rejected because every *loser* of the `link()` race would first
have written a phantom `dispatched` row (a ledger entry with no worktree),
whose cleanup needs a racy rollback on a file that is not atomic between
processes (`docs/atomic-claim-completion-sdd.md:100`). Instead the lock certifies
itself alive *at the instant of creation* for a bounded window, so the atomic
`link()` stays the single serialization point and the ledger write can follow it
without a race. Past the grace with still no `dispatched`, it is a true orphan
again — the bound is exactly what stops a crash-before-record from freezing the
repo forever.

## `--force` is a human decision on the record, not an agent shortcut

Overwriting a *live* lock requires `--force` **and** a PE authorization on the
ledger. `JourneyAuthorization` gained `forceClaim?: string` (the unit key);
`claimLock`, when forcing over a live lock, requires the claiming journey to hold
an authorization whose `forceClaim` equals that unit (or `"*"`), else it returns
`unauthorized-force` and does not touch the lock
(`docs/atomic-claim-completion-sdd.md:44`). `aipe dispatch authorize-force <repo>
--journey <id> --by PE` records the grant; a `claim` without it exits 3 with the
instruction to record one. Reconciling a *stale* lock needs no grant — that is
ordinary recovery, not an override.

Two neighbouring worktree bugs were finished in the same journey: `prune --force`
no longer deletes a live dispatch's worktree (the live-dispatch guard is now
**unconditional**, separated from the dirty-tree guard `--force` governs —
`docs/atomic-claim-completion-sdd.md:25`), and a test that *pinned the wrong
behavior* ("--force removes ACTIVE dispatches too") was flipped into the negative
case. The lock also never travels with a published workspace: `scaffold.ts`
re-ignores `/.aipe/locks/` in the workspace `.gitignore` allowlist, like
`toolchain.yaml` and `.rehydrate.lock` (`docs/atomic-claim-completion-sdd.md:67`).

## Adjacent commands

- **`aipe dispatch release <repo> [--journey <id>] [--package p] [--force]`** —
  releases the lock at the terminal milestones (`delivered`/`escalated`/`merged`).
  Idempotent; without `--force` it only releases a lock owned by the given
  journey (a foreign lock ⇒ `SKIP foreign`, non-zero).
- **`aipe journey reconcile [--journey <id>]`** — for each `delivered` dispatch
  with a PR, calls `gh pr view --json state` and flips it to `merged` when the PR
  merged. Pure core (`reconcileJourney`, injectable fetcher) so tests use a fake.

## How the race was proven closed, not argued

A "claim twice" proves nothing — a lucky interleaving passes. Two tests make luck
implausible **in the real order** (claim first, no `dispatched` written before):
5 in-process claimants over a repo with no prior dispatch, exactly 1 winner,
repeated 60 rounds; and 6 separate CLI processes (`bun cli.ts claim …`, `--pid
0`) contending on one lock file, exactly 1 `CLAIMED` (exit 0) and the rest
`COLLISION` (exit 2), 5 rounds — the `link()` atomicity at the OS level, not just
the event loop (`docs/atomic-claim-completion-sdd.md:56`). The window fix was
proven by reverting only the body of `isLockActive`: two winners → one.

## Left open (documented)

- Path-level granularity — two *devs* in one repo on disjoint files — was
  explicitly out of scope here and is the third link, [dossier 18](18-path-lock.md).
- `journey reconcile` as automatic polling (rather than a command the coordinator
  runs) was deferred (`docs/atomic-claim-completion-sdd.md:149`).
