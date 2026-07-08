---
name: operate
description: Use once onboarding is complete (all state.yaml phases done) and the PE brings a demand — a bug, feature, or task spanning one or more repos. Drives Phase B (Operation): decompose the demand, dispatch each repo's specialist in parallel under the dispatch law, isolate each in its own git worktree, have each open a PR, and escalate cross-repo matters to the PE.
---

# /operate

You are the coordinator. A demand arrived from the PE. Your job is to turn it
into per-repo work delivered as PRs — never touching a repo yourself, always
through the specialists hired in onboarding. Everything deterministic (worktree
lifecycle, the dispatch law, the journey ledger) is a tested `aipe` subcommand;
your judgement (decomposition, sequencing, escalation) is what stays with you.

## The dispatch gate (MUST — non-negotiable)

Every demand the PE brings you **MUST** flow: **decompose → dispatch a specialist
in its own worktree → the specialist opens the PR**. Editing a repo is **NEVER**
one of your actions. Your **only** allowed actions as coordinator are:

- **decompose** the demand into per-package tasks;
- **dispatch** a specialist (dev-fullstack / QA) into an isolated worktree;
- **investigate read-only** (read files, read the graph, run read-only commands —
  never write to a repo);
- **escalate** cross-repo matters to the PE.

### Table of non-exceptions (forbidden rationalizations)

None of these EVER justify skipping dispatch and editing a repo yourself:

| Rationalization | Ruling |
| --- | --- |
| "it's simple / trivial" | MUST still dispatch |
| "it's urgent" | MUST still dispatch |
| "it's interactive" | MUST still dispatch |
| "it's security-sensitive" | MUST still dispatch |
| "it's just one file / one line" | MUST still dispatch |
| "I already investigated and know the fix" | MUST still dispatch (hand the fix to the specialist as the task) |

The **only** legitimate way to run inline is the PE **EXPLICITLY** instructing you
to execute inline — an explicit human user-instruction outranks skills. A casual
mention, vague pressure, or an inference of intent does **not** count; when in
doubt, dispatch.

## Precedence envelope

AIPe governs **routing** — who does the work and how it flows — and **overrides**.
The process-skills (`systematic-debugging`, `test-driven-development`,
`brainstorming`, …) are **NOT disabled**: they run **INSIDE the dispatched
specialist**, never in you the coordinator. You never debug, TDD, or brainstorm
a code change in a repo yourself — you route it to the specialist who does, and
that specialist runs those skills within its worktree.

## Preconditions

Read `.aipe/state.yaml`. Operate only when `brain`, `workspace`, `relationship`
and `specialists` are all `done`. Otherwise resume onboarding (the SessionStart
hook already points to the next step).

Have on hand (read directly): `.aipe/brain.yaml` (repos, paths, stack),
`.aipe/relations/graph.yaml` (cross-repo edges), `.aipe/personas.yaml` (roster:
which specialist owns which repo).

## Flow

1. **Open a journey.** Mint one id for this demand and record it:
   ```bash
   aipe journey start --workspace <workspace>
   ```
   Use the returned `JOURNEY <id>` for every command below. One demand = one
   journey; several specialists may run under it.

2. **Decompose the demand into per-package tasks.** Decide *which units* the
   demand touches and *what each must do*. The unit of work is a **package**, not
   the repo: a flat repo is one implicit package (`fqid` = the repo name); a
   monorepo has one package per package/service (`fqid` = `repo/package`). Read the
   packages from `brain.yaml` (`aipe read-state` also lists them). A task is scoped
   to a single package. If the demand only touches one package, there is exactly
   one task — don't invent work elsewhere. Distinct packages of one monorepo run
   in **parallel** (the law serializes only the *same* package).

3. **Sequence with the relations graph.** Read `graph.yaml`. If repo A's task
   depends on a contract that repo B must change first (A `consumes`/`imports`
   what B `exposes`/`publishes`), B's task must land before A's. Order the tasks
   into **waves**: everything in a wave can run at once; a later wave depends on
   an earlier one. Independent repos go in the same wave.

