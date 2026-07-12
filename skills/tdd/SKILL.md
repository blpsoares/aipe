---
name: tdd
description: Use inside a dispatched dev specialist when the change is testable (logic, an API, a data transform, a bug fix) — write the failing test FIRST, watch it fail, then make it pass. It is AIPe's rigid RED→GREEN working method; its RED→GREEN trace is the preferred evidence the delivery gate wants. Triggers on "implement", "add", "fix the bug", "build the function/endpoint", any behavior you can assert.
---

# /tdd

**Announce on entry:** "Using tdd to drive this change RED→GREEN with a failing test first."

You are a dispatched dev. For any change you can assert, "working" is not a
feeling — it is **a test that failed, then passed because of your change.** TDD is
how AIPe manufactures that proof as a by-product of building: you never wonder
whether it works, because you watched the test go from red to green. The RED→GREEN
trace is also the strongest thing you can hand `/verify-before-done`.

## When to use / when NOT

**Use it when:** the change has assertable behavior — a function, an endpoint, a
reducer, a parser, a bug fix (a bug is a missing test). This is the default for code.

**Do NOT force it for:** pure visual/copy tweaks, config, or throwaway spikes — there
the evidence is the feature driven in the real app (still evidence, see
`/verify-before-done`), not a unit test. If you *can* write a fast test, prefer it.

## The RED→GREEN gate (MUST — non-negotiable)

You **MUST** write the test **before** the implementation and **watch it fail for the
right reason** before making it pass. The order is the point: a test written after
the code only proves the code does what it does, not what it should. Concretely:

1. **RED** — write one small failing test for the next behavior. Run it. Confirm it
   fails, and fails because the behavior is missing (not a typo/import error).
2. **GREEN** — write the *minimum* code to make it pass. Run it. Confirm green.
3. **Refactor** — clean up with the test still green.
4. **Repeat** one behavior at a time. Keep the suite green between steps.

### Table of non-exceptions (forbidden rationalizations)

Each thought below means **STOP — you are skipping RED:**

| Rationalization | Ruling |
| --- | --- |
| "I'll write the tests after, faster" | Test-after proves nothing about intent. Write RED first |
| "it's a trivial function" | Trivial functions carry the silent bugs. One RED test costs seconds |
| "I already know it works" | Then the test passes immediately — which means you skipped RED. Make it fail first |
| "the test is hard to write" | A hard-to-test change is a design smell — surface it, don't skip the test |
| "I'll just run it manually once" | Manual once ≠ a regression guard. Encode it as a test |

## Evidence this produces (feeds `/verify-before-done`)

When you claim `delivered`, your evidence is the **RED→GREEN trace**: the test
command and its result (e.g. `bun test path/to.test.ts` — "was 1 fail, now 12 pass").
For a runtime surface, add the feature driven in the real app. The ledger REJECTs a
delivery with no evidence — TDD is how you always have it.

## Common mistakes

- *Writing all the tests up front, then all the code* → one behavior at a time; RED
  then GREEN then repeat.
- *A test that passes on first run* → you skipped RED; you don't know it can fail.
  Break the code deliberately to confirm the test catches it, or rewrite the test.
- *Testing implementation details* → assert observable behavior, so a refactor keeps
  the test green.

## Self-review gate (before handing the delivery to QA)

- [ ] Each behavior started with a test that **failed for the right reason**.
- [ ] The suite is green now, and I ran it **after my last edit**.
- [ ] A bug fix added a test that **reproduces the bug** (red before, green after).
- [ ] My delivery evidence includes the RED→GREEN trace (command + before/after).
