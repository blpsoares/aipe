# Verifiable truth: an exit code is not proof of effect

The weak version of this principle is a slogan: *the system refuses to assert what
it cannot prove.* The strong version is the one worth writing down, because it is
built from the system's own failures — real defects where AIPe **asserted too
much**, each a distinct way a program can mistake a signal for the thing the
signal was supposed to mean. The gates elsewhere in this repo exist because these
happened.

There are four forms. They are distinguishable, and they fail differently.

| Form | Symptom |
|---|---|
| **Asserts without establishing** | a comfortable answer that was never verified |
| **Silence read as success** | absence of a signal looks like absence of a problem |
| **Mention mistaken for use** | describing the mechanism triggers the mechanism |
| **Ambiguous zero** | "nothing found" and "nothing searched" produce the same output |

## Form 1 — asserts without establishing (fixed)

The rule "don't ship against red CI, and don't call work done without proof" used
to live as *prose in a brief* — so a coordinator could record `delivered` as a
bare self-report and ship red or unproven CI. The comment on the fix says so in
its own words: *"Prose in a brief did not hold … this makes green CI part of what
the ledger physically accepts"* (`src/journey/ledger.ts:350`). The cure was to
move the assertion out of prose and into a gate: evidence is required for a
done-claim (`src/journey/ledger.ts:296`), and a named PR must resolve green
(`src/journey/ledger.ts:357`). **Fixed** — the ledger now refuses what a brief
could only ask for.

## Form 2 — silence read as success (fixed, and defended)

The sharpest case: the release bump commit carries the skip-CI token and is pushed
with the Actions token, so no workflow runs on it — and `main`'s ruleset requires
a `check` status that therefore never appears. The promotion PR sat with an
**empty check list**, and *an empty list reads as "nothing to report", not
"nothing ran"* (`.github/workflows/release.yml:196`). That silence masqueraded as
two releases. The fix has the bump job re-run the real gate and post the `check`
status itself, its state derived from the gate outcome — a failed gate posts a red
check and fails loud, never an empty list (`RELEASING.md:52`). **Fixed.**

The same shape is defended elsewhere: a bare fallback to an empty state list would
be "vacuously landed" — `[].every(...)` is `true` for any predicate on an empty
array — turning an infrastructure hiccup into a false all-clear
(`src/session/cli.ts:682`). The collector classifies that as `unknown`, not
clean.

## Form 3 — mention mistaken for use (open)

The release version is computed by grepping conventional-commit tokens out of raw
commit **bodies**: `grep -q "BREAKING CHANGE"` over every commit message in the
range (`.github/workflows/release.yml:130`). The grep cannot tell a real footer
from prose that merely *mentions* the phrase — a commit documenting the release
rules would trip a wrongful **major** bump. The skip-CI token is the same hazard:
writing the literal token into any commit subject, even to document it, makes the
platform skip every workflow, and the deliberate use is indistinguishable from an
accidental mention. This is why this very document, and `CONTRIBUTING.md`, take
care never to place those tokens on a line where the tooling would read them as
instructions. **Open** — the parse discriminates neither footer-vs-mention nor
use-vs-mention. It is in `findings.md`.

## Form 4 — ambiguous zero (open)

`detectTouchedPaths` returns `[]` both when a branch genuinely touched nothing and
when git could not be read at all (both commands failed) — "nothing found" and
"nothing searched" collapse to the same value, and the consumer reports a clean
reconcile either way (`src/dispatch/detect.ts:34`). The same repository does the
*opposite*, correctly, one module over: the CI classifier is five-valued so an
empty check array (`none`) is distinct from an unqueryable forge (`unknown`), and
the two are treated differently (`src/journey/checks.ts:12`). The anti-pattern and
its cure live side by side. **Open** for path detection; the cure exists for CI.

## The counterpoint: where it refused to lie

The forms above are failures. The system's spine is the opposite reflex, and it is
worth naming because it is the reason `verified` means anything:

- the ledger refuses a delivery with no evidence, and refuses to waive CI without a
  recorded, signed `--ci-none` (`src/journey/ledger.ts:296`, `:381`);
- `aipe session collect` reports a live session as *"progress not independently
  verified"* rather than assuming it landed (`src/session/cli.ts:771`);
- a `merged` unit is immutable and never re-recorded (`src/journey/types.ts:48`);
- `CHANGELOG.md` refuses to be a changelog — it says a hand-maintained one would go
  stale immediately, and points to the generated Releases page instead.

Each is the system declining a comfortable assertion it could not stand behind.

## The coordinator is a fallible node

The forms above are mechanical; this last one is human, and it belongs at the end
because it only carries weight once the mechanical failures have been seen. The
coordinator is not an oracle — it is a source of error the system must survive. It
survived, in the recorded scenario, because the specialists it dispatched **stop
and ask** instead of obeying: the first-class `{status: "needs-clarification"}`
return, and a `blocked` ledger state whose whole value is the reason it carries,
exist precisely so a specialist can refuse to guess. That is a claim about where
authority lives — not with whoever spoke last, but with whoever can prove the
thing.

The companion event is small and exact. During QA on one delivery, the reviewer
found a defect, **fixed it, and opened a fresh PR** with the fix — which was then
**closed, not merged**, with the note recorded in the ledger: *"the QA opened a PR
redoing a subset of this change; it was closed — QA does not fix what it reviews,
and the original already contained everything."* Good diagnosis, wrong vehicle: had
that PR merged, no one would have reviewed the fix. The gate is only a gate if the
gatekeeper does not also hold the pen. That distinction — reviewing versus
authoring — is the same one that keeps the coordinator from editing the repos it
coordinates.
