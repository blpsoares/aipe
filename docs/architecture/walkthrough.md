# Walkthrough: one demand, end to end

This is the trace a contributor reads to see the machine actually run — not a
tour of the code, but the real path a demand takes from dispatch to a published
release, with the command that made each decision and the line of code that
adjudicated it.

**Honesty boundary (read this first).** Everything shown as a fenced command
block below was **run against the live workspace on 2026-08-30** and its output
is pasted verbatim, not paraphrased. The workspace ledger lives in `.aipe/`,
which is *not* part of this repository — it is workspace state and lives outside
the repo — so the output is transcribed here rather than linked. Where a step
was **not** exercised in the recorded scenario, the text says so explicitly and
falls back to reading the code and its tests. A partial trace that is honest
about its boundary is worth more than a complete one that invents.

The scenario ran on **2026-08-29 and 2026-08-30**. It is a real set of journeys,
not a staged demo.

---

## 1. Two specialists, one repo, disjoint paths

The law that governs concurrency is not "one specialist per repo" — it is "no
two writers over the same file." Two dev-fullstack units were dispatched into
`aipe` at once: one on `src/serve/` (the Atividade board, PR #39) and one on
`src/journey/` (honest session-close, PR #42), **the same persona on two tasks**.
`aipe dispatch validate` adjudicates the batch deterministically, with no model
in the loop:

```
$ aipe dispatch validate --input batch-paths.json --workspace <ws>
OK batch=2
```

`batch-paths.json` declared disjoint paths (`["src/serve"]` and
`["src/journey"]`). The overlap scan that admits them lives in
`src/dispatch/lock.ts:455` — it ignores non-writing locks and serializes only
writers whose declared path sets actually intersect. Strip the paths, and the
two units become whole-unit claims that overlap everything:

```
$ aipe dispatch validate --input batch-nopaths.json --workspace <ws>
REJECT same-repo aipe
```

That `REJECT same-repo aipe` is the pre-path-lock behaviour: before the lock
descended from repo-granularity to path-granularity (commit `32c607a`), the
second unit in `aipe` was refused outright. The rule that decides writer-vs-
writer is `src/dispatch/law.ts:124` (`anyWrites` ⇒ serialize); the granularity
that lets disjoint writers coexist is `src/dispatch/lock.ts:455`. See the
`concurrency-model` diagram for the full chain.

## 2. A different repo, a monorepo package

Cross-repo, the addressable unit is not the repo but the **package**. Journey
`j-20260829-cd` dispatched into `agentistics/web` — a package unit of a monorepo,
whose fully-qualified id is `repo/package`:

```
$ aipe journey show --journey j-20260829-cd --workspace <ws>
DISPATCH agentistics/web Jane merged aipe/j-20260829-cd/web--jane__ui-terminal-sessoes https://github.com/blpsoares/agentistics/pull/250 [MERGED — immutable]
DISPATCH agentistics/web Donald verified aipe/j-20260829-cd/web--donald__gate-pr250 https://github.com/blpsoares/agentistics/pull/250 +evidence [VERIFIED — cleared]
STATE journey=j-20260829-cd dispatches=2 open=0 done=2
```

The `agentistics/web` prefix on every row is the `fqid` in action: the lock key
folds repo, package and task together (`src/dispatch/lock.ts:40`), so a task on
`agentistics/web` never contends with one on a sibling package. `[MERGED —
immutable]` is the ledger asserting the dev row is final; `[VERIFIED — cleared]`
is the QA gate's verdict on the same PR.

## 3. The rework loop — the most-travelled path

A delivery is not done because the dev says so; it is done because an independent
QA persona verified it. Journey `j-20260829-dp` (PR #39) shows the loop:

```
$ aipe journey show --journey j-20260829-dp --workspace <ws>
DISPATCH aipe Jesse merged aipe/j-20260829-dp/jesse__atividade-kanban https://github.com/blpsoares/aipe/pull/39 [MERGED — immutable]
DISPATCH aipe Mike failed aipe/j-20260829-dp/mike__gate-pr39 - +evidence
DISPATCH aipe Mike verified aipe/j-20260829-dp/mike https://github.com/blpsoares/aipe/pull/39 +evidence [VERIFIED — cleared]
STATE journey=j-20260829-dp dispatches=3 open=1 done=2
```

The middle row — `Mike failed … gate-pr39 … +evidence` — is a QA rejection that
carried its proof. The rejection was substantive: the QA found that the delivery
had the *right logic on the wrong execution path* — a `gh pr view` call on the
render hot path, re-run every ~3s per SSE client, which would burn the GitHub API
quota. The dev fixed it, and the `verified` row is the passing re-gate over the
corrected commit. QA recorded its verdict under its **own** `--task`; without a
distinct task the CLI refuses the write, because it would collide with the dev's
row (`src/journey/ledger.ts:280`, the per-task identity filter).

**Where the trace stops being complete — and this is on the record.** The
orientation describes PR #39 as rejected *three* times. The ledger keeps only the
**latest state per `(repo, package, task)` key**, and the intermediate rounds
reused the `gate-pr39` task id, so they were overwritten in place. Only two gate
rows survive on disk: the first `failed` and the final `verified` (task id
`gate-pr39` → the surviving `verified` used a fresh key). The rejection substance
of the overwritten rounds lives on inside the surviving evidence summaries, not
as separate rows. The `failed` row you see is real; the count of three is not
independently reconstructable from the ledger alone, and this document does not
pretend otherwise.

That retention shows up honestly in the reliability lint — the `failed` row was
never formally re-opened under its own key (the fix landed under a new task id),
so the linter flags an open failure:

```
$ aipe journey verify --journey j-20260829-dp --workspace <ws>
FINDING CRITICAL failed-open aipe — QA failed and the unit was not re-dispatched
FINDING WARNING merged-skipped-qa aipe — merged without a verified QA record
STATE journey=j-20260829-dp clean=false findings=2 critical=1
```

The lint is not wrong — it is reading exactly what is on disk. It is the
deterministic audit the coordinator runs before reporting a demand done
(`src/journey/verify.ts`), and it refuses to call a journey clean while a
`failed` row sits un-reopened. The real fix arrived under a different task id, so
the invariant the linter enforces (a rejection must be reopened under the *same*
key) reads as violated. This is the cost of latest-per-key retention, stated
plainly rather than hidden.

## 4. A clean pass, for contrast

Not every unit loops. Journey `j-20260829-rq` (PR #41) delivered and passed QA on
the first try — there is no `failed` row anywhere in it:

```
$ aipe journey show --journey j-20260829-rq --workspace <ws>
DISPATCH aipe jesse merged aipe/j-20260829-rq/jesse https://github.com/blpsoares/aipe/pull/41 [MERGED — immutable]
DISPATCH aipe Mike verified aipe/j-20260829-rq/mike https://github.com/blpsoares/aipe/pull/41 +evidence [VERIFIED — cleared]
STATE journey=j-20260829-rq dispatches=2 open=0 done=2
```

delivered → verified → merged, with the QA row carrying evidence. This is the
happy path the state machine draws; §3 is what the system spends most of its time
doing.

## 5. The evidence gate refuses a bare self-report

The reason a `verified` row can be trusted is that the ledger physically refuses
a done-claim without proof. This is deterministic and reproducible — here it is
run against a throwaway workspace so nothing lands on the real ledger:

```
$ aipe journey record --journey <id> --workspace <tmp> \
    --repo demo --task t --specialist Dev --branch b --worktree <tmp>/w \
    --status delivered
REJECT evidence-required demo — status "delivered" requires evidence — attach the command(s) run and a summary of what the output showed (never a bare self-report).

$ aipe journey record … --status delivered \
    --evidence-cmd "bun test" --evidence-summary "42 pass/0 fail" --ci-none
OK demo Dev delivered
```

The gate is `src/journey/ledger.ts:296` (`EVIDENCE_REQUIRED_STATUSES`). The
`--ci-none` on the accepted call is itself a recorded, deliberate waiver — the CI
gate refuses a done-claim that names a PR unless the workflow is green, and the
only way past a genuine "no checks configured" is an explicit `--ci-none` that
lands on the ledger for audit (`src/journey/ledger.ts:357` onward, the five-way
verdict in `src/journey/checks.ts:12`).

## 6. Merge is not production — the two steps beyond the ledger

The ledger's vocabulary ends at `merged`, but a change is not shipped there.
`merged` means the target branch — `dev` — and nothing more
(`skills/operate/SKILL.md:709`). Two steps live beyond it, and **neither is
journey-tracked**: the promotion of `dev` into `main`, and the release cut from
that merge.

In the recorded scenario the promotions went out as PRs #43 and #47
(`release: promove dev para main …`), merged on 2026-08-30. Searching every
ledger, neither appears as a dispatch row — promotion PRs carry no `j-` id and
are the coordinator's own gated action, never a specialist's
(`skills/operate/SKILL.md:732`). The release *tooling* itself was built as
ordinary journeys (`j-20260829-oj`, `j-20260830-98`), which is how the
"`merged` ≠ production" distinction and the branch-protection account came to be
written down.

**This step is read from code and docs, not from a run.** I did not cut a
release. The mechanics — the bump job that stamps the version on `dev` and posts
its own `check` status, the release job that tags the merge commit and publishes
in one API call so an orphan tag is impossible — are documented in
`RELEASING.md` and drawn in the `merge-to-production` diagram, and the workflow
tests in `scripts/__tests__/release-workflow.test.ts` sustain them. The account
here is faithful to those sources; it is not a transcript of a release I watched.

## 7. What was not exercised

Two branches the diagrams describe were **not** observed racing in this scenario,
and are documented from code and tests alone:

- **The managed overlap exception.** No two concurrent units had *overlapping*
  paths in the recorded run — every same-repo pair was disjoint. The
  wait → rebase → resolve → review-over-merge recovery
  (`src/dispatch/resolution.ts:24`) is real code with real tests, but this
  document has no live collision to show for it.
- **A live redirect.** No unit was redirected through `agentop session attach`
  in the traced journeys. The `redirected` state and its reason-required gate
  (`src/journey/ledger.ts:331`) are exercised only in the unit tests here.

Naming these gaps is the point. The rest of the trace is real.
