---
name: state-the-limit
description: Use every time you report ANY result inside a dispatched specialist — a fix, a verification, a measurement, a count, a gate verdict — before you send that report. State what you did NOT establish in the SAME report, with the SAME prominence as the result itself. Triggers whenever you are about to write "verified", "confirmed", "N commits/items/failures", "passed", or any other confident claim.
---

# /state-the-limit

**Announce on entry:** "Using state-the-limit to attach what I didn't establish."

Short and surgical, on purpose. Every time you report a result, the boundary of that
result travels with it, in the same message, at the same weight — never a footnote,
never left for someone to discover later by re-checking your work.

## When to use / when NOT

**Use it when:** you are about to state a result to the coordinator or the ledger —
a fix works, a check passed, a count, a verdict. Pairs naturally with the end of
`/investigate` (gate 5's boundary) and with `/verify-before-done` (the evidence you
attach).

**Do NOT use it as:** a hedge on everything, all the time — a boundary you state on
a claim you never made is noise, not honesty. It fires on **results**, not on
in-progress updates or questions.

## The rule (MUST — non-negotiable)

You **MUST** state, in the same report as the result, what you did **NOT**
establish — with equal prominence, not buried or softened. Two real examples from
2026-08-30 are the standard to imitate:

> *"couldn't verify by an actual click in Chrome; the App-level test covers the
> consequence in the component tree"* — this let the coordinator weigh the gap
> instead of discovering it later.

> *"a real 320/390 viewport with deviceScaleFactor 3 is NOT a physical device"* —
> QA refused to let the measurement sound stronger than it was.

Both name **exactly** what was reached and **exactly** what wasn't. That precision is
the point — "might not be fully tested" is not a limit statement, it's a shrug.

### The hard rule on numbers

**Never state a number whose base you cannot name.** If you cannot say, concretely,
what a count was measured against (which repo, which tag, which point in time,
which baseline run), the number does not go in the report at all — not with a
caveat, not rounded, not "approximately." "156 commits ahead of v1.5.0" is not a
report if the tag lives in a different repository than the one you're counting.

### The anti-example (what a limit statement is NOT)

`ci-unresolvable (gh missing, unauthenticated, offline)` — four possible causes,
none named as the real one, printed in the same second the actual answer (`gh pr
checks` returning `Passed: 2`) was available. A limit statement says **what you
tried and what came back** — never a menu of maybes standing in for a "the real
cause was not this list."

## Table of non-exceptions

| Rationalization | Ruling |
| --- | --- |
| "the gap is small, not worth mentioning" | The reader can't judge "small" without knowing it exists. State it |
| "I'll mention the limit if someone asks" | Nobody knows to ask about a gap they don't know exists. State it up front |
| "a caveat makes the result look weaker" | A result that hides its boundary is not stronger, it is undisclosed risk. State it plainly |
| "I don't know exactly what the number was measured against, but it's close enough" | Then it doesn't go in the report. Find the base or drop the number |
| "listing possible causes covers me" | A menu of maybes is not a limit statement — find out which one is real, or say plainly you could not |

## Common mistakes

- *Softening the limit into hedge-words* ("might not fully cover...", "should be
  fine but...") → name the exact thing not established, not a vague qualifier.
- *Putting the limit last, in small text* → same prominence as the result, same
  paragraph or the line right after it.
- *A number with an implied base nobody stated* → name the base explicitly, or drop
  the number.
- *Confusing "I tried four things" with "here's the cause"* → a list of attempts is
  not a diagnosis; say which one is real or that none resolved it.

## Self-review gate (before you send the report)

- [ ] The report states what was **NOT** established, not just what was.
- [ ] The limit is in the **same message**, with the **same prominence** as the
      result — not a footnote.
- [ ] Every number in the report has a nameable base; any that doesn't was dropped.
- [ ] If I considered multiple possible causes, I named the one that is real — or
      said plainly none could be confirmed, not a menu of maybes.
