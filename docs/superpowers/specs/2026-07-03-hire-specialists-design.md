# `/hire-specialists` — design spec

> **As-built note (2026-07-04):** this step was renamed from
> `context-brain-generator` to `hire-specialists`, and its `state.yaml`
> phase from `generator` to `specialists`. The CLI shipped as a subcommand
> of the unified `aipe` binary (`aipe hire-specialists …`), not a
> standalone `bun …/cli.ts` entry point. See the packaging spec
> `2026-07-04-unified-cli-distribution-design.md` and dossier entry 05 for
> the as-built details; the design below is otherwise accurate.

**Date:** 2026-07-03
**Status:** Design approved — ready for implementation plan
**Depends on:** `docs/superpowers/specs/2026-07-01-aipe-context-brain-design.md` (§4 pipeline, §6 decisions, §8 open questions), `docs/superpowers/specs/2026-07-02-relationship-design.md` (`graph.yaml` format this cycle reads)

---

## 1. Purpose

Step 4 (last) of the AIPe onboarding pipeline. Once relations are discovered and
`stack` is backfilled (`state.phase.relationship == done`), `/hire-specialists`
materializes the **specialists** of the company analogy: for every repo in the
context, exactly **2 personas** — a **dev-fullstack** and a **QA** — each
installed as a two-mode skill inside that repo
(`<repo>/.claude/skills/<name>/SKILL.md`), plus a cross-repo registry entry in
`.aipe/personas.yaml`. This closes the last open item from the foundation spec
§8: the exact format of `personas.yaml`, and (empirically) the persona +
third-party-skill load order.

Same shape as `/relationship`: the coordinator dispatches agents that read
context (here: `brain.yaml` stack + `graph.yaml` relations) and write prose;
everything past "raw agent output on disk" is a deterministic, testable CLI.

---

## 2. Persona count and roles

**Always 1 dev-fullstack + 1 QA per repo — never more, never fewer,** regardless
of how polyglot a repo's detected `stack` is. A dev-fullstack persona is
expected to cover the repo's entire stack; splitting by sub-stack was
considered and rejected — `/relationship` doesn't produce sub-repo scoping, so
there is no reliable signal to split on, and the foundation spec's company
analogy treats a repo as one specialist's turf.

`role` is a closed enum: `coordinator | dev-fullstack | qa`. The coordinator
itself (name already declared in `brain.yaml.context.coordinator`) gets a
`personas.yaml` entry too, so the registry is a complete roster of the
"company," not just the repo-level hires.

---

## 3. Naming (interactive)

Mirrors `/context-brain`'s conversational style. For each repo, the SKILL.md
asks the PE for the dev-fullstack's name and the QA's name; the PE may answer,
or ask the coordinator to generate one. Any name left unanswered is filled by
the CLI from a small built-in name list. The CLI rejects/re-rolls collisions:
no two personas in the same context (including the coordinator) share a name.

---

## 4. Fan-out architecture

**One agent per (repo, role) pair — 2N agents total, dispatched together in a
single parallel batch** (not two waves of N). Dev and QA for the same repo are
siblings, not dependents — there is no reason for one to see the other's
output before writing, so batching them together minimizes wall-clock without
adding coordination complexity.

Each agent receives:
- Its assigned persona name and role (`dev-fullstack` or `qa`).
- The repo's `stack` (from `brain.yaml`).
- The repo's relations — every edge in `graph.yaml` where `from` or `to`
  equals this repo.
- The coordinator's name and the context name (for tone/identity grounding).

Per-agent result schema (forced structured output — the agent writes prose,
not YAML/frontmatter):

```json
{
  "repo": "embark",
  "role": "dev-fullstack",
  "name": "Joaquim",
  "body": "<markdown body for SKILL.md, below the frontmatter>"
}
```

`body` must contain two short sections — one instructing how this persona
behaves when dispatched as a subagent with a hiring brief (§6), one for when
the PE opens a session directly inside the repo and the persona is worn
interactively — sharing one identity/stack/scope grounding written once above
both sections.

**Staging:** each result is saved by the coordinator to
`.aipe/specialists/.reports/<repo>-<role>.json` before the CLI runs — same
inspectable/fixture-testable pattern as `/relationship`.

---

## 5. Deterministic materialization (the CLI)

Pure, testable TypeScript past "2N raw JSON reports on disk":

1. Read every `.reports/*.json` present. A missing `(repo, role)` pair is
   "missing," not an aborting error (§7).
2. **Validate** each report: `role` in the closed enum, `name` non-empty and
   unique across the whole batch, `body` non-empty.
3. **Assemble frontmatter deterministically** — `name` is the persona's name
   lowercased and kebab-cased (e.g. `Joaquim` → `joaquim`; also the directory
   name under `.claude/skills/`). `description` is built from a fixed
   template: `"<Role label> for the <repo> repo (<stack>). Dispatched by the
   coordinator for tasks scoped to <repo>, or worn directly when a session
   opens inside this repo."`, where `<Role label>` is `"Fullstack specialist"`
   for `dev-fullstack` and `"QA specialist"` for `qa`.
