# The chain of parallelism

Three commits, in strict order, turned "one specialist at a time" into "many
specialists, never over the same file." They are not three loose features — each
depends on the one before it, and reading them out of order makes none of them
make sense. The `concurrency-model` diagram draws the whole chain; this is the
argument behind it.

## Why an order at all

The coordinator dispatches work it does not perform, into worktrees it does not
watch, run by sessions it cannot see the terminals of. Concurrency in that setting
cannot rest on etiquette. Each link below closes a gap the previous one opened:
making the law physical exposed that the *unit* of the law was too coarse; making
the unit finer exposed that a declared unit **drifts** from the real one.

## Link 1 — the law became physics (`f351801`)

The dispatch law used to be prose a coordinator was asked to honour. Two
coordinators — or one coordinator whose context had been compacted and no longer
remembered the first dispatch — could both believe they held a repo. The fix was
to stop asking. A claim is now an **atomic filesystem operation**: a temp file is
hard-linked onto the lock path, and `link()` fails `EEXIST` if the path already
exists (`src/dispatch/lock.ts:248`). `link` is atomic, so the winner's lock is
always fully written — there is no empty-file window a rival could slip into. The
loser sees `EEXIST` and, crucially, does **not** retry blindly
(`src/dispatch/lock.ts:256`).

Making the lock physical raised a question etiquette never had to answer: what
happens when the holder dies? A lock file outlives the process that wrote it. The
system refuses to *assume* death — it **decides** it, from four ordered signals
(`src/dispatch/lock.ts:148`):

1. a **provably dead pid** (`kill(pid, 0)` → `ESRCH`) is the only positive proof
   of death, and the only thing that lets a rival reclaim the lock;
2. a **live ledger entry** (a `dispatched`/`redirected` row) is durable proof of
   life even if the pid is unknowable;
3. a **freshly-created lock** gets a grace window, to close the gap between
   claiming and recording;
4. an **unverifiable owner** (`pid ≤ 0`) is treated as **alive** — never silently
   reclaimed, because a silent orphan-reclaim over a living unit is exactly the
   double-write the lock exists to stop.

Only when a lock is provably orphaned is it unlinked and the atomic create
retried (`src/dispatch/lock.ts:283`). And overriding a *live* lock is never an
agent's shortcut: `--force` over a living claim is refused unless the journey
carries a PE-recorded authorization for that unit
(`src/dispatch/lock.ts:269`) — a human decision, on the record.

## Link 2 — the unit became `Persona · task` (`f203fc6`)

A physical lock keyed on the repo serialized *everything* in that repo, including
work that never conflicts. A QA reviewer touches no files; two reviewers, or a
reviewer and a writer, have no reason to wait on each other. So the addressable
unit gained a **task** axis. The lock key now folds repo, package and task
together (`src/dispatch/lock.ts:40`), so one persona claiming two distinct tasks
on one unit produces two independent lock files.

The rule that decides who may run alongside whom is derived from **behaviour, not
identity**: `roleWritesToRepo` returns false only for the non-writing roles, and
an unknown role defaults to *writes* — fail safe (`src/dispatch/roles.ts:21`). The
law then admits N non-writing dispatches on one unit as long as each carries a
distinct task, and the instant any member writes, the duplicates serialize
(`src/dispatch/law.ts:124`). This is why the rule survives a new persona name
being added: it never consulted a list of names.

## Link 3 — the lock descended to the path (`32c607a`)

Two writers in one repo still serialized, even when they were nowhere near each
other's files. The final link drops the granularity from the repo to the **path**:
two writers coexist if and only if their declared path sets are disjoint; overlap
serializes (`src/dispatch/lock.ts:455`). An empty set means the whole unit and
overlaps everything, so a writer that declares nothing still behaves like the old
repo lock — backward compatible by construction. The scan → decide → write over
the overlap set is itself serialized across processes by a per-unit guard built on
the same atomic `link` primitive (`src/dispatch/lock.ts:348`), so the check and
the claim cannot interleave.

The walkthrough shows this exact transition live: the same batch returns
`OK batch=2` with disjoint paths and `REJECT same-repo aipe` without them.

## The non-obvious problem: declared paths age

Path-granularity introduced a failure that repo-granularity could not have: a
path set **declared at dispatch time drifts from reality**. This is not
hypothetical — it is field evidence, recorded in the code that fixes it
(`src/dispatch/detect.ts:2`): one dev's scope grew from **2 to 16 files**
mid-task for a legitimate reason; another's `bun install` nudged submodule
pointers he never meant to touch. A lock frozen at the declaration would either
block work that grew into empty space, or — worse — let a writer drift into a
file another writer holds, and never notice.

So the lock is **reconciled against what the branch actually moved**, read from
git, not against the declaration. `detectTouchedPaths` unions the committed diff
(`base...HEAD`) with the uncommitted working tree (`status --porcelain`), records
both endpoints of a rename, and degrades to "the working tree" rather than
throwing when a git call fails (`src/dispatch/detect.ts:26`). The reconciler then
rewrites the live lock to the real set and **re-checks overlap on it**
(`src/dispatch/lock.ts:516`): drift that grows into another live claim's path
surfaces as a collision instead of a silent double-write. Reconciliation of a
provably-stale lock needs no PE grant — it is ordinary recovery, distinct from the
authorized `--force` over a living one.

## When paths do collide

Overlap is **serialization-with-recovery, not a hard error**.
`planOverlapResolution` yields an ordered plan — wait → rebase → resolve →
review-over-merge (`src/dispatch/resolution.ts:24`). This branch is real code with
real tests, but **it was not observed racing** in the recorded scenario: every
concurrent same-repo pair there was disjoint. Treat this section as read from the
code, not from a run — the honest boundary the walkthrough draws applies here too.

---

**What breaks if you touch this.** The four liveness signals are ordered on
purpose; reordering them (for instance, letting a fresh lock be reclaimed before
the grace window) reintroduces the double-write. The writes/doesn't-write
predicate defaulting to *writes* is the fail-safe; flipping it would let an
unknown role run concurrently by accident. And the reconciler is what keeps
declared paths honest — without it, path-granularity is a promise that ages into a
lie. See `docs/dossie/16-atomic-claim.md`, `17-identity-per-task.md` and
`18-path-lock.md` for the build-time record of each link.
