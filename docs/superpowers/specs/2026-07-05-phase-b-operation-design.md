# Phase B — Operation — design spec

**Date:** 2026-07-05
**Status:** Design approved — ready for implementation plan
**Depends on:** `2026-07-01-aipe-context-brain-design.md` (§6 settled decisions,
§2 terminology: *journey*, *specialist*), `2026-07-02-relationship-design.md`
(`graph.yaml` this cycle reads), `2026-07-03-hire-specialists-design.md`
(persona two-mode format + `personas.yaml` roster), `2026-07-04-unified-cli-distribution-design.md`
(the `aipe` subcommand + zero-dependency packaging pattern all new CLI obeys).

---

## 1. Purpose

Onboarding (Phase A) produced a mapped context: `brain.yaml` (repos + stack),
`relations/graph.yaml` (cross-repo edges), `personas.yaml` (roster), and a
two-mode persona `SKILL.md` inside each repo. **Phase B is *Operation*:** the
fully-onboarded coordinator receives a demand from the PE, decomposes it into
per-repo tasks, dispatches the per-repo specialists to work **in parallel**
(respecting cross-repo relations and the physical same-repo law), and each
specialist delivers a **PR** — with cross-repo matters **escalated to the PE**.

This spec covers the two roadmap items that make Operation real:

- **Block 1 — Worktree-per-journey (foundational):** isolate each dispatched
  specialist's work in its own git worktree so parallel specialists (and
  parallel journeys) never collide. Fully deterministic → a tested `aipe`
  subcommand.
- **Block 2 — Dispatch mechanics:** the canonical **hiring brief** the
  coordinator hands a specialist, the **parallel-dispatch law** (same repo
  serializes, distinct repos run in parallel, cap of 16), **how a dispatched
  persona actually runs**, how each specialist **opens its PR**, and the
  **cross-repo escalation** flow.

The house pattern holds throughout: **everything past raw agent output on disk
is a deterministic, tested CLI**; the coordinator's LLM work lives in a `SKILL.md`.

---

## 2. Resolved design decisions (brainstorm, 2026-07-05)

The foundation spec §6 pre-settled the *laws* (worktree isolation, same-repo
serialization, cap 16, specialist opens the PR, per-task disposable scratchpad,
cross-repo escalates to the PE). This cycle's brainstorm resolved the four
open *mechanics*:

1. **How a specialist runs — subagent + worktree.** A dispatched persona runs
   as a **subagent** (`Agent()` in Claude Code; the equivalent worker in any
   other harness), not as a fresh headless session. The coordinator reads the
   persona's `SKILL.md` body from the **main working tree** and injects that
   identity into the subagent; the **worktree provides filesystem isolation**.
   Rationale: this is exactly the persona "mode A" the onboarding already
   documents, it reuses the onboarding fan-out shape (live `Agent()` calls, not
   a formal `Workflow()`), and it sidesteps a real blocker — **persona
   `SKILL.md` files are written to the working tree but never committed**
   (`hire-specialists/run.ts`), so a fresh session checked out in a worktree
   would *not* auto-load the persona. Subagent mode never depends on the
   worktree carrying the persona.

2. **Hiring brief — canonical ephemeral schema.** The brief has a fixed shape
   (§6) so every dispatch is consistent, but it is **not persisted as an
   artifact** — assembled by the coordinator at dispatch time and passed as the
   subagent's payload, honoring `hire-specialists` decision 7 ("the hiring
   brief is never a persisted artifact"). What *is* persisted is the journey
   ledger (§5), which is bookkeeping, not the brief.

3. **CLI/prompting boundary — the CLI adjudicates the law.** The coordinator
   (prompting) decomposes the demand and *sequences* it using `graph.yaml`
   (product reasoning); the **CLI adjudicates the physical law** — given a
   proposed parallel batch it enforces "no two dispatches on the same repo" and
   "≤16 concurrent," and it **provisions the worktrees**. The CLI does **not**
   derive cross-repo dependency order from `graph.yaml` — that stays with the
   coordinator. This keeps the one law the coordinator "can't break" out of
   fragile prompting while leaving genuine judgement to the coordinator.

4. **PR attribution — persona name, prefixed; real account preserved.** Each
   specialist commits **as its persona**, but the git author *name* is
   **namespaced** so it is always clear these are AIPe-generated commits and
   *whose real account* they come from. Mechanism: at worktree-create time the
   CLI sets a **per-worktree** git identity —
   `git config --worktree user.name "aipe/<Persona>"` — and **leaves
   `user.email` inherited** from the PE's real git identity. GitHub therefore
   attributes the commit to the PE's actual account (via email), while the
   displayed author (`aipe/Joaquim`) makes the persona and its synthetic nature
   explicit. `extensions.worktreeConfig` scopes this to the worktree so the
   PE's main repo config is untouched. The PR body additionally credits
   persona + role + repo + coordinator + journey.