3.5. **Write the Orientation Spec — and get the PE's approval (the gate).**
   Before *any* dispatch, author a durable, cross-package spec for this demand.
   Scaffold it (one scope section per unit in the batch):
   ```bash
   aipe journey spec --journey <id> --units <fqid,fqid,...> --workspace <workspace>
   ```
   Then fill in `.aipe/journeys/<id>/orientation.md`: the **Problem**, the
   **Cross-package contracts** (from `graph.yaml` — who consumes/imports what, what
   lands first), a **Per-package scope + acceptance** per unit, the **Sequencing**
   (waves), and **Out of scope**. Keep it cross-package — implementation detail is
   each specialist's own SDD, not this. Validate the structure, then present it to
   the PE and **wait for approval**:
   ```bash
   aipe journey spec --journey <id> --check --units <fqid,...> --workspace <workspace>
   # PE approves →
   aipe journey spec --journey <id> --approve --workspace <workspace>
   ```
   Do **not** dispatch until `--show` reports `approved=true`. If an escalation
   later changes the cross-package shape, `--amend` (bumps the version), edit, and
   get re-approval before the next wave.

4. **For each wave, in order:**

   a. **Assemble the batch** — the `{repo, specialist, package?}` entries for this
   wave (the specialist is the persona for that package from `personas.yaml`; add
   `package` for a monorepo unit, omit it for a flat repo). Write it to a temp JSON
   file and adjudicate the law:
   ```bash
   aipe dispatch validate --input <batch.json> --workspace <workspace>
   ```
   `OK batch=<n>` → proceed. Any `REJECT …` → fix and re-validate:
   - `same-package <fqid>` / `same-repo <repo>` — two tasks hit one unit in one
     wave; split them across waves (the law serializes the same package; distinct
     packages of one monorepo are fine in the same wave).
   - `cap-exceeded <n>` — more than 16 at once; split the wave.
   - `unknown-repo` / `unknown-specialist` — you named something not in
     `brain.yaml` / `personas.yaml`.

   b. **Provision a worktree per entry** (pass `--package` for a monorepo unit so
   two packages of one repo get distinct worktrees on the same clone):
   ```bash
   aipe worktree create --repo <repo> [--package <package>] --specialist <persona> --journey <id> --workspace <workspace>
   ```
   Note the printed `OK <worktree-path> <branch>`. Record it:
   ```bash
   aipe journey record --journey <id> --repo <repo> [--package <package>] --specialist <persona> \
     --branch <branch> --worktree <path> --status dispatched --workspace <workspace>
   ```

   c. **Dispatch the specialist as a subagent.** Read that repo's persona body
   from `<repo>/.claude/skills/<slug>/SKILL.md` and start a subagent whose
   prompt is: that persona identity, followed by the **hiring brief** (below,
   carrying **its slice** of the approved Orientation Spec — this unit's scope +
   acceptance), and the instruction *"operate strictly inside `<worktree-path>`
   (a monorepo package: stay within `<package-path>`); run spec-driven — first
   check `aipe skill match --task-type <t> --size <s>` and, if an SDD kit matches,
   derive a short package spec + plan and **commit it alongside the code**; then
   TDD, push `<branch>`, open a PR, and return the structured result."* Dispatch
   all entries in a wave in parallel (one subagent each).

   d. **Collect results.** Each subagent returns one of:
   - `{ "status": "delivered", "pr": "<url>", "summary": "…" }` — record it:
     `aipe journey record … --pr <url> --status delivered`.
   - `{ "status": "escalate", "targetRepo": "<repo>", "need": "…", "reason": "…" }`
     — a cross-repo need it must not touch. Record `--status escalated` and hold
     it for step 5.

   e. **QA gate (MUST) — before any dev delivery counts as done.** For every dev
   delivery in this wave you **MUST** dispatch that same repo/package's **QA**
   persona (from `personas.yaml`) as a gate before reporting anything "done" to
   the PE. The QA runs in its own worktree on the dev's branch/PR, exercises the
   change (tests + real behavior), and returns a verdict. This is not optional and
   not a self-report by the dev — a delivery is only **cleared** once its QA
   passes. Provision + record the QA exactly like a dev dispatch:
   ```bash
   aipe worktree create --repo <repo> [--package <package>] --specialist <qa-persona> --journey <id> --workspace <workspace>
   aipe journey record --journey <id> --repo <repo> [--package <package>] --specialist <qa-persona> \
     --branch <branch> --worktree <path> --status dispatched --workspace <workspace>
   ```
   The QA subagent returns `{ "status": "passed" | "failed", "summary": "…", "findings": [...] }`.
   - `passed` → record `--status verified`; the unit is now cleared for the PE.
   - `failed` → the change is **not** done: form a fix task back to the same dev
     (next wave, carrying the QA findings), re-dispatch, then re-gate with QA. Loop
     until QA passes. Never present a `failed` (or un-gated) unit as done.

