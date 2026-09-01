---
name: operate
description: Use once onboarding is complete (all state.yaml phases done) and the PE brings a demand — a bug, feature, or task spanning one or more repos. Drives Phase B (Operation): decompose the demand, dispatch each repo's specialist in parallel under the dispatch law, isolate each in its own git worktree, have each open a PR, and escalate cross-repo matters to the PE.
---

# /operate

**Announce on entry:** "Using operate to turn this demand into dispatched PRs."

You are the coordinator. A demand arrived from the PE. Your job is to turn it
into per-repo work delivered as PRs — never touching a repo yourself, always
through the specialists hired in onboarding. Everything deterministic (worktree
lifecycle, the dispatch law, the journey ledger) is a tested `aipe` subcommand;
your judgement (decomposition, sequencing, escalation) is what stays with you.

## When to use / when NOT

**Use it when:** onboarding is complete (all `state.yaml` phases `done`) and the PE
brings a demand — a bug, feature, or task spanning one or more repos.

**Do NOT use it when:** onboarding is unfinished (resume onboarding instead — the
SessionStart hook points to the next step); or the PE is only asking a read-only
question about the context (answer directly, no journey). This skill is for **work
that changes repos**, and that work **always** flows through dispatch — never inline.

## The dispatch gate (MUST — non-negotiable)

Every demand the PE brings you **MUST** flow: **decompose → dispatch a specialist
in its own worktree → the specialist opens the PR**. Editing a repo is **NEVER**
one of your actions. Your **only** allowed actions as coordinator are:

- **decompose** the demand into per-package tasks;
- **dispatch** a specialist (dev-fullstack / QA) into an isolated worktree;
- **investigate read-only** (read files, read the graph, run read-only commands —
  never write to a repo);
- **escalate** cross-repo matters to the PE.

**Opening sessions is yours alone.** A dispatched specialist is forbidden from
opening an agentop session — a containment hook denies it, and the persona is
told so up front. If a specialist genuinely needs sub-work, it asks you; you
either do it, dispatch it as its own unit, or issue an explicit quota with
`aipe session grant --journey <id> --session-id <id> --count <n>`. A
specialist that could spawn specialists is an unbounded token fork-bomb with no
ledger entry for any of it.

**A grant cannot take effect yet.** `aipe session grant` writes the quota, but
consuming it requires `AGENTOP_SESSION_ID` in the specialist's own environment
— agentop does not stamp that yet (a known, recorded agentop-side follow-up).
The CLI issues the grant and says so plainly; do not read a successful `OK` as
"the specialist is now authorised" — it isn't, until agentop ships that.

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

## The PE's direct line to a specialist

Every session-mode dispatch is named `<fqid>/<persona-slug>` (`<fqid>` is the
repo, or `repo/package` for a monorepo unit) and filed under the task
`aipe/<journey>`, and its `sessionId` is recorded in the ledger. The PE can
therefore open a live conversation with any specialist at any time:

```bash
agentop session list          # what is running, and what each has spent
agentop session attach <id>   # talk to that specialist directly
```

This is the PE's channel, not yours — you neither need permission to be told
about it nor authority to prevent it. What you **MUST** do is reconcile: any
unit that comes back `REDIRECTED` from `aipe session collect` had its
direction changed outside your brief, and the spec is now stale until you
fold the change into the Orientation Spec (bump its version) or escalate it
to the PE. A redirected unit must not pass the QA gate against a spec that no
longer describes what it does.

**You still never open a session you did not dispatch, and you never kill
one.** Killing is always the PE's call — the same rule that governs a
`RUNNING` unit still alive past its `collect` timeout.

## Precedence envelope

AIPe governs **routing** — who does the work and how it flows — and **overrides**.
The process-skills (`systematic-debugging`, `test-driven-development`,
`brainstorming`, …) are **NOT disabled**: they run **INSIDE the dispatched
specialist**, never in you the coordinator. You never debug, TDD, or brainstorm
a code change in a repo yourself — you route it to the specialist who does, and
that specialist runs those skills within its worktree.

## Status reports for the PE (never hand-assemble one)

`aipe status` is the deterministic, tested renderer of who is doing what, in
which repo, at what status — plus what is waiting on the PE. When the PE wants to
know the state, you run it and render its output; you **NEVER** hand-assemble a
status table from `session list`/the ledger by eye. A hand-built table is exactly
where the coordinator got it wrong before (told the PE a PR did not exist when it
did, called a live specialist finished): the tested CLI removes that class of
error. Your judgement is *when* to show it; the *data* is the CLI's.

- **Pull — the PE asks (ALWAYS works, regardless of any saved preference).** When
  the PE signals confusion about what is running, or asks for the state — *"status"*,
  *"quero o status atual das tarefas"*, *"o que está rodando?"* — run `aipe status`
  and render it into the chat. For the chat, prefer `aipe status --json` and format
  it as a markdown table (do not re-derive anything), or paste the aligned table
  directly.
- **Format override wins for that one reply (does not touch the brain).** *"status
  completo"* → add `--detailed`; *"status compacto"* → add `--compact`. The flag
  overrides the saved preference for this render only (item 10, inv. 3).
- **Push — after each change (only when the preference says so).** The saved
  `statusUpdates.auto` preference (in the brain; surfaced to you in the SessionStart
  awareness as `STATUS UPDATES: auto-push is ON/OFF`) is the switch. When it is
  **ON**, after each `aipe session dispatch` and each `aipe journey record` that
  changes state, render `aipe status` (in the saved format) into the chat so the PE
  can follow along. When it is **OFF**, do not auto-push — but the pull above still
  works. Changing the preference: `aipe status config --auto <true|false> --format
  <detailed|compact>` (never edit the brain YAML by hand).
- **Scope.** Default is short (open work + recently closed) — paste-safe. Use
  `--journey <id>` for one demand, `--all` only when the PE wants the full history.
  If the output says rows were elided, tell the PE the count — never imply the short
  list is everything.

## Preconditions

Read `.aipe/state.yaml`. Operate only when `brain`, `workspace`, `relationship`
and `specialists` are all `done`. Otherwise resume onboarding (the SessionStart
hook already points to the next step).

Have on hand (read directly): `.aipe/brain.yaml` (repos, paths, stack),
`.aipe/relations/graph.yaml` (cross-repo edges), `.aipe/personas.yaml` (roster:
which specialist owns which repo).

## Flow (follow the graph, not ambiguous prose)