---

## 3. Block 1 — Worktree-per-journey (the foundational CLI)

A **journey** is one work session between the PE and the coordinator on a
demand; it has an id and may dispatch several specialists. Each dispatch gets
its own worktree so parallel dispatches — and parallel journeys — never share a
working tree.

### 3.1 Convention

```
<repo>/.worktrees/<journey-id>-<specialist-slug>/     ← the isolated working tree
branch: aipe/<journey-id>/<specialist-slug>            ← the branch it commits to
```

- `journey-id` is a slug-safe token the coordinator mints once per demand
  (e.g. `j-20260705-a1`); the CLI validates it, it does not invent it (keeps
  the binary free of `Date.now()`-style nondeterminism in the hot path — the
  optional `aipe journey start` helper below is the only place a timestamp is
  read, and it can be overridden for tests).
- `specialist-slug` is the persona name kebab-cased, reusing
  `hire-specialists`'s `personaSlug`.
- The branch is namespaced under `aipe/` so it is unmistakably framework-created
  and easy to sweep.

### 3.2 Subcommand surface — `aipe worktree`

```
aipe worktree create --repo <name> --specialist <persona> --journey <id>
                     [--base <branch>] [--workspace <dir>]
aipe worktree list   [--journey <id>] [--workspace <dir>]
aipe worktree remove --repo <name> --specialist <persona> --journey <id>
                     [--force] [--workspace <dir>]
```

**`create`** (deterministic git plumbing, no LLM):
1. Read `brain.yaml`; resolve `<repo>`'s path. Error `ERROR unknown-repo <name>`
   if absent.
