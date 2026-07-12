---
name: verify-before-done
description: Use inside a dispatched specialist (dev or QA) BEFORE returning any result that claims a unit of work is done — "delivered" from a dev, "passed" from a QA. It is the evidence gate: you may not report done until you have run the checks and can attach the command(s) + what the output showed to the journey ledger. Triggers on "it's done", "delivered", "tests pass", "it works", "ready for review".
---

# /verify-before-done

**Announce on entry:** "Using verify-before-done to prove this is done before claiming it."

You are a dispatched specialist about to tell the coordinator a unit is done. This
skill is the **gate between "I think it works" and "here is the proof it works."**
"Done" is not a feeling — it is **evidence**: a command you actually ran and the
output you actually saw. The AIPe ledger physically refuses a `delivered`/`verified`
record without that evidence attached, so this is not advisory — it is the only way
your delivery counts.

## When to use / when NOT

**Use it when:** you are about to return `{status:"delivered"}` (dev) or
`{status:"passed"|"verified"}` (QA) — anything that asserts the work is complete.

**Do NOT use it for:** an in-flight update, an escalation (`{status:"escalate"}`), or
a request for clarification. Those claim nothing is done, so there is nothing to
prove yet. This skill fires **only at the done-claim.**

## The evidence gate (MUST — non-negotiable)

You **MUST NOT** claim done without evidence. Concretely, before returning a
done-result you MUST have:

1. **Run the check** — the test suite, the build, the type-check, and (when the
   change has runtime behavior) **driven the actual feature**, not just the tests.
2. **Captured the proof** — the exact command(s) and a one-to-three-line summary of
   what the output showed (counts, the behavior observed, the error that is now
   gone). Green tests alone are not enough when the change has a runtime surface:
   the strongest evidence is the feature exercised end-to-end.
3. **Attached it** — handed that evidence back so the coordinator records it:
   ```bash
   aipe journey record --journey <id> --repo <repo> [--package <pkg>] \
     --specialist <you> --branch <branch> --worktree <path> --status delivered \
     --evidence-cmd "bun test" --evidence-cmd "drove checkout in the app" \
     --evidence-summary "42 pass / 0 fail; split payment shows the right totals"
   ```
   The ledger **REJECTs** `evidence-required` if the summary is empty or no command
   is attached. No evidence → not delivered.

### Table of non-exceptions (forbidden rationalizations)

Each thought below means **STOP — you are about to claim done without proof:**

| Rationalization | Ruling |
| --- | --- |
| "the change is obviously correct" | Run it anyway. Obvious-looking code is where silent bugs hide |
| "the tests pass, that's enough" | If it has runtime behavior, drive the feature too — tests can pass while the feature is broken |
| "I ran it earlier, before the last edit" | Evidence must post-date your LAST change. Re-run |
| "it compiles / type-checks" | Compiling ≠ working. That is not evidence of behavior |
| "the coordinator is waiting" | A fast wrong answer costs more. Prove it, then report |
| "I'll note it works in the summary" | A claim is not evidence. Attach the command + observed output |

## What counts as evidence (by claim)

- **Dev `delivered`:** for a testable change, the **RED→GREEN trace** is the
  preferred proof — a test that failed before your change and passes after (drive it
  with `/tdd`). Attach the test command + the before/after (e.g. "was 1 fail, now 12
  pass"). Add the feature driven in the real app when it has a runtime surface. For a
  non-testable change (visual/copy/config), the evidence is the feature exercised in
  the real app — still evidence, never a bare claim.
- **QA `verified`:** you (independently) exercised the change on the dev's branch —
  ran the tests AND drove the behavior — and are attaching **your own** commands +
  what you saw. A QA verdict repeating the dev's self-report is not a gate; it is an
  echo. (For the skeptic's discipline against the diff, see `/review-delivery`.)

## Common mistakes

- *Attaching "looks good" as the summary* → state the concrete observation (counts,
  the behavior, the gone error), not a verdict.
- *Evidence from before the last change* → re-run after your final edit; stale proof
  is no proof.
- *Only test output for a UI/behavior change* → also drive the feature; green tests
  can coexist with a broken feature.

## Self-review gate (before returning a done-result)

- [ ] I ran the check(s) **after my last edit** — not from memory.
- [ ] For a runtime change, I **drove the actual feature**, not only the tests.
- [ ] My summary states what the output **showed**, not that it "works".
- [ ] The evidence is attached to the ledger (`--evidence-cmd` + `--evidence-summary`)
      and the record returned `OK`, not `REJECT evidence-required`.
- [ ] If I could not produce evidence, I did **not** claim done — I returned the
      blocker or an escalation instead.
