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
1. /context-brain      → declare repos (URLs, paths) → .aipe/brain.yaml
2. /make-workspace     → clone the repos on disk
3. /relationship       → discover cross-repo relations + backfill stack
4. /hire-specialists   → hire persona skills (1 dev-fullstack + 1 QA per repo)
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
| 5 | `/hire-specialists` — persona skills | Merged | [docs/dossie/05-hire-specialists.md](docs/dossie/05-hire-specialists.md) |
| — | Unified `aipe` CLI + zero-dependency distribution | Merged | [docs/dossie/06-unified-cli-distribution.md](docs/dossie/06-unified-cli-distribution.md) |
| 6 | Phase B — Operation (worktree, dispatch, journey, operate) + portability, toolbox, `/aipe-add-repo` | Implemented (branch `claude/phase-b-operation-design-17ytcc`) | [docs/dossie/07-phase-b-operation.md](docs/dossie/07-phase-b-operation.md) |

With sub-project 5 the onboarding pipeline (steps 1-4) is complete; Phase B —
Operation is now implemented: the coordinator receives a demand, dispatches
per-repo specialists in isolated git worktrees under the parallel-dispatch law,
each delivers a PR, and cross-repo matters escalate to the PE. Workspaces are
also publishable/portable, can be equipped with extra skill-packages + MCPs
(the "toolbox"), and grow one repo at a time via `/aipe-add-repo`. See
[`docs/dossie/07-phase-b-operation.md`](docs/dossie/07-phase-b-operation.md).

## Install & use

```sh
# 1. Install the aipe binary (no Bun/Node/npm needed)
curl -fsSL https://aipe.blpsoares.dev/cli | sh

# 2. Create a workspace. aipe start is a plain terminal program (no AI):
#    it shows an arrow-key list of harnesses, asks the workspace name,
#    and creates aipe-<name>/ with the integration inside.
aipe start
#    ? Choose your agent harness:  ❯ Claude Code
#    ? Workspace name:  eletromidia
#    ✓ Created aipe-eletromidia/

# 3. Open that folder in your harness and just say hi.
cd aipe-eletromidia && claude
#    The coordinator (the AI) asks for your repos and drives onboarding;
#    after each step it tells you to open a NEW session to continue —
#    no slash commands to memorize.
```

Two surfaces: **`aipe start`** (terminal, deterministic) picks the harness and
creates the self-contained `aipe-<name>/` workspace; the **coordinator** (the
LLM, inside the harness) collects the repos and runs the four onboarding steps.
The install is **project-scoped** — `.claude/settings.json` (a `SessionStart`
hook calling `aipe session-context`) plus the onboarding skills live in the
folder, so nothing is installed globally and no marketplace/plugin step is
required.

## Requirements & distribution

AIPe is meant to run for **anyone, in any agent harness, on any OS**. The
portable core is a single CLI (`aipe`). Onboarding subcommands: `start |
context-brain | make-workspace | relationship | hire-specialists | read-state |
session-context`. Operation + growth subcommands: `worktree | dispatch |
journey | dashboard | rehydrate | skill | mcp | add-repo`. A responsive web
console (`aipe serve`) is the planned final surface — see
`docs/superpowers/specs/2026-07-05-web-console-design.md`.

- **End users need no runtime.** The CLI compiles to a standalone executable
  per OS/arch (`bun build --compile`), so there's **no Bun, Node, or npm**
  requirement on the host. The `bin/aipe` launcher (and `bin/aipe.cmd` on
  Windows) resolves the right binary for the machine: `$AIPE_BIN` →
  `dist/<host>` → cached download → **Bun dev fallback** (only when developing
  in this repo) → best-effort download from the GitHub release.
- **Any harness.** Claude Code integration (the slash-command skills + the
  `SessionStart` hook) is just one adapter over that CLI; another harness only
  needs to call the `aipe` binary. The generated persona files are plain
  Markdown skills.
- **Building the binaries:** `bun run build` (all targets) or `bun run
  build:host`. CI (`.github/workflows/release.yml`) builds every target on a
  `v*` tag and attaches them to a GitHub Release, which is what the launcher
  downloads from.

Developers of AIPe itself still use Bun (see Development below).

## Repository layout

```
src/cli.ts                    # unified `aipe` entry point: dispatches subcommands
src/<name>/                   # deterministic TypeScript backing each step (types, logic, cli.ts run(), __tests__/)
bin/aipe, bin/aipe.cmd        # launchers: pick the standalone binary for the host (or Bun dev fallback)
scripts/build.ts              # cross-platform `bun build --compile` into dist/ (gitignored)
skills/<name>/SKILL.md        # coordinator-facing conversational flow for each onboarding step (Claude Code adapter)
hooks/session-start            # SessionStart hook: injects coordinator "awareness" via `aipe read-state`
.github/workflows/release.yml  # builds all target binaries → GitHub Release
docs/superpowers/specs/        # design specs (brainstorming output), one per sub-project
docs/superpowers/plans/        # implementation plans, one per sub-project
docs/dossie/                   # execution ledger: decisions, plan, review findings, final state per sub-project
```

A workspace using this plugin (e.g. `aipe-opvibes/`) holds the context
artifacts in `.aipe/` (`brain.yaml`, `state.yaml`, `relations/`,
`personas.yaml`) and the cloned repos as siblings, each with persona skills
installed at `<repo>/.claude/skills/<persona-name>/`.

## Development

- Runtime (for developing AIPe): [Bun](https://bun.sh) + TypeScript strict.
  End users of the plugin need no runtime — see "Requirements & distribution".
- Tests: `bun test`.
- Type-check: `bunx tsc --noEmit -p tsconfig.json` (or `bun run typecheck`).
- Build standalone binaries: `bun run build` (all targets) / `bun run build:host`.
- Every sub-project is built through brainstorming → a written design spec →
  an implementation plan → subagent-driven TDD execution → task + whole-branch
  review → a dossier entry recording the decisions and findings. See
  `docs/dossie/README.md` for the convention.
- The repository (code, specs, plans, skills, docs, commit messages) is
  English-only; interaction with the PE may happen in any language.
