# Findings: where docs and code disagree

This is the audit trail for this documentation unit: every place the code
contradicts a written claim, with the line on **both** sides so a reader can check
it. Nothing here is fixed by this unit — the known divergences are known, not
tasks. Verified against the tree at the time of writing; each was re-checked in
code, not taken from the brief.

## Fixed since the brief was written

**Branch protection on `main` — the `CONTRIBUTING.md` claim is now correct.** The
orientation flagged two defects here: that `CONTRIBUTING.md` called `main`'s
protection *PENDING*, and that it described a bypass for the release bump commit
that does not exist. Journey `j-20260830-98` (PR #49) landed first and fixed both.
The current text correctly states protection is **active** and describes **no**
bypass — the release flow works *with* the ruleset by never writing to `main`
(`CONTRIBUTING.md:77`), consistent with `RELEASING.md:138`. **No finding remains
here.** Recorded so the audit shows it was checked, not skipped.

## Still divergent (known)

**1 — TTY consent the SDD promises and the code does not have.** The autonomous-
upgrade SDD says the non-current workspaces are reached by `--migrate-all` *"ou
consentimento quando há TTY"* (`docs/upgrade-autonomo-sdd.md:96`). The code has no
such branch: `migrationTargets` routes on `--migrate-all` or the current workspace
alone, with no `isTTY` check and no prompt anywhere in the file
(`src/update/apply.ts:255`). The dossier already records this divergence and its
escalation (`docs/dossie/21-autonomous-upgrade.md:83`). **Still divergent.**

**2 — `columnOf` maps `unknown → working`, against §11.3 of the console SDD.** The
console redesign SDD is normative that an unreadable liveness (`unknown`) *"nunca
vira 'trabalhando' nem 'morto'"* (`docs/serve-console-redesign-sdd.md:406`). The
board code falls through to `"working"` for `unknown`
(`src/serve/app/runtime/board.ts:78`), locked in by a test asserting exactly that
(`src/serve/app/__tests__/board.test.ts:82`). The card is separately flagged as
unverifiable, but the *column* assignment contradicts the SDD's "never." **Still
divergent.**

## New findings from this audit

**3 — `aipe status config` strips comments from `brain.yaml`.** The write path is a
plain `stringify(brain)` (`src/status/config.ts:69`) of an object obtained by
`parse(raw)` (`src/make-workspace/read.ts:47`). A `parse → object → stringify`
round-trip through the `yaml` package preserves key **order** (as the file's own
header claims) but discards **every comment** — comments survive only through the
Document API, which this path does not use. So each `aipe status config
--auto/--format` write silently drops any comments the PE put in `brain.yaml`.
**Finding.**

**4 — Cost-index multiplier for the gated tier looks under-priced.** The
`frontier` tier is the authorization-gated one (`src/execution/policy.ts:8`), yet
its cost-index multiplier is `6` — only 1.5× the `reasoning` tier's `4`
(`src/execution/cost.ts:20`), while `ultracode` intensity multiplies by 8. The
index is explicitly a coarse relative proxy, not currency, so this may be
intentional; but a gated tier priced barely above an ungated one is at least worth
a second look. **Observation / possible finding.**

## Reserved as designed — do not read meaning into it

**The `ambiente` (environment) card field is not a code field at all.** It does
not exist anywhere in `src/serve/` — it was the contemplated 8th card field,
**explicitly discarded** for its journey by the coordinator because it is not in
the ledger and its semantics are ambiguous, deferred to a future journey if the PE
defines it (`docs/serve-atividade-kanban-sdd.md:157`). So: not a declared-but-
unused field, but a discarded/deferred one. Infer no semantics from the name.

## Observations (not divergences)

**`SECURITY.md` holds up for an agent-executing system.** It is not boilerplate: it
frames the real threat surface — autonomous agents in worktrees with the
developer's credentials and a shell (`SECURITY.md:3`) — and documents the
containment hooks, the eligibility rule, and PE-only kill authority. Two residual
risks are asserted but not independently provable from the doc: the guard's
robustness rests on matching a dangerous token sequence *wherever it appears*
(string-match, not shell-parse), and network egress / data exfiltration by a
*governed-but-malicious* agent is left implicit under the trusted-PE model rather
than named. Observation, not a defect.

**The ledger's `failed-open` lint is a retention trade-off, not a bug.** `aipe
journey verify` flags a `failed` row that was never re-opened under its own key
(`walkthrough.md` shows it on `j-20260829-dp`). This is correct behaviour reading
what is on disk: the ledger keeps only the latest state per `(repo, package,
task)` key, so a fix that lands under a *new* task id leaves the old `failed` row
un-reopened. The lint is honest; the retention policy is the thing to know.

## Cross-reference

Two "asserts too much" defects are documented at length in `verifiable-truth.md`
and are **open**: the release version parse mistaking a commit-body *mention* of a
breaking-change footer or the skip-CI token for its *use*
(`.github/workflows/release.yml:130`), and `detectTouchedPaths` returning an
**ambiguous zero** — `[]` for both "nothing touched" and "git unreadable"
(`src/dispatch/detect.ts:34`). Both belong in this ledger of findings too.
