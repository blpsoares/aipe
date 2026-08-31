---
name: investigate
description: Use whenever you are about to fix a bug or a symptom and have not yet nailed down WHY it happens — BEFORE you write or apply a fix. Establishes causation before remedy, in five gated steps: reproduce, name the mechanism, rule out the easy explanation, prove the contrafactual, verify the consequence (not just the mechanism). Triggers on "fix this", "this is broken", "why is X happening", "investigate", any bug/symptom report — anywhere between observing a symptom and choosing a fix.
---

# /investigate

**Announce on entry:** "Using investigate to establish the cause before touching the fix."

You are about to fix something. This skill is the discipline AIPe was missing: `/tdd`
proves a fix once you have one; `/verify-before-done` proves a delivery once it's
made. Neither one asks whether you actually found the cause. This skill lives in that
gap — between observing a symptom and picking a fix.

**The one rule that summarizes half of what goes wrong without this skill:**
> **An exit code is not proof of effect.** Neither is a green test that never watched
> the bug happen, a count with no named baseline, or a percentage read off a UI
> control instead of the thing it controls. All four killed real deliveries on
> 2026-08-30. A fix built on any of them is a guess wearing the clothes of a diagnosis.

## When to use / when NOT

**Use it when:** you have a symptom (a bug report, a failing behavior, a confusing
number, a "this should work but doesn't") and you do not yet know, in one sentence
naming a specific line/function/event, why it happens.

