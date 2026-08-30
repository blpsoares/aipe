# The ledger: states, immutability, and the evidence gate

The journey ledger is the durable, human-inspectable record of what a coordinator
dispatched for one demand — bookkeeping and audit, **not** the hiring brief (the
brief is never persisted). It is the deterministic spine the whole system leans
on: if the coordinator's context is compacted and its memory drifts, the ledger
is what survives. The `ledger-state-machine` diagram draws the states; this is
why the transitions between them are enforced rather than trusted.

## The states

A unit within a journey moves through a small set of statuses
(`src/journey/types.ts:19`):

- `dispatched` → `delivered` → `verified` → `merged` — the happy path.
- `delivered` → `failed` → re-dispatched — a QA rejection (the fix loop).
- `dispatched` → `escalated` — a cross-repo scope decision the PE owns.
- `dispatched` → `blocked` — the specialist is stuck and needs the coordinator.
- `* → redirected` — the PE changed the unit's direction live.
- `* → removed` — the worktree was torn down.

Two of these carry meaning worth stating outright. `verified` is a dev delivery
that **passed its QA gate** — the only "cleared for the PE" non-merged state
(`src/journey/types.ts:12`). `blocked` is distinct from `escalated`: escalated is
a scope question the PE must answer; blocked is an answer the coordinator itself
can give, surfaced so it can be discovered without reading a terminal
(`src/journey/types.ts:14`).

## The gate: a coordinator that physically cannot lie

Recording a status is not a plain write. The coordinator goes through
`recordDispatchGuarded` (`src/journey/ledger.ts:284`), which refuses any write that
would break an invariant. Five refusals matter:

1. **Verify-before-done.** A `delivered`/`verified` write must carry evidence —
   at least one command and a non-empty summary of what its output showed. No
   self-report without proof (`src/journey/ledger.ts:296`). The walkthrough shows
   the `REJECT evidence-required` this produces.
2. **Immutability.** A unit already `merged` is final and is never re-recorded
   (`src/journey/ledger.ts:309`; the invariant is declared at
   `src/journey/types.ts:48`). Redoing merged work is the most expensive mistake
   a compacted coordinator can make, so the ledger removes the possibility.
3. **No silent re-dispatch.** Moving a `delivered`/`verified` unit back to
   `dispatched` — a fix loop or a deliberate redo — requires a `--reason`, so
   reopening finished work is always audited (`src/journey/ledger.ts:318`). The
   guard keys on the unit, not the specialist, so a fix can swap who does it.
4. **No reasonless redirect.** A `redirected` record's whole value is *what the
   PE asked for*; a redirect with no reason is refused
   (`src/journey/ledger.ts:331`), because the coordinator must reconcile the
   Orientation Spec against it or the approved spec silently drifts from what is
   being built.
5. **No reasonless block.** A `blocked` record with no reason is worthless — its
   point is to tell the coordinator what to answer — so it is refused the same way
   (`src/journey/ledger.ts:341`).

When work is reopened, the sticky `sessionId` is explicitly cleared
(`src/journey/ledger.ts:410`): without this the re-dispatch would silently no-op,
because the pending filter only picks up a session unit that is `dispatched` and
carries **no** sessionId. See the `rework-loop` diagram.

## The CI gate is five-way, never two

A done-claim that names a PR must have a **green** workflow — prose in a brief
("don't ship against red CI") did not hold, so green CI became part of what the
ledger physically accepts (`src/journey/ledger.ts:357`). The verdict is
five-valued, never a boolean (`src/journey/checks.ts:12`):

- `green` records; `red` is refused.
- `pending` (still running) is **refused, not read as passed** — "still running"
  is not "passed."
- `none` (the PR genuinely reports no checks) requires an explicit, recorded
  `--ci-none` to waive — CI is never bypassed silently, and the waiver lands on
  the ledger for audit.
- `unknown` (the forge could not be queried — `gh` missing, offline, unauthed)
  **abstains** rather than guessing green. A gate that guesses green is worse than
  one that abstains loudly.

The classifier that turns a `gh pr checks` result into one of the five is a pure
function (`src/journey/checks.ts:26`), unit-tested directly, with the process
spawn the only untested boundary.

## The reliability lint

The gate protects each *write*; a separate audit reads the *whole* ledger.
`aipe journey verify` (`src/journey/verify.ts`) prints a `FINDING` per broken
invariant — a done-claim with no evidence, a `failed` unit never re-dispatched, a
consumer shipped before its producer landed, a merge that skipped QA, an open
escalation — plus a `STATE … clean=<bool> … critical=<n>` footer, and exits
non-zero if any finding is critical. The coordinator must not report a demand
done while `critical > 0`.

This audit is honest about the ledger's own retention policy. The ledger keeps
only the **latest state per `(repo, package, task)` key**, so a fix that lands
under a *new* task id leaves the old `failed` row un-reopened — and the linter
flags it, correctly, as `failed-open`. The walkthrough shows exactly this on
journey `j-20260829-dp`. The lint is not wrong; it is reading what is on disk. If
you rely on the ledger as an audit trail, this is the trade-off to know: latest
state is durable, intermediate history under a reused key is not.

---

**What breaks if you touch this.** The evidence and CI gates are the reason a
`verified` row means anything; loosening either turns the ledger back into a
notebook of claims. The five-way CI verdict exists so that `pending` and `unknown`
cannot masquerade as green — collapse it to a boolean and the gate starts guessing.
And the reason-required transitions (`redispatch`, `redirect`, `blocked`) are what
keep the approved spec honest about what is actually being built. Foundational
prior art: `docs/dossie/07-phase-b-operation.md` and `15-session-dispatch.md`.