4. **Write** `<repo>/.claude/skills/<name>/SKILL.md` (frontmatter + agent's
   `body`).
5. **Write/update `.aipe/personas.yaml`** — full rewrite from the current
   batch plus the coordinator entry (read from `brain.yaml`), same
   full-overwrite posture as `/relationship`'s `graph.yaml`.
6. **Update `state.yaml`** — `state.phase.specialists = done` only if every repo
   has both a dev-fullstack and a QA report; otherwise `pending`. Other phases
   preserved.
7. **Delete `.reports/`** only when `done` — retained on partial failure so a
   retry can target just the missing `(repo, role)` pairs, same as
   `/relationship`.

**Re-running** after `done` re-dispatches all 2N agents and overwrites every
persona SKILL.md + `personas.yaml` from scratch — no incremental regeneration,
consistent with the rest of onboarding (rare, deliberate act).

---

## 6. Hiring brief — not a persisted artifact

The "hiring brief" (the object the coordinator hands a specialist when
dispatching a task) is **not** written to disk by this step. Each
persona's SKILL.md only documents, in prose, how that persona should interpret
a brief when it receives one (task description, relevant files, delivery
contract) via `Agent()`/Task dispatch. The brief's concrete shape is decided by
the coordinator at dispatch time, in future work sessions ("journeys") — out
of scope for this sub-project. This closes the foundation spec §8 open
question by deferring the artifact, not by inventing a template nobody has
exercised yet.

---

## 7. Partial failure

Same resilience posture as `/relationship` and `/make-workspace`: one failed
`(repo, role)` agent doesn't block the other 2N-1. The CLI processes whatever
reports exist; `state.phase.specialists` stays `pending` unless the full set is
present; the coordinator's final report to the PE lists exactly which
`(repo, role)` pairs are missing, so a retry can re-dispatch only those.

---

## 8. Two-mode persona content

Both sections (subagent / interactive) share one identity paragraph grounded
in the repo's `stack` and its `graph.yaml` relations (e.g. "you own `embark`,
which is consumed by `prontuario`'s patient API client — keep that contract in
mind"). The subagent section instructs: expect a hiring brief with a scoped
task, stay within this repo, report back through the coordinator, never touch
another repo. The interactive section instructs: the PE is talking to you
directly as this repo's specialist; behave like a fullstack dev/QA pairing
with them, same posture as any other Claude Code session but colored by this
persona's stack/relations awareness.

**Empirical validation (this cycle, no new code):** after implementation, one
test persona is generated, a real session is opened in its installed repo, and
a third-party skill (e.g. `superpowers:brainstorming`) is invoked to observe
whether the persona's identity survives loading a third-party skill on top of
it. Findings are recorded in dossier entry 05 — this is the "load order"
question from the foundation spec §6/§8, resolved by observation rather than
design.

---

## 9. File layout

```
<workspace>/.aipe/
  ├── brain.yaml                    ← read only (stack, context.coordinator)
  ├── state.yaml                    ← phase.specialists updated here
  ├── relations/graph.yaml          ← read only (relations per repo)
  ├── personas.yaml                 ← durable registry (coordinator + all personas)
  └── specialists/
       └── .reports/                ← transient staging, deleted after each run
            ├── embark-dev-fullstack.json
            ├── embark-qa.json
            └── ...
<repo>/.claude/skills/
  ├── <dev-name>/SKILL.md
  └── <qa-name>/SKILL.md
```

---

## 10. Implementation shape (mirrors `/relationship`)

- `src/hire-specialists/types.ts` — `PersonaRole`, `PersonaReport`,
  `PersonaRegistryEntry`, `SpecialistsPhase`.
- `src/hire-specialists/naming.ts` — pure name collision-checking +
  random-name fill from a built-in list.
- `src/hire-specialists/render.ts` — pure frontmatter + SKILL.md
  assembly from a validated `PersonaReport`.
- `src/hire-specialists/reports.ts` — disk report reading + deep
  validation (mirrors `relationship/reports.ts`'s enum/shape checking).
- `src/hire-specialists/registry.ts` — pure `personas.yaml`
  serialization from reports + coordinator entry.
- `src/hire-specialists/state.ts` — updates `state.phase.specialists`,
  preserving other phases.
- `src/hire-specialists/run.ts` — orchestrates: read reports dir →
  validate → write SKILL.md files → write `personas.yaml` → update state →
  conditional `.reports/` cleanup.
- `src/hire-specialists/cli.ts` — flag parsing (`--workspace`) +
  `renderReport` output, same style as `relationship/cli.ts`.
- `skills/hire-specialists/SKILL.md` — the coordinator-facing flow
  (naming questions, exact 2N `Agent()` schema, dispatch, staging, CLI
  invocation, output translation).

---

## 11. Out of scope

- Sub-repo persona splitting by detected sub-stack (§2).
- A persisted hiring-brief template/schema (§6) — deferred until a real
  journey exercises the shape.
- `/aipe-add-repo` — incrementally adding a repo's personas without
  regenerating the whole context (next sub-project per the foundation spec
  §7).
- Worktree-per-journey wiring for personas dispatched as subagents — a
  separate foundational sub-project already tracked in the roadmap.
