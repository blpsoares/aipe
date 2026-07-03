# `/relationship` — design spec

**Date:** 2026-07-02
**Status:** Design approved — ready for implementation plan
**Depends on:** `docs/superpowers/specs/2026-07-01-aipe-context-brain-design.md` (§4 pipeline, §6 decisions, §8 open questions)

---

## 1. Purpose

Step 3 of the AIPe onboarding pipeline. Once all repos are materialized on disk
(`state.phase.workspace == done`), `/relationship` discovers how the repos in a
context relate to each other — code dependencies, API/network contracts, shared
infrastructure, shared packages — and documents that as cross-repo knowledge in
`.aipe/relations/`. It also backfills the `stack` field in `brain.yaml`, since it
already reads each repo's code in depth (closes the open question from the
foundation spec §8).

This is the first AIPe skill that requires **deep code reading** to do its job — a
plain deterministic CLI can't discover "does repo A call an endpoint exposed by
repo B" reliably. That reading happens live, at runtime, via subagents dispatched
by the coordinator; everything downstream of that (merging, writing files, state)
is deterministic, testable code — same shape as `/context-brain` and
`/make-workspace`.

---

## 2. Scope of a "relation"

A relation is one of five closed types:

| Type | Meaning |
|---|---|
| `imports` | Repo A imports/requires a package or path published by repo B |
| `published-by` | Inverse of `imports` — repo B publishes something repo A imports |
| `consumes` | Repo A calls an API/endpoint exposed by repo B (HTTP, gRPC, GraphQL) |
| `exposed-by` | Inverse of `consumes` — repo B exposes an API repo A calls |
| `shares-infra` | Repos A and B share infrastructure (same DB, queue, bucket, env) — symmetric |

The enum is closed and forced via a JSON schema on the agent call. A closed enum is
required for the deterministic merge step (§5) to reliably pair complementary
edges — free-text classification can't be matched programmatically with
confidence.

---

## 3. Fan-out architecture

**One subagent per repo, not per relation type.** Fan-out width = number of repos
in the context. Each agent:

- Has read-only access to exactly one repo (its own).
- Receives, in its prompt, the full list of other repos in the context (name +
  already-known stack from `brain.yaml`, if any) so it knows what names/URLs to
  look for cross-references to.
- Returns one structured result covering **all** relation types it found, plus
  the stack it detected for its own repo — one schema-forced call per repo, not
  one per (repo, type) pair. This keeps the token cost at N agents regardless of
  how many relation types exist.

Per-repo result schema:

```json
{
  "repo": "embark",
  "stack": ["typescript", "bun"],
  "relations": [
    {
      "to": "prontuario",
      "type": "consumes",
      "detail": "calls GET /api/patients via a generated HTTP client",
      "evidence": "src/clients/prontuario.ts:12"
    }
  ]
}
```

- `relations` may be empty.
- `stack` is the agent's best detection from manifest files (`package.json`,
  `Cargo.toml`, etc.) and directory conventions — same granularity as the
  `stack: string[]` field already in `brain.yaml`.

**Fan-out mechanism:** the SKILL.md instructs the coordinator to dispatch N
`Agent()` calls in parallel at runtime (general-purpose/read-only agents), not a
formal `Workflow()` script — consistent with AIPe's default (Workflow is reserved
for explicit multi-agent orchestration requests). Each agent's structured result
is saved by the coordinator to a staging file:

```
.aipe/relations/.reports/<repo-name>.json
```

This makes each raw report inspectable for debugging and gives the merge CLI
fixture-testable inputs, without needing network or live agents in tests.

---

## 4. Precondition and coordinator flow

**Precondition:** `state.phase.workspace == done`. If not met, the SKILL.md
guides the PE to run `/make-workspace` first — there's no point discovering
relations in repos that aren't cloned yet.

Coordinator flow (defined in `skills/relationship/SKILL.md`):

1. Confirm the workspace (default: current directory, must have
   `.aipe/brain.yaml`).
2. Check `state.phase.workspace == done`; if not, stop and guide the PE.
3. Read `brain.yaml` to get the repo list.
4. Dispatch one `Agent()` per repo, in parallel, forcing the schema from §3.
5. Write each result to `.aipe/relations/.reports/<repo>.json`.
6. Run the CLI:
   ```bash
   bun <plugin-path>/src/relationship/cli.ts --workspace <workspace>
   ```
7. Translate CLI output to the PE, one line per repo (`OK`, `MISSING`) plus a
   final `STATE relationship=done|pending` line — same style as
   `/make-workspace`'s `renderReport`.
8. If `pending`, list which repos are missing a report so the PE can decide to
   re-run just the coordinator dispatch for those (the CLI itself doesn't retry
   agents — that's the coordinator's job).