```dot
digraph operate {
  rankdir=LR;
  demand -> journey -> decompose -> sequence -> spec;
  spec -> dispatch [label="PE approves (approved=true)"];
  spec -> spec [label="not approved → wait/amend"];
  dispatch -> dev -> qa;
  qa -> pe [label="passed → verified"];
  qa -> dev [label="failed → fix task, re-gate"];
  dev -> escalate [label="cross-repo need"];
  escalate -> pe [label="PE decides scope"];
  pe -> close [label="PRs merged into dev"];
  close -> promote [label="verified work on dev"];
  promote -> pe [label="offer: promote now, or exercise on dev first?"];
}
```

0. **Read the ledger first (MUST — before any dispatch).** If this demand already
   has a journey (you are resuming, or a new session/coordinator picked it up), read
   it before doing anything:
   ```bash
   aipe journey show --journey <id> --workspace <workspace>
   ```
   Units marked `[MERGED — immutable]` or `[VERIFIED — cleared]` are **done** — never
   re-dispatch them. The ledger, not your memory, is the source of truth (your context
   may have been compacted). The CLI enforces this: it **REJECTs** a re-dispatch of a
   merged unit, and requires `--reason` to reopen a delivered/verified one.

   **Table of non-exceptions (forbidden rationalizations for re-dispatching done work):**

   | Rationalization | Ruling |
   | --- | --- |
   | "I don't remember doing this one" | Read the ledger — if it's `verified`/`merged`, it's done |
   | "it's probably stale, redo it to be safe" | Redoing merged work is the most expensive mistake. Trust the ledger |
   | "the session reset, start fresh" | The ledger survived the reset. Resume from it, don't restart |

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

   **Session mode binds the model per WAVE, not per unit** — `agentop` treats
   `--model` as a batch-level flag, and `aipe session dispatch` refuses a wave
   whose units disagree. So units wanting different models must go in different
   waves. `aipe execution plan --journey <id>` (step 3.5 below explains its
   sibling `propose`) groups the *chosen* envelopes into waves and tells you
   when that split costs an extra wave; if one wave matters more than the finer
   model choice, subagent mode binds the model per unit and does not force the
   split. That trade is the PE's — surface it in the spec rather than deciding
   it silently.

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
   each specialist's own SDD, not this.

   **Per-unit dispatch envelope (the PE approves this too).**

   **The envelope gate (MUST — run `propose`, never choose from memory).** You
   **MUST** run `aipe execution propose` for this journey and pick each unit's
   envelope from the list it prints — **NEVER** write an envelope from memory or
   habit, because that is the exact failure this discipline exists to end: with
   no priced list of alternatives in front of you, `reasoning` becomes the
   comfortable default and the whole journey drifts to "always Opus" — every unit
   defensible alone, the sum indefensible. **Proof the gate held:** `propose` was
   run for this journey and each unit's written envelope is a line **from its
   output**. Before writing this section, run:

   ```bash
   aipe execution propose --journey <id> --workspace <workspace>
   ```

   It refuses outright if this machine has no capabilities record —
   `ERROR capabilities: no record — run aipe capabilities probe then aipe
   capabilities confirm`. Run those first; a probe is a claim with a date, not
   a fact (a binary on `PATH` is not an authenticated binary, which is what
   `confirm` is for). Once there is a record, `propose` prints, per unit, the
   envelopes actually viable **on this machine**, each with a `cost-index` and
   marked `GATED` where policy requires the PE's signature. It **enumerates
   and prices; it does not choose.** Choosing is yours.

   **Skipping `propose` is a violation, not a shortcut — the excuses, ruled out.
   Every thought on the left means STOP: you are about to drift the tier.**

   | The coordinator thinks… | Ruling |
   | --- | --- |
   | "I already know this unit needs `reasoning` — no need to run `propose`" | That certainty IS the drift. MUST run `propose` and choose from the priced list, not from habit |
   | "the last journey used `reasoning` here, reuse it" | Each unit is priced fresh. A prior choice is not this unit's evidence |
   | "the PE is waiting — skip the list, write the envelope" | A fast wrong envelope is exactly what produced "always Opus". MUST price before you choose |
   | "every unit obviously wants the same tier" | Then reading the list costs nothing — and if it does not, you just caught a needless upgrade. Run it |

   For each unit, write the envelope you chose **and why**, plus the
   alternatives you discarded. The reasoning is not decoration — without it
   the PE can only accept or reject blind, which is the situation this exists
   to end. Write it like this:

   > `session / gemini / fast / normal` — session because the unit touches 40
   > files and a shared context would starve it; gemini because this is the QA
   > and the dev ran on claude-code; fast because this is a mechanical rename,
   > not design. Discarded ultracode: there is no solution space to explore
   > here.

   **`cost-index` is a coarse relative index, never money.** The cheapest
   envelope — subagent, `fast` tier, normal intensity — is 1. Never present it
   as currency and never convert it: AIPe does not know the PE's token price,
   plan, or rate limits.

   **The gated line.** An envelope `propose` prints marked `GATED` needs the
   PE's explicit approval before you record it; below that line you record
   your choice and proceed. This is what keeps the PE from approving thirty
   obvious envelopes to reach the one that mattered.

   **If `propose` fails**, it names the constraint that bit — no capabilities
   record, no containable harness on this machine, everything above the
   policy ceiling. Say which to the PE, and fall back to subagent mode. Never
   dispatch on a guess about what this machine can run.

   Each unit's scope section then carries four fields:

   - `mode: subagent | session` — `subagent` (default) is in-process and returns
     its evidence directly. `session` is a real detached session with its own
     full context window; choose it when the unit is large enough that a shared
     context would starve it, when it needs `ultracode`, **or whenever the PE
     needs real-time visibility** — a dashboard, a demo, live follow-along.
     A subagent runs **in-process, inside you**: it is invisible to `agentop
     session list` and to the dashboard, so a wave of subagents makes the
     coordinator look idle while real work is happening, with nothing for the PE
     to watch or attach to. When being watchable matters, the mode is `session`,
     not subagent — the extra cost of a detached session buys the visibility.
     (`session` is also the only mode the PE can `agentop session attach` to
     redirect live, and the only one `agentop events watch` can follow.)
   - `intensity: normal | ultracode` — `ultracode` makes the specialist
     orchestrate multi-agent workflows. It multiplies token spend, so it is the
     PE's call, never yours.
   - `harness` — which harness hosts the session. **The dispatch decision is
     binary, and it is NOT the ledger below:** `aipe dispatch validate` admits a
     harness into session mode only when `isContainable(getAdapter(id))` is true
     — the harness's adapter returns a non-null containment hook that hard-denies
     tool calls under a fully headless, non-interactive run — and **REJECTs**
     every other with `harness-not-containable <id>`, because a harness AIPe
     cannot contain can take an unapproved action inside the worktree. Two ship
     such an adapter today: `claude-code` (default) and `gemini`; `codex` and
     `copilot` ship adapters whose hook is `null`, so they are refused.

     **The world those adapters are drawn from has three states, not two** — a
     compatibility ledger (`src/harness/compat.ts`, each line sourced from the
     tool's own docs by the #57 investigation, queried with
     `harnessesInState(state)`). Read it as **data that moves**, never a fixed
     list — a state flips the day a new investigation or a new adapter lands:
     - **`containable-proven`** — proven to hard-block a headless run.
       `claude-code` and `gemini` carry AIPe adapters and are dispatchable today;
       `factory-droid`, `kimi-code`, `opencode`, `pi` are proven but have **no
       adapter yet**, so they are not dispatchable until one lands.
     - **`non-containable-proven`** — proven to need an interactive trust step
       AIPe's non-interactive dispatch can never perform: `codex`, `copilot`,
       `cursor`. Usable as workspace hosts, never as session mode.
     - **`unestablished`** — a genuine candidate whose headless containment the
       docs do not resolve: `antigravity`. Treated as non-containable until
       proven, so **not** admitted — but not lumped in with the proven-negative
       set either; erasing that distinction was the defect #57 fixed.

     **Do not conflate the two layers: the binary rule (`isContainable`) governs
     what you MAY dispatch; the three-state ledger only describes the world and
     what could change.** Querying the ledger never widens what dispatch admits —
     only an adapter whose hook is non-null does.

     **This context's decision (PE, 2026-08-30): this workspace runs
     `claude-code` only.** Harness is therefore not a live choice here — record
     `claude-code` and move on. The multi-harness machinery above stays because
     it is a real framework capability other contexts use; do **not** delete it
     to "simplify" this one.

   - `tier: fast | standard | reasoning` — the model the specialist runs on
     (`fast`→Haiku 4.5, `standard`→Sonnet 5, `reasoning`→Opus 4.8). Choose by
     **what it costs to be wrong**, not by what it costs to run:
     - **`reasoning`** where a wrong answer does **silent** damage — work whose
       deliverable *is* judgement: weighing *why* and the discarded alternatives
       (architecture docs); a "fix-too-much" hazard where disabling a check makes
       the tests pass and breaks the thing in silence (the version scanner);
       modelling state; deciding policy.
     - **`standard`** for mechanical work against an **explicit** criterion the
       judgement is already spent on: verifying a checklist the dev enumerated,
       translation, moving a file.
     - **`fast`** for the literally trivial: a one-line change, a single metadata
       field.

     **The guardrail — do NOT misread this as "spend less".** This discipline
     exists because the coordinator drifted to `reasoning` as a comfortable
     default, and the audited error was toward **MORE** tier than a minority of
     units needed — **never** toward too little, and no quality was lost.
     **`reasoning` stays the correct choice wherever judgement lives.**
     Downgrading tier where judgement lives trades a **silent quality loss** for
     a token saving, and that trade is worse than the spend. A reader who leaves
     this with "use the cheaper tier" read it wrong; when two tiers are in play on
     a unit that carries judgement, the tier is the higher one.

   Never raise `mode` or `intensity` on your own judgement after approval. If a
   unit turns out heavier than the spec assumed, go back to the PE.

   Validate the structure, then present it to the PE and **wait for approval**:
   ```bash
   aipe journey spec --journey <id> --check --units <fqid,...> --workspace <workspace>
   # PE approves →
   aipe journey spec --journey <id> --approve --workspace <workspace>
   ```

   **Record the approved envelope.** Once approved, record each unit's chosen
   envelope onto its dispatch record using the five flags: `--mode`,
   `--intensity`, `--harness`, `--tier`, `--model`. The shape mirrors step 4c
   (session mode) — `aipe journey record` with these fields added to the base
   dispatch record. **Critical rule for session mode:** a session-mode unit
   **MUST** have `--model` recorded when the envelope is locked in. Without it,
   the unit is silently treated as "not chosen yet" and `aipe execution plan`
   tells the PE to approve the Orientation Spec first (no model to bind to the
   wave). A subagent-mode unit needs no model — it binds per unit. Record this
   before moving to step 4a so `plan` has complete envelopes to group into waves.

   Do **not** dispatch until `--show` reports `approved=true`. This is no longer
   only an instruction to you: `aipe session dispatch` **refuses** a journey whose
   Orientation Spec is unapproved, and refuses before writing any prompt or
   starting any session, so a refused dispatch leaves nothing behind. Editing
   `orientation.md` after approval counts as unapproved — the edit bumps the
   version and clears approval, and the PE must review the amendment and approve
   again. That is the Lawson incident: previously the drift was detected, noted,
   and dispatched anyway. If an escalation
   later changes the cross-package shape, `--amend` (bumps the version), edit, and
   get re-approval before the next wave.

