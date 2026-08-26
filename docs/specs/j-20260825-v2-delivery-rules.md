# SDD — j-20260825-v2: three delivery rules, made physical in the CLI

> Journey `j-20260825-v2`, package `aipe`, specialist Jesse. Derived from the
> approved Orientation Spec. The through-line: *prose in a brief did not hold* —
> both specialists shipped against red CI with an evidence contract in prose. So
> each rule below is a thing the CLI **physically refuses** or **physically does**,
> proven RED→GREEN, not a paragraph anyone must remember.

## Rule 1 — the CI gate

**`aipe journey record`**, when the record carries `--pr` **and** status is
`delivered` or `verified`, resolves that PR's checks and rejects unless green.

Resolution yields one of **five** outcomes (three-outcomes-plus, deliberately not
two):

| verdict     | meaning                                   | gate            |
|-------------|-------------------------------------------|-----------------|
| `green`     | all checks passed                         | **accept**      |
| `red`       | ≥1 check failed/cancelled                  | REJECT `ci-red` |
| `pending`   | checks not finished (still running)       | REJECT `ci-pending` |
| `none`      | PR reports no checks configured           | REJECT `ci-none` — *unless* `--ci-none`, then **accept + record `ciBypass: no-checks`** |
| `unknown`   | gh absent / unauth / offline / unqueryable| REJECT `ci-unresolvable` (abstain loudly — never guess green) |

- "Still running" (`pending`) is distinct from failure and from acceptance: the
  specialist is told to **wait**.
- `--ci-none` is the **only** recorded bypass, and it is narrow: it upgrades a
  *resolved* `none` to accept and stamps the claim on the ledger. It never masks
  `red`/`pending` and never substitutes for a verdict the gate could not obtain
  (`unknown`) — an unrecorded bypass is worse than none, and a flag that could
  hide red CI would defeat the whole gate.
- **Network reality:** resolution lives behind an injected `PrChecksResolver`
  (mirrors `ghPrState` for reconcile). The pure gate takes the resolver; the CLI
  wires the real `gh pr checks --json bucket,state`. When no resolver is injected
  (unit tests of the *other* gates) the CI gate is inert — it never silently
  fabricates a pass.

**`aipe journey verify`** audits the same thing. For a `delivered`/`verified`
unit (top status; `merged` is terminal and reconcile's domain) with a `--pr` and
no recorded `ciBypass`, it re-resolves live and emits a **critical** finding on
`red`/`pending`. `none`/`unknown` **abstain** (no finding) so a no-checks repo
never becomes a false critical; a recorded `ciBypass` is skipped (deliberate).
This is what catches a *legacy* red-CI record (the PR #22 class) that predates the
record gate, without regressing existing journeys.

## Rule 2 — session lifecycle

When `record` **accepts** a transition to `verified` or `merged` on a
**session-mode** unit, every session-mode `sessionId` recorded for that unit is
closed, and the CLI prints `CLOSED session <id> …`. A fix loop opens a **new**
session — sessions are never reused across rejections.

**Containment (the trap):** closing fires when the QA records `verified`, i.e.
one specialist's `record` closes another specialist's session. This is done by
the **CLI spawning `agentop session kill` internally** — the coordinator's
instrument — which never passes through `guard.decide()` (the guard only inspects
commands the *agent* issues). `guard.ts` is **not touched**; a specialist typing
`agentop session kill` is still denied, exactly as before. Both hold, so no
escalation.

Closing is **idempotent & non-fatal**: the ledger write happens **first**; a dead
session, an absent `agentop`, or a non-session unit all produce a `NOTE` line, not
an error, and never block or lose the record.

## Rule 3 — session label

`sessionLabel` at `src/session/cli.ts` changes from `${fqid}@${specialist}` to the
PE's **specialist-first** format `<Specialist>-<task>-<project>`:

- **Specialist** — the persona, case preserved (`Jesse`), hyphen-safed.
- **task** — the **journey id** (the real, stable identifier of the demand in
  AIPe's model; a journey *is* one task). Nothing shorter is both real and
  unambiguous.
- **project** — the fqid leaf: the package (`aipe-site`) or, for an implicit
  package, the repo (`aipe`).

e.g. `Jesse-j-20260825-v2-aipe`, `Mike-j-20260825-v2-aipe` — unambiguous between
two specialists on the same package. The agentop **task grouping** `aipe/<journey>`
is unchanged.

## Acceptance evidence

RED→GREEN for each rule incl. negative paths (red rejected, pending≠failure,
no-checks only via `--ci-none`, verify flags green-ledger/red-CI, session closed
once on verified & merged, specialist still denied `kill`, dead-session close
non-fatal, label asserted); `bun test` green; `tsc` silent, no `any`; the gate
proven against this delivery's **own** live PR; `verify` re-run on the workspace's
journeys does not regress; `build:host` carries all three.