---

## 5. Deterministic merge (the CLI)

Everything past "N raw JSON reports on disk" is plain, testable TypeScript — no
LLM involved, mirroring `/make-workspace`'s `read.ts`/`clone.ts`/`run.ts` split.

**Steps:**

1. Read every `.reports/*.json` present. A repo with no report file is treated
   as "missing" (not an error that aborts the run — see §6).
2. **Merge complementary edges.** Fixed pair map:
   `consumes ↔ exposed-by`, `imports ↔ published-by`, `shares-infra` merges with
   itself (symmetric). Two edges merge when `from`/`to` are swapped and the types
   are complementary per the map. A merged edge keeps both sides' `detail` and
   `evidence` (as a small `perspectives` list), so divergence between the two
   reports stays visible instead of being silently dropped.
3. **Write `graph.yaml`** — the machine/LLM-optimized source of truth. A flat list
   of merged edges: `{ from, to, type, perspectives: [{ detail, evidence }] }`.
   This is what future agents (personas, `/context-brain-generator`) read
   programmatically — compact, complete, no prose overhead.
4. **Write `README.md`** — generated by a plain template function (not a second
   LLM pass) from the already-synthesized `graph.yaml`, grouped by repo, for the
   PE to skim. Purely derived — zero extra token cost, never a second source of
   truth.
5. **Backfill `stack` in `brain.yaml`.** For each repo with a report, if
   `repos[].stack` is empty/absent, set it to the agent-detected stack. If the PE
   already declared a stack, it is never overwritten.
6. **Update `state.yaml`.** `state.phase.relationship = done` only if every repo
   in `brain.yaml` has a report; otherwise `pending`. Other phases are preserved
   (same pattern as `updateWorkspacePhase`).
7. **Delete `.reports/`** — disposable staging, not part of the durable output.

**Re-running `/relationship`** (e.g. after new code lands in a repo) always
re-dispatches all N agents and overwrites `graph.yaml`/`README.md`/backfilled
`stack` from scratch. No incremental merge with a prior graph — `/relationship`
runs rarely enough (onboarding + deliberate refresh) that the cost of full
re-discovery is preferred over the risk of accumulating stale edges the agents
no longer detect.

---

## 6. Partial failure

If a subagent for one repo errors or times out, the other agents proceed
normally — same resilience posture as `/make-workspace` (spec §5, dossier 02
finding "Task 5"). The CLI processes whatever reports are present:

- `graph.yaml`/`README.md` are written from available data.
- `state.phase.relationship` stays `pending` unless every repo has a report.
- The coordinator's final report to the PE lists exactly which repos are
  missing, so a retry can target just those.

Nothing aborts the whole run because one agent failed — that would waste the
successful agents' work.

---

## 7. File layout

```
<workspace>/.aipe/
  ├── brain.yaml              ← stack backfilled here by /relationship
  ├── state.yaml              ← phase.relationship updated here
  └── relations/
       ├── graph.yaml         ← durable source of truth (edges list)
       ├── README.md          ← derived, human-readable
       └── .reports/          ← transient staging, deleted after each run
            ├── embark.json
            └── prontuario.json
```

---

## 8. Implementation shape (mirrors `/make-workspace`)

- `src/relationship/types.ts` — `RelationType`, `RepoReport`, `Edge`,
  `RelationshipPhase`.
- `src/relationship/merge.ts` — pure edge-merging heuristic (pairing map +
  fold), unit-testable with fixture JSON, no filesystem.
- `src/relationship/render.ts` — pure `graph.yaml` stringify + `README.md`
  template rendering.
- `src/relationship/backfill.ts` — pure `brain.yaml` stack backfill (only fills
  empty).
- `src/relationship/state.ts` — updates `state.phase.relationship`, preserving
  other phases (same shape as `make-workspace/state.ts`).
- `src/relationship/run.ts` — orchestrates: read reports dir → merge → render →
  backfill → update state → cleanup `.reports/`.
- `src/relationship/cli.ts` — flag parsing (`--workspace`) + `renderReport`
  output, same style as `make-workspace/cli.ts`.
- `skills/relationship/SKILL.md` — the coordinator-facing flow from §4,
  including the exact `Agent()` schema to force per repo.

---

## 9. Out of scope

- Automatic re-detection triggers (e.g. running `/relationship` on every commit)
  — it's always a deliberate PE-triggered act, like the rest of onboarding.
- Cross-context relations (relations to repos outside this workspace) — a
  context's `/relationship` only looks within its own `brain.yaml` repo list.
- `personas.yaml` / hiring-brief format that will read `graph.yaml` — deferred to
  the `/context-brain-generator` cycle per the foundation spec §8.
