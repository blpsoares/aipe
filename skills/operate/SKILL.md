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

2. **Decompose the demand into per-repo tasks.** Decide *which repos* the demand
   actually touches and *what each one must do*. A task is scoped to a single
   repo. If the demand only touches one repo, there is exactly one task — do not
   invent work in other repos.

3. **Sequence with the relations graph.** Read `graph.yaml`. If repo A's task
   depends on a contract that repo B must change first (A `consumes`/`imports`
   what B `exposes`/`publishes`), B's task must land before A's. Order the tasks
   into **waves**: everything in a wave can run at once; a later wave depends on
   an earlier one. Independent repos go in the same wave.

4. **For each wave, in order:**

   a. **Assemble the batch** — the `{repo, specialist}` pairs for this wave (the
   specialist is the persona for that repo from `personas.yaml`). Write it to a
   temp JSON file and adjudicate the law:
   ```bash
   aipe dispatch validate --input <batch.json> --workspace <workspace>
   ```
   `OK batch=<n>` → proceed. Any `REJECT …` → fix and re-validate:
   - `same-repo <repo>` — two tasks hit one repo in one wave; split them across
     waves (the same-repo law serializes; you cannot parallelize within a repo).
   - `cap-exceeded <n>` — more than 16 at once; split the wave.
   - `unknown-repo` / `unknown-specialist` — you named something not in
     `brain.yaml` / `personas.yaml`.

   b. **Provision a worktree per entry:**
   ```bash
   aipe worktree create --repo <repo> --specialist <persona> --journey <id> --workspace <workspace>
   ```
   Note the printed `OK <worktree-path> <branch>`. Record it:
   ```bash
   aipe journey record --journey <id> --repo <repo> --specialist <persona> \
     --branch <branch> --worktree <path> --status dispatched --workspace <workspace>
   ```

   c. **Dispatch the specialist as a subagent.** Read that repo's persona body
   from `<repo>/.claude/skills/<slug>/SKILL.md` and start a subagent whose
   prompt is: that persona identity, followed by the **hiring brief** (below),
   and the instruction *"operate strictly inside `<worktree-path>`; when done,
   commit, push `<branch>`, open a PR, and return the structured result."*
   Dispatch all entries in a wave in parallel (one subagent each).

   d. **Collect results.** Each subagent returns one of:
   - `{ "status": "delivered", "pr": "<url>", "summary": "…" }` — record it:
     `aipe journey record … --pr <url> --status delivered`.
   - `{ "status": "escalate", "targetRepo": "<repo>", "need": "…", "reason": "…" }`
     — a cross-repo need it must not touch. Record `--status escalated` and hold
     it for step 5.

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
   Record `--status merged` (or `removed`). Report the final set of PRs to the PE.

## The hiring brief (assemble per dispatch, never write to disk)

Hand the subagent this exact shape, filled from the data above:

```json
{
  "journey": "<id>",
  "repo": "<repo>",
  "specialist": "<persona>",
  "role": "dev-fullstack | qa",
  "worktree": "<absolute worktree path>",
  "branch": "aipe/<id>/<slug>",
  "task": "One scoped paragraph: what to build/fix in THIS repo only.",
  "relevantFiles": ["<paths you already know are involved>"],
  "relations": [ <the graph.yaml edges touching this repo> ],
  "deliveryContract": {
    "definitionOfDone": "A PR from <branch> with the change and green tests.",
    "opensPr": true
  },
  "escalation": "If this needs a change in another repo, STOP and return {status:escalate,…}; never edit another repo."
}
```

## Rules

- Never edit a repo yourself and never let a specialist edit a repo other than
  its own — cross-repo needs are escalated, not reached across.
- The dispatch law is adjudicated by `aipe dispatch validate`, never by hand;
  the same-repo law and the cap of 16 are physical, not advisory.
- Provision worktrees only through `aipe worktree`; never `git worktree` by hand.
- The hiring brief is assembled in memory and passed to the subagent — it is
  never written to disk. The durable record is the journey ledger + the PRs.
- Each specialist opens its **own** PR; commits carry the namespaced persona
  author (`aipe/<Persona>`) set by the worktree, with the PE's real account
  preserved via the inherited email.