2. `--base` defaults to the repo's current default branch (`git symbolic-ref
   refs/remotes/origin/HEAD`, falling back to the checked-out branch).
3. Ensure `.worktrees/` is excluded locally: append it to
   `<repo>/.git/info/exclude` if not already present (never edits a tracked
   `.gitignore` — the PE's repo stays clean).
4. `git -C <repo> worktree add -b aipe/<id>/<slug> <repo>/.worktrees/<id>-<slug> <base>`.
5. Set the per-worktree identity: `git -C <repo> config extensions.worktreeConfig
   true`, then `git -C <worktree> config --worktree user.name "aipe/<Persona>"`
   (email left inherited — see decision 4).
6. Print `OK <worktree-path> <branch>`.

Idempotent: if the worktree/branch already exists for that `(repo, journey,
specialist)`, re-print `OK` with the existing path (a retried dispatch must not
fail).

**`list`** — enumerate AIPe worktrees by parsing `git -C <repo> worktree list
--porcelain` for every repo and filtering to paths under `.worktrees/`
(optionally narrowed to one `--journey`). Prints one `WT <repo> <specialist>
<journey> <branch> <path>` line each. Source of truth for "what's in flight" is
git itself, not a ledger — the ledger (§5) is an audit convenience layered on
top.

**`remove`** — `git -C <repo> worktree remove <path>`. **Guardrail:** refuse
with `BLOCKED <reason>` if the worktree has uncommitted changes *or* unpushed
commits, unless `--force` — the real deliverable is the PR + pushed history, and
the scratchpad is disposable *only once its content is safely in git*
(foundation spec §6 guardrail). Also prunes the branch only under `--force`.

### 3.3 Why inside the repo (nested worktree)

The foundation spec fixed the convention at `<repo>/.worktrees/…`. A nested
worktree is fully supported by git; it surfaces as *untracked* in the main
working tree, which the `.git/info/exclude` step (3.1/step 3) suppresses
without touching any committed file. Its own working directory is an
independent checkout of the branch and contains no nested `.worktrees/`, so
`git add -A` inside it cannot recurse. Because we run specialists as subagents
(decision 1), the worktree does **not** need to carry the uncommitted persona
skill.

---

## 4. Block 2 — Dispatch mechanics

### 4.1 The parallel-dispatch law — `aipe dispatch validate`

The coordinator assembles a proposed **parallel batch** (the set of specialists
it wants to run *at once*, after it has already decided sequencing) and asks the
CLI to adjudicate the physical law before provisioning worktrees:

```
aipe dispatch validate --input <batch.json> [--workspace <dir>]
```

Input — one batch:
```json
[
  { "repo": "embark",     "specialist": "Joaquim" },
  { "repo": "prontuario", "specialist": "Maria" }
]
```

Checks (pure, testable):
- **Same-repo serialization:** two entries with the same `repo` in one batch →
  `REJECT same-repo <repo>` (they must be split across sequential batches).
- **Cap:** more than **16** entries → `REJECT cap-exceeded <n>`.
- **Existence:** `repo` present in `brain.yaml` and `specialist` present in
  `personas.yaml` for that repo → else `REJECT unknown-repo` / `REJECT
  unknown-specialist`.

Output `OK` (the batch is lawful; the coordinator proceeds to `worktree create`
per entry) or one `REJECT …` line per offending entry. The CLI never *reorders*
across repos — cross-repo dependency ordering is the coordinator's job (it
submits batches in the order it decided from `graph.yaml`).

### 4.2 The hiring brief (canonical, ephemeral)

Assembled by the coordinator per dispatch, passed as the subagent's payload,
**never written to disk**. Fixed shape:

```json
{
  "journey": "j-20260705-a1",
  "repo": "embark",
  "specialist": "Joaquim",
  "role": "dev-fullstack",
  "worktree": "/abs/path/embark/.worktrees/j-20260705-a1-joaquim",
  "branch": "aipe/j-20260705-a1/joaquim",
  "task": "One scoped paragraph: what to build/fix in THIS repo only.",
  "relevantFiles": ["src/api/patients.ts", "..."],
  "relations": [ { "to": "prontuario", "type": "consumes", "detail": "…" } ],
  "deliveryContract": {
    "definitionOfDone": "PR from <branch> with the change + green tests",
    "opensPr": true
  },
  "escalation": "If this needs a change in another repo, STOP and report the cross-repo need to the coordinator; never edit another repo."
}
```

`relations` is the slice of `graph.yaml` touching this repo, so the specialist
honors the contracts it must not break. The persona `SKILL.md` already documents
(in prose) how to read a brief; this schema makes the concrete object uniform.

### 4.3 How a dispatched persona runs

For each lawful entry the coordinator:
1. Reads the persona's `SKILL.md` body from
   `<repo>/.claude/skills/<slug>/SKILL.md` (main working tree).
2. Dispatches a subagent whose prompt = that identity body + the §4.2 brief +
   the instruction to operate **strictly inside `worktree`** and to return a
   structured result (§4.5).
3. Same-repo entries are — by the law — never in the same batch, so two
   subagents never share a repo; distinct-repo subagents run concurrently, each
   confined to its own worktree.

### 4.4 Delivery — the specialist opens the PR

At the end of its work the specialist (subagent), inside its worktree:
1. Commits (author `aipe/<Persona>`, email inherited — set at create time).
2. Pushes `aipe/<journey>/<slug>`.
3. Opens the PR via the **harness's** GitHub capability (Claude Code: the GitHub
   MCP / `gh`; other harnesses: their own). PR creation is inherently
   platform-specific and **stays in prompting**, never in the zero-dependency
   `aipe` binary. PR body template: *"Delivered by \<Persona\> (\<role\>,
   \<repo\>), dispatched by \<coordinator\> for journey \<id\>."*
4. Returns `{ "status": "delivered", "pr": "<url>", "summary": "…" }`.

### 4.5 Cross-repo escalation

A specialist that discovers, mid-task, that the demand needs a change in
**another** repo must **not** touch it. It returns:
```json
{ "status": "escalate", "repo": "embark",
  "targetRepo": "prontuario",
  "need": "prontuario must expose GET /patients/:id/vitals",
  "reason": "the embark change consumes it" }
```
The coordinator aggregates escalations and **presents them to the PE** —
cross-repo scope is the PE's call (company analogy: the PE "decides cross-repo
matters"). On approval, the coordinator forms the next batch targeting
`targetRepo`'s specialist, sequenced (via `graph.yaml`) so the dependency lands
first, and runs it through the same law (§4.1) → worktree → dispatch loop.

### 4.6 Journey ledger (audit convenience)

`aipe journey` maintains a durable, human-inspectable record per journey —
**bookkeeping, not the brief**:

```
aipe journey start  [--id <id>] [--workspace <dir>]   → mints/records a journey id
aipe journey record --journey <id> --repo <r> --specialist <s>
                    --branch <b> --worktree <p> [--pr <url>] [--status <s>]
aipe journey show   --journey <id>                    → prints the ledger
```

Stored at `<workspace>/.aipe/journeys/<id>.yaml`. `start` is the one place a
timestamp is read (overridable via `--id` for tests). This is optional scaffolding
for the coordinator and for `worktree list`/cleanup; the physical source of
truth for live worktrees remains git.

---

## 5. Boundary summary (CLI vs. coordinator vs. specialist)

| Actor | Owns |
|---|---|
| **`aipe` CLI** (zero-dep, tested, no LLM, no GitHub) | worktree lifecycle + per-worktree identity + `.git/info/exclude`; dispatch-law validation; journey ledger. |
| **Coordinator** (`SKILL.md` prompting) | decompose demand; sequence via `graph.yaml`; assemble briefs; run subagents into worktrees; collect results; present escalations to the PE; ensure each specialist opens a PR. |
| **Specialist** (subagent wearing the persona) | do the scoped task in its worktree; commit + push + open its PR; or escalate a cross-repo need. |

---

## 6. File layout (new)

```
<workspace>/.aipe/
  └── journeys/
       └── j-20260705-a1.yaml         ← durable journey ledger (audit)