4. **For each wave, in order:**

   a. **Assemble the batch** — the `{repo, specialist, package?}` entries for this
   wave (the specialist is the persona for that package from `personas.yaml`; add
   `package` for a monorepo unit, omit it for a flat repo). Write it to a temp JSON
   file and adjudicate the law — **always pass `--journey`** so the cross-repo
   landing gate runs too:
   ```bash
   aipe dispatch validate --input <batch.json> --journey <id> --workspace <workspace>
   ```
   `OK batch=<n>` → proceed. Any `REJECT …` → fix and re-validate:
   - `same-package <fqid>` / `same-repo <repo>` — two tasks hit one unit in one
     wave with **no declared paths** (each ⇒ the whole unit); split them across
     waves, or give each a disjoint `paths` set to run them together (see below).
   - `path-collision <unit>: <A> ⋂ <B> on <paths>` — two **writing** tasks in one
     unit declared **overlapping** paths; the message names which. Either make the
     `paths` disjoint, split them across waves, or run the managed exception (the
     box after step d) so the second rebases onto the first. Two writers that coexist also need a
     **distinct `task` each** (`same-task <unit>…`) — identity, and the lock file,
     are per task.
   - `cap-exceeded <n>` — more than 16 at once; split the wave.
   - `unknown-repo` / `unknown-specialist` — you named something not in
     `brain.yaml` / `personas.yaml`.
   - `dependency-not-landed <consumer> needs <producer>` — this consumer depends on
     a contract (`consumes`/`imports` in `graph.yaml`) whose producing unit isn't
     `verified`/`merged` yet. Move the producer to an earlier wave and land it
     first; the gate is deterministic, so you cannot dispatch a consumer against a
     contract that doesn't exist yet (see step f).

   b. **Claim the repo, then provision a worktree, per entry.** `dispatch
   validate` only adjudicates *your* batch, in memory — it cannot see another
   coordinator session dispatching into the same repo at the same moment. Take a
   physical, per-machine lock **before** the worktree (`--package` for a monorepo
   unit):
   ```bash
   aipe dispatch claim <repo> [--package <package>] [--task <t>] [--path <glob> ...] --journey <id> --specialist <persona> --workspace <workspace>
   ```
   **Granularity is per PATH, not per repo.** A writing claim with **no** `--path`
   locks the WHOLE unit (the pre-path behaviour — it collides with everything, so
   two path-less devs still serialize). To run **N tasks in one repo at once**,
   give each a **distinct `--task`** (identity) and a **disjoint `--path` set**
   (what it will touch): disjoint claims coexist, overlapping claims collide. You
   **MUST** declare paths honestly and narrowly — a claim that under-declares and
   then writes outside its set defeats the lock; the `reconcile` step (the box
   after step d) catches that drift, but a truthful declaration up front is what
   keeps two agents off one file in the first place. A QA (`--task`, no `--path`)
   never collides with a writer.
   - `CLAIMED …` (exit 0) → the unit/paths are yours; proceed to the worktree.
   - `RECONCILED …` (exit 0) → a stale lock (a released, orphaned, or crashed
     holder) was cleaned up and re-taken; proceed.
   - `COLLISION … on paths <…>` (exit 2) → another live claim holds an
     **overlapping path** (the message names it). **Do not dispatch into it.**
     Either pick disjoint paths, wait for it to release, or run the managed
     exception (the box after step d) — never race it by hand.
   - `UNAUTHORIZED-FORCE …` (exit 3) → you passed `--force` without the PE's
     approval on the record. Overriding a live lock is the PE's call, not yours:
     get the yes in-session, record it, then re-run with `--force`:
     ```bash
     aipe dispatch authorize-force <repo> [--package <package>] --journey <id> --by PE --workspace <workspace>
     aipe dispatch claim <repo> [--package <package>] --journey <id> --specialist <persona> --force --workspace <workspace>
     ```

   With the claim held, provision the worktree (two packages of one repo get
   distinct worktrees on the same clone):
   ```bash
   aipe worktree create --repo <repo> [--package <package>] --specialist <persona> --journey <id> --workspace <workspace>
   ```
   Note the printed `OK <worktree-path> <branch>`. Record it:
   ```bash
   aipe journey record --journey <id> --repo <repo> [--package <package>] --specialist <persona> \
     --branch <branch> --worktree <path> --status dispatched --workspace <workspace>
   ```

   c. **Dispatch the specialist as a subagent.** Read that repo's persona body
   from `<repo>/{{PERSONA_FILE}}` and start a subagent whose
   prompt is: that persona identity, followed by the **hiring brief** (below,
   carrying **its slice** of the approved Orientation Spec — this unit's scope +
   acceptance), and the instruction *"operate strictly inside `<worktree-path>`
   (a monorepo package: stay within `<package-path>`); run spec-driven — first
   check `aipe skill match --task-type <t> --size <s>` and, if an SDD kit matches,
   derive a short package spec + plan and **commit it alongside the code**; then
   TDD; before claiming done run `/verify-before-done` and gather evidence; push
   `<branch>`, open a PR, and return the structured result."* Dispatch all entries
   in a wave in parallel (one subagent each).

   **If the unit's `mode` is `session`:** do not start a subagent. Record the
   dispatch with its envelope, then start the whole wave with one command:

   ```bash
   aipe journey record --journey <id> --repo <repo> [--package <pkg>] \
     --specialist <persona> --branch <branch> --worktree <path> \
     --status dispatched --mode session --intensity <normal|ultracode> \
     --size <small|medium|large> [--task-type <type>] \
     --harness claude-code --workspace <workspace>

   aipe session dispatch --journey <id> --workspace <workspace>
   ```

   **Between those two commands, every unit routed to the full flow needs an
   APPROVED TASK SPEC — `aipe session dispatch` refuses without one.**

   ```bash
   aipe journey task-spec --journey <id> --unit <fqid> --workspace <ws> --scaffold
   # the spec writer fills it in; then:
   aipe journey task-spec --journey <id> --unit <fqid> --workspace <ws> --check
   aipe journey task-spec --journey <id> --unit <fqid> --workspace <ws> --approve   # PE
   ```

   The specialist does **not** write this. That is the whole point: whoever builds
   a thing decides what "done" means for it, and before this existed that decision
   happened *after* dispatch — so nothing a human approved ever said what the work
   was for. A dev and a QA both read `disableStdin: true`, agreed it was
   "pre-existing design, not a regression", and shipped, because no approved
   document said that being able to TYPE was the objective. The PE reported it five
   times.

   Two things the validator refuses, so write for them:
   - **Acceptance by CONSEQUENCE, never mechanism.** Each criterion names the
     **Action** exercised and the **Effect** observed. *"use the `--st-escalated`
     token"* is refused — it has no observable effect to write down. *"a task in
     progress is distinguishable from a stopped one — prove it by alternating"* is
     the shape that works.
   - **Every criterion carries the test the QA will run**, matched by its label, in
     `## Tests the QA runs`. The QA executes those; it does not author its own.

   The path travels to the specialist, never the text: the spec is read at work
   time, so an amendment reaches whoever is already working. Amend it and the PE
   re-approves — the dispatch refuses a spec edited after approval.

   **`--size` is how hard this unit is, and it is the input the SDD route is
   derived from** — the same router `aipe skill match --task-type <t> --size <s>`
   prints as `ROUTE sdd=<kit>`, so the two can never disagree. Recording it is
   what gives the SDD its teeth (#118): when the size routes to `spec-kit`, the
   ledger REFUSES this unit's later `--status delivered` unless a spec
   (`specs/**/spec.md`) **and** a plan (`specs/**/plan.md`) are committed in its
   worktree — exactly as it already refuses a `delivered` with no evidence. The
   specialist does not have to pass anything: the obligation lives on the ledger,
   not in a flag someone has to remember at the end.

   **Leaving `--size` off does not buy the floor — it routes to the FULL flow.**
   Undeclared is not established as trivial, and treating it as trivial is
   precisely what shipped 7/7 PRs with no spec in one day. If a unit really is
   trivial, say so on the record (`--size small`, or `--sdd sdd-lite` to name the
   tier outright) — a signed `--sdd` outranks the derived route, and the claim is
   kept on the ledger where an audit can see someone made it.

   If `skill match` says `ROUTE sdd=none — spec-kit is NOT installed`, STOP and
   run `aipe skill preset` (or `aipe rehydrate`): the flow is unreachable, not
   absent by choice. A workspace with no spec-kit is never gated — AIPe does not
   demand an artifact from a flow the repo cannot run — so an uninstalled kit
   silently disables the whole discipline. That is the state #118 removes at
   onboarding, and the one to never let return.

   `aipe session dispatch` composes each specialist's prompt from its persona,
   its slice of the approved spec, and the return contract; writes it to
   `.aipe/journeys/<id>/prompts/` (kept, as the audit trail of what each
   specialist was told); and starts them all under the task `aipe/<id>`.

   Watch its output for two error lines that need action before you move on,
   not just a glance:
   - `ERROR ledger: session <id> for <fqid> is running but could not be
     recorded (…) — record it manually: aipe journey record …` — the session
     is already live and burning tokens with **no** ledger entry. Run the
     printed recovery command now, don't wait for `collect` to notice — a
     session with no recorded id is invisible to it.
   - `ERROR session: agentop reported no session for <fqid>` (or `asked
     agentop for N sessions, it started M`) — that unit never actually
     started. Treat it like any other dispatch failure: investigate and
     re-dispatch it; nothing is running for it anywhere.

   **Then, immediately, arm the push watch for this wave (standard flow, not
   optional).** `aipe session collect` is a point-in-time poll with a timeout —
   between polls you are blind, and it cannot tell you the *moment* a specialist
   pauses for you. `agentop events watch` is the push channel that narrows that
   gap — **once its producer is up (see the prerequisite below)**:

   ```bash
   agentop events watch --task aipe/<id> --on waiting,waiting-approval,exited --notify <your-session>
   ```

   **This channel has a producer, and it is a prerequisite — name it, do not
   assume it.** The three states above (`waiting`, `waiting-approval`, `exited`)
   are read off the screen by agentop's **five-second monitor**; that monitor is
   the *producer*, and if nothing is running it the watch is armed but **no such
   event ever fires** — you sit in silence believing you are covered. Nothing in
   `aipe` starts the producer for you. Bring it up and keep it up, one of:

   ```bash
   agentop server        # the producer as a background service (preferred)
   agentop events run    # or the producer in the foreground, in its own terminal
   ```

   and confirm it before you trust the watch — if no one is producing, you are
   blind:

   ```bash
   agentop events status
   ```

   - `--task aipe/<id>` scopes the watch to exactly this wave's sessions (the
     same task `session dispatch` filed them under) — never a bare global watch.
   - The three states that matter, and what each means you MUST do:
     - `waiting` — the specialist paused (finished a step, or is asking). Look:
       read its delivery/`blocked` record or attach to see what it needs.
     - `waiting-approval` — it is blocked on a **human** decision. Route it to
       the PE. **NEVER attach and answer for it** — see the boundary below.
     - `exited` — the session ended. Reconcile it: a `LANDED`/`delivered` record
       is a real delivery; an exit with no record is `DEAD-SILENT` (handle it
       exactly as under `session collect` below — read the branch read-only, do
       not re-dispatch blind).
   - `--notify <your-session>` delivers each event to your coordinator session
     by socket, so you learn of a transition as the channel sees it instead of a
     `collect` poll later. Know **which channel saw it**, because they do not
     cover the same thing: `waiting` / `waiting-approval` / `exited` ride the
     five-second producer, so they arrive within ~5s of the screen changing **and
     only while the producer is up**; the separate `turn-end` state comes from
     the Claude `Stop` hook (`agentop hooks install`), is exact and instant and
     needs no producer — but a turn *ending* is **not** the same as a session
     *pausing for you*, so `turn-end` is no substitute for `waiting`. There is no
     state that hands you `waiting` both instantly and producer-free; the price of
     the `waiting` signal is a running producer and up to five seconds.
   - The watch is a **file, not a process**: it survives a reboot or your session
     ending. When you come back, recover what fired while you were gone:
     ```bash
     agentop events tail --task aipe/<id> --since <when>
     ```
     Read `--since <last time you looked>` (an ISO time or a relative `30m`) so
     nothing that happened off-screen is silently lost.

   **Do not trade redundancy for elegance.** `agentop events` is the *fast*
   channel, not the *only* one. The moment you switch your polling off and lean
   on the watch alone, a producer that is not up — or was never started — leaves
   you blind, and nothing warns you that you stopped being warned: the failure is
   silent by construction. Keep the `session collect` sweep below running as the
   safety net *underneath* the watch. Let the events wake you **sooner**; never
   let their silence stand in for **all is well**.

   **What the watch does NOT do (boundary — MUST NOT cross).** A session in
   `waiting-approval` is waiting on **a person**: the PE, in a live decision
   only they can make. Neither you the coordinator nor any other session may
   answer for it — attaching and approving on the PE's behalf forges a human
   approval the audit trail depends on being real. The watch tells you a
   human is needed; getting the human is the only correct response. (This is the
   same rule that governs a `RUNNING`/`waiting` unit: you surface it, the PE
   decides.)

   Then wait for the wave:

   ```bash
   aipe session collect --journey <id> --timeout <seconds> --workspace <workspace>
   ```

   It prints one line per unit, then exits:
   - `0` — every unit `LANDED`. Proceed to the QA gate exactly as with a
     subagent delivery.
   - `1` — a precondition failed (bad `--timeout`, no ledger for the journey,
     or no session-mode units to collect). Fix the invocation, not the wave.
   - `2` — the wave needs your eyes: at least one unit came back `RUNNING` or
     `DEAD-SILENT`. Read the per-unit lines and act on each below.

   Per-unit lines:
   - `LANDED <fqid>` — the specialist recorded its delivery with evidence.
   - `RUNNING <fqid> session <id>` — still working past the timeout, **or**
     `collect` could not confirm the session's state at all (agentop's session
     list was unreadable or untrustworthy) and fails open rather than call it
     dead. Either way, `RUNNING` is not proof of life — never treat it as
     confirmation the specialist is still working. Report it to the PE with
     the session id and let **them** decide whether to keep waiting or
     `agentop session kill`. Killing a specialist is never your call.
   - `DEAD-SILENT <fqid> branch <b>` — the session ended without recording.
     **Read the branch first, read-only** (`git log`, `git diff`) — never
     re-dispatch blind. If there is real work on the branch, prefer
     re-dispatching with a brief that says *continue from what is on the
     branch* over starting the unit over; if the branch is empty or the state
     is unclear, report it to the PE instead and let them decide how to
     proceed. This is not the cross-repo `escalated` status (step 5) — it's
     the same repo/unit, just an unclear state for the PE's eyes. The ledger
     law that forbids re-dispatching merged work applies here too.
   - `REDIRECTED <fqid> session <id> reason=<what was asked>` — the PE talked
     to this specialist directly (via `agentop session attach`) and changed
     its direction. You **MUST** do one of two things before this unit can
     proceed: fold the change into the Orientation Spec and bump its version,
     or escalate to the PE that the change conflicts with the approved scope.
     A redirected unit **MUST NOT** pass the QA gate while the spec still
     describes something else — the QA would be validating against
     acceptance criteria nobody is following.

   If the wave times out with units still `RUNNING`, don't keep looping
   `collect` on your own judgement — report the standing wave to the PE
   (which units, which session ids) and let them decide.

   If your session ends while a wave is in flight, the sessions keep running —
   they are detached. On your next turn, read the ledger and run
   `aipe session collect` again; it reconciles from the `aipe/<id>` task.

   **Verify the brief before you dispatch (MUST).** A dispatched subagent gets no
   second question from the PE — the brief is its whole world, so a thin brief is a
   drifting specialist. Before sending, confirm the brief carries: the unit's
   **scope + acceptance** (from the approved spec), the **relevant files** you
   already know, the **relations** touching this unit, and an explicit **definition
   of done**. If you cannot fill these, you have not decomposed enough — do that
   first, don't dispatch a guess.

   d. **Collect results.** Each subagent returns one of:
   - `{ "status": "delivered", "pr": "<url>", "summary": "…", "evidence": { "commands": ["…"], "summary": "…" } }`
     — a delivery WITH proof. Record it (the ledger **REJECTs** `delivered` without
     evidence — that is the point):
     ```bash
     aipe journey record … --pr <url> --status delivered \
       --evidence-cmd "<cmd the dev ran>" --evidence-summary "<what the output showed>"
     ```
     If a subagent returns `delivered` with **no** evidence, it is **not** delivered —
     send it back to run `/verify-before-done` and return proof.
     Then **release the claim** — the active dispatch into this repo is done, so a
     later wave (the QA gate, another journey) can claim it. Pass the **same
     `--task`** you claimed with (a path claim's lock is keyed by task), so you
     release exactly that sub-task's lock and not a disjoint sibling's:
     ```bash
     aipe dispatch release <repo> [--package <package>] [--task <t>] --journey <id> --specialist <persona> --workspace <workspace>
     ```
   - `{ "status": "needs-clarification", "need": "…" }` — the brief was insufficient.
     Answer it (or get the PE's answer), amend the brief, and re-dispatch. A specialist
     that asks is cheaper than one that guesses; never punish the question by pushing it
     to deliver anyway.
   - `{ "status": "escalate", "targetRepo": "<repo>", "need": "…", "reason": "…" }`
     — a cross-repo need it must not touch. Record `--status escalated`, **release
     the claim** on that repo (`aipe dispatch release <repo> --journey <id>
     --workspace <workspace>`), and hold it for step 5.

   **Honest paths + the managed exception (path-parallel work only).** A path set
   declared at claim time **ages** — a dev's scope legitimately grows mid-task, and
   `bun install` can nudge submodule pointers no one meant to touch. So when you ran
   sub-tasks on declared paths, **reconcile the lock against what the branch really
   moved before you clear the delivery** — the lock **MUST** reflect reality, not
   the promise, or it protected less than it looked:
   ```bash
   aipe dispatch reconcile <repo> [--package <p>] --task <t> --journey <id> --worktree <path> [--base origin/main] --workspace <workspace>
   ```
   - `RECONCILED … drift=<paths>` (exit 0) → the lock now names the real files; any
     `drift` is what the declaration missed. Proceed.
   - `DRIFT-COLLISION … overlaps journey=<other> on <paths>` (exit 2) → the branch
     grew into a path another live claim holds. This is the **managed exception**,
     **not** a fatal error — run it, do not just re-order and hope:
     ```bash
     aipe dispatch resolve-overlap <repo> --branch <this-branch> --onto <holder-branch> --path <overlapping> ...
     ```
     The printed plan is the required recovery, in order: **wait** for the holder to
     land → **rebase** this branch onto it → the agent (which holds both tasks'
     orientation) **resolves** the conflict → the **QA gate (step e) runs over the
     REBASED result**, not either branch alone. That review is the net that catches
     both a bad textual merge and a semantic break; skipping it lets dirt
     accumulate. You **MUST** run step e on the merged tree, not wave it through
     because each branch passed on its own.

   e. **QA gate (MUST) — an independent skeptic against the diff.** For every dev
   delivery you **MUST** dispatch that same repo/package's **QA** persona
   (from `personas.yaml`) as a gate before reporting anything "done" to the PE. The
   QA runs `/review-delivery` in its own worktree on the dev's branch: it verifies
   **against the diff and the acceptance criteria, not the dev's report**, exercises
   the change itself (tests + real behavior), and returns a severity-calibrated
   verdict. This is not optional and not a self-report by the dev — a delivery is only
   **cleared** once an *independent* persona passes it.

   **Cross-model QA (recommended for high-risk units, session mode only).** A QA
   persona dispatched in session mode may run on a *different harness* from the
   dev — `gemini` reviewing a `claude-code` delivery, or the reverse — so the
   reviewer does not inherit the dev's blind spots, which is what "independent
   skeptic" was always supposed to mean. Which harnesses are eligible is the same
   binary rule as any session dispatch (the `harness` field above): a
   `containable-proven` state **with an adapter**. The three-state ledger in
   `src/harness/compat.ts` describes the wider world but does not widen what QA
   can run on. `codex`, `copilot` and `cursor` are usable as workspace hosts but
   not as session-mode QA: they need an interactive trust step AIPe's
   non-interactive dispatch can never perform. Set the QA unit's `harness` in the
   Orientation Spec; the PE approves it with the rest of the envelope.

   **In THIS context (`claude-code` only), cross-model QA does not apply** — and
   that removes nothing from the gate. The QA's independence here comes from a
   **separate persona in a separate worktree** reviewing against the diff and the
   acceptance criteria, not from a different model. That is a full QA gate; never
   read "no cross-model here" as "no independent review".

   Provision + record the QA exactly like a dev dispatch:
   ```bash
   aipe worktree create --repo <repo> [--package <package>] --specialist <qa-persona> --journey <id> --workspace <workspace>
   aipe journey record --journey <id> --repo <repo> [--package <package>] --specialist <qa-persona> \
     --branch <branch> --worktree <path> --status dispatched --workspace <workspace>
   ```
   The QA subagent returns
   `{ "status": "passed" | "failed", "summary": "…", "findings": [{severity, file, line, issue}], "evidence": {commands, summary} }`.
   - `passed` → record `--status verified` **with the QA's own evidence** (the ledger
     REJECTs `verified` without it):
     ```bash
     aipe journey record … --specialist <qa> --status verified \
       --evidence-by qa --evidence-cmd "<cmd QA ran>" --evidence-summary "<what QA observed>"
     ```
     The unit is now cleared for the PE.
   - `failed` → the change is **not** done: form a fix task back to the same dev
     (next wave, carrying the QA findings), record the dev's re-dispatch with
     `--reason "<the QA finding>"`, then re-gate with QA. Loop until QA passes. Never
     present a `failed` (or un-gated) unit as done. Any **Critical/Important** finding
     blocks; **Minor** does not (note it).

   **Table of non-exceptions (forbidden rationalizations for skipping QA).** Each
   thought below means **STOP — you are rationalizing:**

   | Rationalization | Ruling |
   | --- | --- |
   | "the dev says the tests pass" | Self-report ≠ QA. MUST still dispatch QA |
   | "the change is tiny / one line" | MUST still QA-gate |
   | "I read the diff and it's fine" | Coordinator review ≠ the QA gate. MUST still dispatch QA |
   | "the PE is waiting, ship it" | MUST still QA-gate; report only what is `verified` |
   | "QA passed on an earlier wave" | A new change is a new gate. MUST re-QA the fix |

   f. **Cross-repo landing gate (enforced) before a dependent wave.** When a later
   wave depends on a contract an earlier wave produced (A `consumes`/`imports` what
   B produces, per `graph.yaml`), the consumer must not be dispatched until B's unit
   is actually **`verified`/`merged`** in the ledger — ordering the waves is not the
   same as the contract having landed. You don't have to police this by hand: the
   `aipe dispatch validate --journey <id>` in step 4a **REJECTs**
   `dependency-not-landed <consumer> needs <producer>` deterministically. When you
   see it, move the producer to an earlier wave and land it first. A single session
   never needs this; a multi-repo coordination does, and skipping it ships a consumer
   against a contract that doesn't exist yet.

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
   Once the whole journey's PRs have merged, sweep them all at once instead
   (guardrail-safe: `prune` **skips** any worktree whose dispatch is still active
   — a re-dispatched unit is live work, not leftover — and `--force` overrides the
   dirty-tree guard but still never removes a live-dispatch worktree; read its
   `STATE pruned=… kept=… skipped=…` line to see the difference between "nothing
   to prune" and "I refused"):
   ```bash
   aipe worktree prune --journey <id> --workspace <workspace>
   ```
   Record `--status merged` (or `removed`), and **release the claim** on each
   repo (idempotent — a no-op if it was already released at `delivered`):
   ```bash
   aipe dispatch release <repo> [--package <package>] --journey <id> --workspace <workspace>
   ```

   **`merged` is not "in production" — hold the distinction (MUST).** A unit
   recorded `merged` is merged into the target branch — `dev`, not in production
   and not yet released to users. The demand is *integrated*, not *published*:
   `dev` accumulates verified work continuously, and a release only cuts when
   `dev` is promoted to `main` (see `RELEASING.md`). So "the PRs merged" is **not**
   the end of the loop — step 7 is. Never tell the PE a change is "shipped",
   "released" or "in production" on the strength of a `merged` record; that word
   means the target branch, nothing more.

   **Reliability lint before you report (MUST).** Before telling the PE the demand
   is done, run the deterministic ledger audit and only report once it is clean:
   ```bash
   aipe journey verify --journey <id> --workspace <workspace>
   ```
   It prints `FINDING <severity> <code> <unit> — <detail>` for every broken
   invariant (a delivered/verified unit with no evidence, a `failed` unit never
   re-dispatched, a consumer shipped before its producer landed, a merge that
   skipped QA, an open escalation) and `STATE … clean=true|false … critical=<n>`.
   **Do not report "done" while `critical>0`.** Fix each critical finding (re-gate,
   attach evidence, land the producer) and re-run until clean; surface any remaining
   warnings to the PE explicitly. Then report the final set of PRs — as **merged
   into `dev`**, not as released (see the distinction above).

7. **Promotion offer — carry the loop to publication (the gate).** `merged` is
   where integration ends, not where the demand reaches users. Verified work sits
   on `dev` until `dev` is promoted to `main`, and **that promotion is the PE's
   decision, never yours and never silent.** Two failures are symmetric, and you
   MUST avoid both:
   - **Promoting in silence** — cutting a release the PE never chose.
   - **Damming in silence** — letting verified work pile up on `dev` with the PE
     never told it is there to promote. This is the failure that actually
     happened; it is not "safe by default", it is the same defect as the first.

   So when verified work has landed on `dev`, you **present to the PE what is there
   and ask**: promote it now, or exercise it on `dev` first? You do not promote on
   your own judgement, and you do not stay quiet.

   **Check for unpromoted work (the checkable condition).** After close-out,
   determine whether verified work sits on `dev` unreleased. The ledger and
   `aipe status` express this distinction between *merged* and *released*; consume
   that signal where it is present. Where it is not, determine it directly from git
   — commits on `dev` that `main` does not yet have are unreleased work:
   ```bash
   git -C <repo-path> log --oneline origin/main..origin/dev
   ```
   Any output means there is verified work to offer. (Assumption: a sibling effort
   is teaching the ledger and `aipe status` to name the *released* vs *merged*
   state directly; until it lands, the git check above is the source of truth.)

   **Ask by BATCH, never per PR (MUST — with the why).** The question is *"here is
   what has accumulated on `dev` — promote this batch now, or hold?"*, asked once
   over the set of verified work, **not** once per merged PR. Promoting on every
   merge is exactly what produced **five releases in a single day** for this
   repository — several of them one feature sliced across patch bumps — and the
   `CONTRIBUTING.md`/`RELEASING.md` record it as an anti-pattern. A promotion goes
   out when either (a) at least one complete feature has landed on `dev`, or (b)
   there is a fix the PE needs to consume with urgency; green CI on `dev` is a
   **precondition** for promoting, not the trigger. The whole point is to bundle
   related, verified work into one release with actual content.

   **What you present, and what you do NOT do.** Present: which units are verified
   and merged on `dev`, whether they add up to a complete feature or an urgent fix,
   and the explicit choice — *promote now* or *exercise on `dev` first*. You do
   **NOT** open the promotion PR, merge `dev → main`, or bump a version on your own
   call — automating the promotion is out of scope; the decision is the PE's. Once
   the PE says promote, you open the promotion PR (`dev → main`) — never a
   specialist, and the release publishes from the merge (see `RELEASING.md`).

   **Table of non-exceptions (forbidden rationalizations for skipping the offer):**

   | Rationalization | Ruling |
   | --- | --- |
   | "it's just merged to `dev`, the PE will ask when they want a release" | Damming in silence is the failure this exists to end. MUST present it |
   | "only one small PR landed — not worth mentioning" | Present it anyway; the PE decides whether one PR is a batch worth promoting |
   | "I'll just promote it, it's obviously ready" | Promoting in silence forges a decision that is the PE's. MUST ask first |
   | "I promoted the last batch, so I'll promote this one too" | Each batch is a fresh decision. MUST ask again |

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
  "workingMethod": "Run `aipe skill match`; if an SDD kit matches, write a short package spec + plan and commit it before implementing (it travels in the PR). Then drive the change with `/tdd` (RED→GREEN — failing test first) when it is testable. Before claiming done, run `/verify-before-done`: attach the RED→GREEN trace AND drive the feature, returning evidence (commands + what the output showed) — a delivery with no evidence is REJECTed by the ledger.",
  "relevantFiles": ["<paths you already know are involved>"],
  "relations": [ <the graph.yaml edges touching this unit> ],
  "deliveryContract": {
    "definitionOfDone": "A PR from <branch> with the change, its committed spec/plan (when SDD applied), green tests, AND evidence: the command(s) run + what the output showed.",
    "opensPr": true,
    "returns": "{status:'delivered', pr, summary, evidence:{commands:[…], summary:'…'}}"
  },
  "ifBriefInsufficient": "If this brief doesn't tell you enough to proceed, STOP and return {status:'needs-clarification', need:'…'} — do NOT guess. Asking is cheaper than a wrong delivery.",
  "escalation": "If this needs a change in another package/repo, STOP and return {status:escalate,…}; never edit another unit."
}
```

For a **QA** dispatch, `role` is `qa`, `workingMethod` is `/review-delivery` (verify
against the diff + acceptance, not the dev's report; exercise it yourself; calibrate
severity), and `returns` is
`{status:'passed'|'failed', summary, findings:[{severity,file,line,issue}], evidence:{commands,summary}}`.

## Rules

- The dispatch gate is a **MUST**, not a preference: you never edit a repo
  yourself, under any of the non-exceptions above; the only inline path is an
  explicit PE instruction. Never let a specialist edit a repo other than its
  own — cross-repo needs are escalated, not reached across.
- The **QA gate is a MUST**: no dev delivery is reported "done" to the PE until
  that repo/package's QA has run `/review-delivery` (against the diff, not the
  report) and returned `passed`.
- **Evidence is a MUST** (Pilar 1): a `delivered`/`verified` record carries the
  command(s) run + what the output showed. This is not a courtesy — the ledger
  physically REJECTs a done-claim without it. Never launder a no-evidence delivery
  into "done".
- **Read the ledger first** (Pilar 3): on resuming a journey, `aipe journey show`
  before dispatching; `verified`/`merged` units are done and never re-dispatched.
  The CLI enforces it (rejects a merged re-record; needs `--reason` to reopen).
- Process-skills (systematic-debugging, TDD, brainstorming, verify-before-done) are
  never run by you the coordinator — they live inside the dispatched specialist.
  AIPe routing overrides, but it does not switch those skills off.
- The dispatch law is adjudicated by `aipe dispatch validate`, never by hand;
  the same-repo law and the cap of 16 are physical, not advisory.
- Provision worktrees only through `aipe worktree`; never `git worktree` by hand.
- The hiring brief is assembled in memory and passed to the subagent — it is
  never written to disk. The durable record is the journey ledger + the PRs.
- Each specialist opens its **own** PR; commits carry the namespaced persona
  author (`aipe/<Persona>`) set by the worktree, with the PE's real account
  preserved via the inherited email.
- **The promotion offer is a MUST**: `merged` means merged into `dev`, not
  released — when verified work sits on `dev`, you present the batch to the PE
  and ask (promote now, or exercise on `dev` first). Never promote in silence
  and never leave it dammed in silence; the decision is the PE's, the offer is
  yours, and it is asked by batch, not per PR (per-PR promotion is what produced
  five releases in a day — see `RELEASING.md`).

## Common mistakes

- *Editing a repo yourself because the fix is obvious* → hand the fix to the
  specialist as the task; you dispatch, never edit.
- *Dispatching before the Orientation Spec is approved* → gate on `--show` reporting
  `approved=true`; no dispatch before that.
- *Reporting a dev delivery as "done" on the dev's word* → nothing is done until its
  QA returns `passed` and you record `--status verified`.
- *Re-dispatching work already `delivered`/`merged` in the ledger* → read the journey
  ledger first; delivered/merged units are intocáveis, never re-dispatched.
- *Two tasks on the same package in one wave* → the dispatch law rejects it; split
  across waves. Adjudicate with `aipe dispatch validate`, never by hand.
- *Calling `merged` "shipped"/"released" to the PE* → `merged` is merged into
  `dev`, not published; hold the word until a promotion actually cuts a release.
- *Letting verified work sit on `dev` without telling the PE* → damming in silence
  is a failure, not a safe default; present the batch and ask (step 7).
- *Promoting `dev → main` on your own judgement* → promotion is the PE's decision;
  you offer, you never cut the release silently.

## Self-review gate (before reporting anything "done" to the PE)

- [ ] On resume, I ran `aipe journey show` first and re-dispatched nothing
      `verified`/`merged`.
- [ ] A journey was opened; every dispatch/result is recorded in its ledger.
- [ ] The Orientation Spec is `approved=true` and no dispatch preceded that.
- [ ] Every brief I dispatched carried scope + acceptance + relevant files + relations.
- [ ] Every repo edit went through a dispatched specialist in its own worktree —
      zero inline edits (unless the PE explicitly instructed inline).
- [ ] Every dev delivery carries **evidence** in the ledger (no `!NO-EVIDENCE`).
- [ ] Every dev delivery has an independent QA `passed` recorded as `--status verified`
      (with the QA's own evidence).
- [ ] No dependent wave opened before its producing unit was `verified`/`merged`.
- [ ] Cross-repo needs were escalated to the PE, not reached across.
- [ ] `aipe journey verify` reports `clean=true` (zero critical findings) — or every
      remaining warning was surfaced to the PE explicitly.
- [ ] The set of PRs reported matches the ledger; merged worktrees are torn down.
- [ ] I reported `merged` as **merged into `dev`**, never as released/in production.
- [ ] Is there verified work on `dev` with **no promotion offered**? If so, I
      **presented the batch to the PE** and asked (promote now, or exercise on
      `dev` first) — I neither promoted in silence nor left it dammed in silence.