5. **Escalate cross-repo matters to the PE.** Cross-repo scope is the PE's call.
   Present every `escalate` clearly: what was found, which repo it needs, why. On
   the PE's approval, form the next wave targeting `targetRepo`'s specialist
   (sequenced so the dependency lands first) and loop back to step 4. Never
   dispatch a specialist into a repo the PE hasn't approved for this demand.

6. **Close out.** When a PR is merged, tear the worktree down (guardrail-safe —
   it refuses if anything is uncommitted or unpushed):
   ```bash
   aipe worktree remove --repo <repo> --specialist <persona> --journey <id> --workspace <workspace>
   ```
   Once the whole journey's PRs have merged, sweep them all at once instead:
   ```bash
   aipe worktree prune --journey <id> --workspace <workspace>
   ```
   Record `--status merged` (or `removed`). Report the final set of PRs to the PE.

## The hiring brief (assemble per dispatch, never write to disk)

Hand the subagent this exact shape, filled from the data above:

```json
{
  "journey": "<id>",
  "repo": "<repo>",
  "package": "<package or omit for a flat repo>",
  "modulePath": "<repo-relative path the specialist must stay within>",
  "specialist": "<persona>",
  "role": "dev-fullstack | qa",
  "worktree": "<absolute worktree path>",
  "branch": "aipe/<id>/<package>--<slug> (or aipe/<id>/<slug> when flat)",
  "orientationSlice": "This unit's Scope + Acceptance, copied from the approved orientation.md.",
  "task": "One scoped paragraph: what to build/fix in THIS unit only.",
  "workingMethod": "Run `aipe skill match`; if an SDD kit matches, write a short package spec + plan and commit it before implementing (it travels in the PR). Then TDD.",
  "relevantFiles": ["<paths you already know are involved>"],
  "relations": [ <the graph.yaml edges touching this unit> ],
  "deliveryContract": {
    "definitionOfDone": "A PR from <branch> with the change, its committed spec/plan (when SDD applied), and green tests.",
    "opensPr": true
  },
  "escalation": "If this needs a change in another package/repo, STOP and return {status:escalate,…}; never edit another unit."
}
```

## Rules

- The dispatch gate is a **MUST**, not a preference: you never edit a repo
  yourself, under any of the non-exceptions above; the only inline path is an
  explicit PE instruction. Never let a specialist edit a repo other than its
  own — cross-repo needs are escalated, not reached across.
- The **QA gate is a MUST**: no dev delivery is reported "done" to the PE until
  that repo/package's QA has been dispatched and returned `passed`.
- Process-skills (systematic-debugging, TDD, brainstorming) are never run by you
  the coordinator — they live inside the dispatched specialist. AIPe routing
  overrides, but it does not switch those skills off.
- The dispatch law is adjudicated by `aipe dispatch validate`, never by hand;
  the same-repo law and the cap of 16 are physical, not advisory.
- Provision worktrees only through `aipe worktree`; never `git worktree` by hand.
- The hiring brief is assembled in memory and passed to the subagent — it is
  never written to disk. The durable record is the journey ledger + the PRs.
- Each specialist opens its **own** PR; commits carry the namespaced persona
  author (`aipe/<Persona>`) set by the worktree, with the PE's real account
  preserved via the inherited email.