<repo>/
  ├── .git/info/exclude               ← `.worktrees/` appended (local, untracked)
  └── .worktrees/
       └── j-20260705-a1-joaquim/     ← isolated checkout of aipe/j-20260705-a1/joaquim
```

The hiring brief has **no file** — it is assembled and passed in memory.

---

## 7. Implementation shape

New CLI module `src/worktree/` (Block 1, foundational — built first):
- `types.ts` — `WorktreeSpec` (repo, specialist, journey, slug, branch, path),
  result unions.
- `naming.ts` — pure branch/path/slug derivation from `(repo-path, journey,
  specialist)`; reuses `personaSlug`.
- `git.ts` — thin `Bun.spawn` wrappers (`worktreeAdd`, `worktreeRemove`,
  `worktreeList`, `setWorktreeIdentity`, `ensureExcluded`, `defaultBase`,
  `isDirtyOrUnpushed`), mirroring `make-workspace/git.ts`.
- `run.ts` — `createWorktree` / `listWorktrees` / `removeWorktree`
  orchestration (read brain → resolve path → git ops → output rows).
- `cli.ts` — `aipe worktree <create|list|remove>` arg parsing + `OK/WT/BLOCKED/ERROR`
  output convention.

New CLI module `src/dispatch/` (Block 2):
- `types.ts` — `DispatchEntry`, `Batch`, `Verdict`.
- `law.ts` — pure `validateBatch(batch, brain, personas)` → `OK | Reject[]`
  (same-repo, cap-16, existence). The heart of the law, unit-tested exhaustively.
- `cli.ts` — `aipe dispatch validate --input <batch.json>`.

New CLI module `src/journey/` (Block 2):
- `types.ts`, `ledger.ts` (read/merge/write `<id>.yaml`), `cli.ts`
  (`start|record|show`).

Wiring: register `worktree`, `dispatch`, `journey` in `src/cli.ts`'s
`SUBCOMMANDS` + `HELP`, each exporting `run(args): Promise<number>` behind the
established `import.meta.main` pattern.

New skill `skills/operate/SKILL.md` (Block 2) — the coordinator-facing
Operation flow: mint a journey → decompose the demand into per-repo tasks →
sequence via `graph.yaml` → for each batch: `aipe dispatch validate` → `aipe
worktree create` per entry → dispatch subagents with the §4.2 brief → collect
`delivered`/`escalate` → present escalations to the PE → confirm each PR →
`aipe worktree remove` once merged. The fully-onboarded SessionStart awareness
already gestures at this loop; the skill makes it executable.

### Build sequencing (this is where "begin building" lands)

1. **Block 1 — `src/worktree/`** (foundational, this cycle's TDD focus).
2. Block 2 — `src/dispatch/law.ts` + `aipe dispatch validate`.
3. Block 2 — `src/journey/` ledger.
4. Block 2 — `skills/operate/SKILL.md` + the brief/escalation prose in each
   persona `SKILL.md` (a small `hire-specialists/render.ts` copy-tweak, or a
   doc-only addition — decided in the plan).

---

## 8. Out of scope / deferred

- **Headless-session dispatch** (persona mode B run autonomously) — rejected
  this cycle (decision 1); revisit only if subagent isolation proves
  insufficient.
- **CLI-derived cross-repo sequencing** from `graph.yaml` — deliberately left
  to the coordinator (decision 3); the "CLI adjudica + sequencia" option was
  considered and rejected to avoid moving product judgement into the binary.
- **Persisting the hiring brief** — rejected (decision 2); only the journey
  ledger is durable.
- **HR budget/cost gate for extra contractors** (foundation spec §6 "specialist
  requests more contractors") — a later refinement on top of the law CLI; this
  cycle enforces the hard cap of 16 and same-repo serialization only.
- **`/aipe-add-repo`** (incremental repo addition) — separate roadmap item.
- **Release + Cloudflare wiring** — deferred debt, untouched (OPEN-DECISIONS.md).
- **Non-Claude-Code harness adapters** for dispatch/PR — the CLI is
  harness-agnostic by construction; only the `operate` `SKILL.md` (Claude Code
  adapter) ships this cycle.
```
