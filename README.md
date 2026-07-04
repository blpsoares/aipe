# AIPe — AI Product Engineer

AIPe is a framework, distributed as a Claude Code **plugin**, that turns Claude
into a general engineering coordinator and the user into a **Product Engineer
(PE)**. The PE brings demands (bugs, features, tasks spanning different repos);
the coordinator decomposes them, distributes them to specialists who work in
parallel, and returns deliverables (PRs) — always respecting the relationships
between the repos.

The central analogy is a company:

| Role | Who it is | Real mechanics |
|---|---|---|
| **PE** | The user. | User in command, approving between phases. |
| **Coordinator** | The main Claude, with a name set by the PE. | Workflow + the main loop reading results. |
| **Specialists (contractors)** | Devs hired per repo. | Subagents dispatched by the coordinator, materialized as skills installed inside each repo. |

Full design rationale: [`docs/superpowers/specs/2026-07-01-aipe-context-brain-design.md`](docs/superpowers/specs/2026-07-01-aipe-context-brain-design.md).

## Onboarding pipeline

A context (a team's group of repos) is set up in four ordered steps, each a
skill in this plugin:

```
1. /context-brain            → declare repos (URLs, paths) → .aipe/brain.yaml
2. /make-workspace            → clone the repos on disk
3. /relationship               → discover cross-repo relations + backfill stack
4. /context-brain-generator    → generate persona skills (1 dev-fullstack + 1 QA per repo)
```

Each step's precondition is the previous step's `state.yaml` phase being
`done`; running any step re-reads what's already there and only fills in
what's missing.

## Status

| # | Sub-project | Status | Dossier |
|---|---|---|---|
| 1 | `/context-brain` — factual map of a context | Merged | [docs/dossie/01-context-brain.md](docs/dossie/01-context-brain.md) |
| 2 | `/make-workspace` — clone the repos | Merged | [docs/dossie/02-make-workspace.md](docs/dossie/02-make-workspace.md) |
| 3 | `SessionStart` hook — coordinator context injection | Merged | [docs/dossie/03-session-hook.md](docs/dossie/03-session-hook.md) |
| 4 | `/relationship` — cross-repo relationship discovery | Merged | [docs/dossie/04-relationship.md](docs/dossie/04-relationship.md) |
| 5 | `/context-brain-generator` — persona skills | In progress (branch `feat/context-brain-generator`) | [docs/dossie/05-context-brain-generator.md](docs/dossie/05-context-brain-generator.md) (pending) |
| 6 | Worktree-per-journey (foundational) | Not started | — |
| 7 | `/aipe-add-repo` — incremental repo addition | Not started | — |

Once sub-project 5 merges, the full onboarding pipeline (steps 1-4 above) is
complete; sub-projects 6-7 are future work beyond onboarding.

## Repository layout

```
skills/<name>/SKILL.md        # coordinator-facing conversational flow for each onboarding step
src/<name>/                   # deterministic TypeScript CLI backing each skill (types, logic, cli.ts, __tests__/)
hooks/session-start            # SessionStart hook: injects coordinator "awareness" from .aipe/ state
docs/superpowers/specs/        # design specs (brainstorming output), one per sub-project
docs/superpowers/plans/        # implementation plans, one per sub-project
docs/dossie/                   # execution ledger: decisions, plan, review findings, final state per sub-project
```

A workspace using this plugin (e.g. `aipe-opvibes/`) holds the context
artifacts in `.aipe/` (`brain.yaml`, `state.yaml`, `relations/`,
`personas.yaml`) and the cloned repos as siblings, each with persona skills
installed at `<repo>/.claude/skills/<persona-name>/`.

## Development

- Runtime: [Bun](https://bun.sh) + TypeScript strict.
- Tests: `bun test`.
- Type-check: `bunx tsc --noEmit -p tsconfig.json`.
- Every sub-project is built through brainstorming → a written design spec →
  an implementation plan → subagent-driven TDD execution → task + whole-branch
  review → a dossier entry recording the decisions and findings. See
  `docs/dossie/README.md` for the convention.
- The repository (code, specs, plans, skills, docs, commit messages) is
  English-only; interaction with the PE may happen in any language.
