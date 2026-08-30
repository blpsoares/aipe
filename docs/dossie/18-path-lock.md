# Dossier 18 — Path-lock (`aipe dispatch` — the lock descends from repo to path)

**Status:** Merged (`32c607a`, PR #32, 2026-08-28; journey `j-20260826-xj`).
**Spec:** [`src/dispatch/PATH-LOCK.md`](../../src/dispatch/PATH-LOCK.md).

> **Third and final link of the parallelism chain** —
> [16 atomic claim](16-atomic-claim.md) →
> [17 identity per task](17-identity-per-task.md) → **18 path-lock**. It extends
> both without rewriting either. See the [chain overview](README.md#the-parallelism-chain).

## The question this link answers

*The PE has a demand with ~10 sub-tasks in the **same repo**, safe to run in
parallel because they touch **disjoint files**. Two devs still serialize on the
whole-repo lock. How do two writers coexist in one repo when — and only when —
their paths do not overlap?*

[Dossier 16](16-atomic-claim.md) made the lock physical, and
[dossier 17](17-identity-per-task.md) let *non-writing* roles run N-at-once. Both
deliberately left the writing case locked at repo granularity: two devs in one
repo still serialize even on disjoint files. This link adds the missing faculty —
**reasoning by path inside the repo**, without losing serialization where it is
genuinely needed (the same file). It builds directly on the two primitives it
inherits: the atomic `link()` primitive, `isLockActive`, stale reconciliation and
the `--force` authorization gate from 16; and the `task`-aware lock key plus
`roleWritesToRepo` from 17. It **rewrites neither** (`src/dispatch/PATH-LOCK.md:4`).

## 1. The overlap engine (`paths.ts`, pure)

The core question is decidable: can two path specs match a file **in common**?
`pathsOverlap(a, b)` (`src/dispatch/paths.ts:122`) decides non-empty intersection,
segment by segment: `**` matches zero-or-more segments, `*` matches one segment,
intra-segment wildcards by a DP (`wildcardIntersect`). A spec with no wildcard in
its last segment is a **prefix** — it covers the subtree (`src/foo` matches
`src/foo` and everything under it — `normalizePath`/`splitSegments`,
`src/dispatch/paths.ts:25`). An empty set normalizes to `[WHOLE]` where `WHOLE =
"**"` (`src/dispatch/paths.ts:18`), which overlaps everything — that is exactly
the whole-repo lock of today, **preserved as the default**. `pathSetsOverlap`
(`src/dispatch/paths.ts:133`) lifts it to sets and `overlappingPairs`
(`src/dispatch/paths.ts:141`) reports **which** paths collided, so a rejection can
name the reason. The engine is conservative only where parsing is genuinely
ambiguous; disjoint coexists, a common file serializes.

## 2. The path-aware claim (`lock.ts`)

`claimLock` gains an optional `paths?`. Its absence keeps the **legacy branch**
intact — single file per `lockKey(repo, pkg, task)`, used by the non-writing
task-split of [dossier 17](17-identity-per-task.md) and every pre-path caller. Its
presence (even `[]` = WHOLE) takes the **path-aware branch**
(`src/dispatch/PATH-LOCK.md:32`):

- It first acquires a **per-unit mutex guard** (`.<repo[__pkg]>.guard`) via the
  same atomic `link()`, with spin/backoff plus stale reconciliation (dead pid or
  TTL) — the guard's `link(tmp, gp)` is at `src/dispatch/lock.ts:331`. This guard
  is what serializes the critical section **scan → decide → write *between
  processes***. Without it, two overlapping claims in separate processes would
  both read the unit empty and both write — the silent hole this journey closes.
- Under the guard it scans the unit's live locks (same repo+package, **ignoring
  task**), keeping only those that **write** (`writes: true` — a reviewer does not
  collide over a file). Overlap with a live foreign writer ⇒ `collision`, carrying
  the offending path pairs; `--force` still demands the recorded authorization
  inherited from 16.
- Identity stays **per task**: the file is `lockKey(repo, pkg, task).lock`
  (`src/dispatch/lock.ts:40`), so two disjoint sub-tasks get distinct files and
  are released per task, while overlap is judged unit-wide.

## 3. The path-aware law (`law.ts`)

`validateBatch` reasons by path **only when some member of the group declares
paths**; otherwise it adjudicates exactly as before and no existing verdict
changes (`src/dispatch/PATH-LOCK.md:52`). In the path-aware branch:
writer×writer with overlapping paths ⇒ `path-collision <unit>: A ⋂ B on <paths>`
(the message *names why*); a writer that is WHOLE / declares no paths overlaps
everything (same-unit serialization preserved by default); writers that coexist
need distinct `task`s. Non-writers keep the identity-per-task rule from
[dossier 17](17-identity-per-task.md). The `MAX_CONCURRENT = 16` cap is unchanged
(`src/dispatch/law.ts:26`).

## 4. Honest declaration = verifiable detection (`detect.ts`)

Declared paths **age** — the field evidence in the spec is a scope that grew from
2 files to 16, and a submodule touched by `bun install`
(`src/dispatch/PATH-LOCK.md:60`). AIPe is physical, so a declaration cannot be
trusted on its word. `aipe dispatch reconcile` reads what the branch **actually**
touched (`git diff base...HEAD` + `git status --porcelain`, both ends of a
rename) and rewrites the live lock's paths to that truth, under the same guard,
re-checking overlap on the **real** set (`reconcileLockPaths`,
`src/dispatch/detect.ts`). It reports `drift` (what the declaration did not cover)
and `DRIFT-COLLISION` (a lock that grew into another live claim).

## 5. Overlap is a managed exception, not a fatal error (`resolution.ts`)

The design's central stance: two writers wanting the same path is **not** an
error to reject — it is an exception to *manage*. `planOverlapResolution`
(`src/dispatch/resolution.ts:24`) returns a deterministic, testable four-step
plan (`src/dispatch/resolution.ts:21`):

1. **wait** — the second writer waits for the holder of the overlapping path.
2. **rebase** — it rebases onto the holder's branch once that lands.
3. **resolve** — the agent, holding both units' orientation, resolves by hand.
4. **review-over-merge** — the pre-approval quality review runs over the **merged**
   result — the net that catches both a bad textual merge *and* a semantic break
   that a clean merge can still cause.

The decision is recorded by the PE and documented for the operator in
`skills/operate/SKILL.md` (`aipe dispatch resolve-overlap` surfaces the plan).
This is the sentence the coordinator's brief singled out: with path-lock, the
same-repo overlap stops being a wall and becomes a rebase-plus-review workflow.

## Why this had to be link 3, not link 1

Path granularity is only meaningful on top of a lock that is already physical and
already task-addressed. The per-unit guard in §2 is itself an instance of the
atomic `link()` primitive from [dossier 16](16-atomic-claim.md); the per-task lock
file it scans is the identity from [dossier 17](17-identity-per-task.md); and the
"only writers collide" rule is `roleWritesToRepo` from 17 applied at path grain.
Attempted first, path-lock would have had no atomic floor to stand on and no way
to tell a reviewer's presence from a writer's. The order was forced by the
dependencies, not chosen for narrative.

## What has NOT fallen yet — deliberately

Path-lock lets two devs coexist in one repo, but the console still does **not**
visualize work at *sub-task* grain. The 4-column board of
[dossier 22](22-console-redesign.md) is a kanban of *dispatches*, not of the
sub-tasks a single dispatch may fan into; there is no sub-task tree in
`src/serve/`. "sub-task" today lives only in the **lock mechanics** here (disjoint
sub-tasks get distinct lock files, `src/dispatch/lock.ts`), not in any UI. That
visualization is held back on purpose — the physical layer had to be proven
before a view could be trusted to render it — and remains an open roadmap item
(see the [README roadmap](README.md#roadmap--verified-against-code)).

## How it was proven

RED-first per the plan (`src/dispatch/PATH-LOCK.md:78`): the overlap engine
exact on real cases; the path-aware lock with a **multi-process race** (overlapping
paths → exactly 1 winner; disjoint → all win) and the legacy branch left intact;
the law emitting `path-collision` naming the paths, and a no-paths group still
rejected `same-repo` for backward compatibility; detection with an injectable
runner, reconciliation, drift/overlap, and the exception plan.

## Left open (documented)

- Sub-task visualization in the console — deliberately blocked, above.
- The overlap workflow is planned and recorded, but the actual rebase/resolve is
  still executed by the agent under human oversight, not automated end-to-end.