**Do NOT use it for:** a change with no symptom to explain (new feature, refactor,
a spec you're implementing fresh) — there is nothing to diagnose. Once gate 2 below
is genuinely satisfied — you can name the mechanism and have already ruled out the
obvious alternative — move straight to `/tdd` for the fix itself; this skill's job is
done at that point, not a ritual to repeat step-by-step forever.

## The five gates, in order (MUST — each blocks the next)

Each gate below is a checkable condition. You may not act on gate *N* until gate
*N-1* is satisfied — not "probably satisfied," satisfied with something you could
show someone. Skipping a gate is not a shortcut; it is where today's twelve defects
were born.

### Gate 1 — Reproduce, and name the environment

Make the symptom happen **in front of you**, not just in the report. If it only
reproduces in ONE place (one browser, one OS, one script vs. the real binary, one
repo but not another) — that scope is not a footnote, it **is a fact about the
defect**, and it belongs in your diagnosis, not as an afterthought once the fix is
already written.

*Proof:* you can state where you reproduced it and, if you tried elsewhere and it
did NOT reproduce there, say so explicitly.

### Gate 2 — Name the mechanism

State the cause as **a specific line, function, or event** — not a category of
explanation. "Deve ser cache," "it's probably a race," "something about state" are
not mechanisms; they are guesses with confident punctuation.

A real mechanism reads like this (the actual one found on 2026-08-30): *"clicking an
anchor fires `popstate`, which `LocationProvider` processes OUTSIDE the router; it
recomputes the route from `location.pathname` and ignores the hash."* That names the
event, the component, and the exact wrong computation. It is also worth noticing that
an EARLIER, equally confident-sounding mechanism from the same day — *"the
`hashchange` guard skips `navigate()`"* — was real but **incomplete**, and the gap
only surfaced once someone drove a real browser (gate 5). Naming a mechanism does not
retire this skill; it unlocks the next gate.

*Proof:* you can point at the file:line, the function name, or the event name — not
a phenomenon description.

### Gate 3 — Rule out the easy explanation, explicitly

Name the obvious hypothesis a capable engineer reaches for first, and say **how you
checked it's not that**. Not "I don't think it's X" — the check itself: "NOT the
FitAddon (it doesn't exist in this codebase — grepped for it)," "NOT too many lines
(doesn't enter the width computation — read the layout code)." This is the step that
separates a diagnosis from a plausible-sounding guess; skip it and you cannot tell
the two apart yourself, let alone show anyone else.

*Proof:* a named alternative + the concrete check that ruled it out, in the same
sentence.

### Gate 4 — Prove the contrafactual

Before you call the mechanism established: **revert your fix (or don't apply it
yet) and show the test failing for the reason gate 2 names.** A test that passes
identically with and without the fix tested nothing — it is decoration, not evidence.
This is the step most tempting to skip because it feels like doing the work twice; it
is actually the only step that tells you whether gates 2–3 were right.

*Proof:* the same test, run twice — RED against the unfixed code (failing for the
named reason, not a typo/import error), GREEN against the fixed code.

### Gate 5 — Verify the CONSEQUENCE, not just the mechanism

If the mechanism lives in code (a function, an event handler), that is not the same
thing as the user-visible consequence (what renders in a browser, what a person
sees). `happy-dom` proved this the hard way on 2026-08-30: it does not dispatch
`popstate` at all, so a component-level test can go green while the real browser
still shows the bug. If your verification only reaches the mechanism — and reaching
the consequence would need a real browser, a real device, a real network — you
**MUST NOT** let the green mechanism-level test stand in for consequence-level proof.
Either drive the actual consequence (a real browser, `claude-in-chrome`, the compiled
binary), or **declare the boundary** explicitly — hand off to `/state-the-limit`
rather than letting silence read as "verified end-to-end."

*Proof:* either a consequence-level trace (what a person would actually see, driven
for real), or an explicit boundary statement naming exactly what was NOT reached.

## Table of non-exceptions (forbidden rationalizations)

Each thought below means **STOP — you are about to fix a symptom you have not
diagnosed:**

| Rationalization | Ruling |
| --- | --- |
| "the fix is obvious from the symptom" | Obvious fixes are how the same redirect got "fixed" twice on the symptom before anyone found gate 2's real mechanism. Name it first |
| "the exit code was 0 / the command succeeded" | An exit code is not proof of effect (see the rule at the top). Name what it actually proves, not what it's convenient to assume |
| "the test passes, that's the mechanism confirmed" | A test that passes on the FIXED code alone proves nothing — go back to gate 4 and watch it fail first |
| "this obviously isn't [some other cause], no need to check" | That is exactly the sentence that skips gate 3. Write down the check, don't just feel it |
| "I can't easily test the real browser/device/network, so the unit test is good enough" | Then you are at gate 5's boundary — declare it, don't quietly let the unit test stand in for the consequence |
| "the coordinator/PE is waiting, I'll diagnose after I ship a fix" | A fix without a diagnosis is a guess that happens to compile. A wrong fast fix costs more than a slower right one |

## Common mistakes (named, from 2026-08-30's own catalog)

- *Treating `exit 0` as "the process ended cleanly"* → agentop's own `session kill`
  can exit 0 against an id that matches no session. Exit code proves the command
  ran, not that the thing you wanted to happen, happened.
- *Using `git merge-base --is-ancestor` as proof of publication* → a squash-merged
  branch is never an ancestor of the target after the squash. It answers a question
  you didn't ask.
- *Reading the control instead of the effect* → a "100%" zoom readout that only
  reflects a multiplier, while the actual rendered font auto-shrank to ~9.6px, is a
  measurement of the wrong variable. Measure the thing the user experiences.
- *Counting across two different bases silently* → "156 commits ahead of v1.5.0" is
  meaningless once you learn the tag lives in a different repo than the one being
  measured. If you can't name what a number was measured against, it doesn't go in
  the report (see `/state-the-limit`).
- *A menu of possible causes instead of the real one* → `ci-unresolvable (gh
  missing, unauthenticated, offline)` printed in the same second `gh pr checks`
  answered fine. Naming four maybes is not naming the cause; find out which one
  actually happened, or say you could not (see `/state-the-limit`).
- *A green test that exercises the mechanism you fixed, not the consequence a user
  hits* → the `hashchange`-only test stayed green while `popstate` (what the browser
  actually fires) went untested. Assert the consequence, not the code path.

## Self-review gate (before you touch the fix)

- [ ] I reproduced the symptom myself, and stated where (and where it did NOT
      reproduce, if I tried elsewhere).
- [ ] I can name the mechanism as a specific line/function/event — not a category.
- [ ] I named the obvious alternative explanation and stated the concrete check that
      ruled it out.
- [ ] I reverted the fix (or withheld it) and watched a test fail for the named
      reason, then watched the same test pass with the fix applied.
- [ ] I verified the actual consequence a person would see — or I explicitly
      declared, with `/state-the-limit`, that I could only reach the mechanism.
- [ ] Nothing in my diagnosis rests on an exit code, a merge-base check, a UI
      readout, or a cross-base count I cannot defend as proof of the actual claim.
