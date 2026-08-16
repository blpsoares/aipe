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
| **PE** | The user. CEO/Product: sets the mission, priority, approves budget, decides cross-repo matters. | User in command, approving between phases. |
| **Coordinator** | The main Claude, with a name set by the PE. | Reads the state, decomposes demands, dispatches, reviews, escalates. |
| **Specialists (contractors)** | Devs hired per repo (1 dev-fullstack + 1 QA). | Subagents dispatched by the coordinator, materialized as persona skills installed inside each repo. |

Full design rationale: [`docs/superpowers/specs/2026-07-01-aipe-context-brain-design.md`](docs/superpowers/specs/2026-07-01-aipe-context-brain-design.md).

## The two phases

AIPe has two phases, both complete:

- **(A) Onboarding** — map a context (a team's group of repos): declare them,
  clone them, discover their cross-repo relations, and hire each repo's
  specialists.
- **(B) Operation** — the coordinator receives a demand, decomposes it,
  dispatches the per-repo specialists in isolated git worktrees under the
  parallel-dispatch law, each delivers a PR, and cross-repo matters escalate to
  the PE. Workspaces are publishable/portable, can be equipped with extra
  skill-packages + MCPs (the "toolbox"), grow one repo at a time
  (`/aipe-add-repo`), and can be watched live (`aipe dashboard`).

The guiding invariant throughout: **everything past raw agent output on disk is
a deterministic, tested `aipe` CLI**; the coordinator's judgement lives in
`SKILL.md` prose.

## (A) Onboarding pipeline

A context is set up in four ordered steps, each a skill in this plugin:

```
1. /context-brain      → declare repos (URLs, paths) → .aipe/brain.yaml
2. /make-workspace     → clone the repos on disk (+ rehydrate personas/toolbox)
3. /relationship       → discover cross-repo relations + backfill stack → .aipe/relations/
4. /hire-specialists   → hire persona skills (1 dev-fullstack + 1 QA per repo) → .aipe/personas.yaml
```

Each step's precondition is the previous step's `state.yaml` phase being
`done`; running any step re-reads what's already there and only fills in
what's missing. The `SessionStart` hook injects the coordinator's "awareness"
and drives each step conversationally — just open the workspace and say hi.

## (B) Operation

Once onboarding is `done`, a demand from the PE runs through the `/operate`
skill:

1. **Open a journey** (`aipe journey start`) — one demand = one journey.
2. **Decompose** the demand into per-repo tasks and **sequence** them into
   waves using `.aipe/relations/graph.yaml` (a dependency-first order).
3. For each wave: **validate the dispatch law** (`aipe dispatch validate`),
   **provision a worktree per specialist** (`aipe worktree create`), and
   **dispatch each specialist as a subagent** wearing its persona, confined to
   its worktree, with an ephemeral **hiring brief**.
4. Collect results: `delivered` (a PR) or `escalate` (a cross-repo need).
5. **Escalate cross-repo matters to the PE** — cross-repo scope is the PE's
   call. On approval, the next wave targets the other repo, dependency-first.
6. On merge, tear worktrees down (`aipe worktree remove` / `prune`).

`aipe dashboard` shows all of this live in the terminal (workers by status,
the pipeline, worktrees). The responsive **web console** (`aipe serve`) is the
same view in the browser — see [Web console](#web-console-aipe-serve) below.

### Portability & publishing

A workspace is a **publishable git repo**: `aipe start` writes an allowlist
`.gitignore` so only the AIPe "brain" (`.aipe/` + `.claude/`) is published —
never the cloned repos, their worktrees, or secrets. Personas are stored in
`.aipe/personas/` (committed) and **rehydrated** into re-cloned repos by
`aipe rehydrate` (also run automatically by `/make-workspace`), so the PE can
continue on another machine without redoing onboarding.

### Toolbox — extra skill-packages + MCPs

`/toolbox` equips the context with frameworks (e.g. an SDD kit) and MCP servers,
catalogued in `.aipe/toolbox.yaml` (published). Skills install per repo; MCPs at
workspace scope (shared by all specialist subagents) or per repo. A structured
`routing` hint + `aipe skill match` let the coordinator pick the right tool
mechanically (so it doesn't spawn a heavy framework for a trivial edit). The full
lifecycle is add · list · match · **remove** (`aipe skill|mcp remove <name>`
uninstalls the catalog entry and every installed copy, keeping other tools
intact).

### Incremental growth — `/aipe-add-repo`

Add one repo to an already-onboarded context without redoing onboarding:
`aipe add-repo` appends it, `/make-workspace` clones just it, `aipe relationship
--merge` folds its relations into the existing graph, and `aipe hire-specialists
--merge` hires its personas — **preserving every existing persona and its name**.

### Web console — `aipe serve`

`aipe serve` starts a **zero-dependency** Bun HTTP server (default
`127.0.0.1:4317`) rendering the whole company as a **responsive web app** — two
purpose-built experiences, not one reflowed layout:

- **Desktop cockpit:** the org chart as an interactive SVG graph (coordinator hub
  → repo clusters → specialist nodes colored by state, over the relation edges),
  a pipeline **board** (columns = stages, cards = dispatches with PRs), and a
  detail panel for the selected worker/repo/dispatch.
- **Mobile flow:** a tab bar over workers-by-repo, a collapsible org tree, and a
  per-journey pipeline timeline.

It reads the **same extended `buildSnapshot`** the TUI dashboard uses, updates
**live over SSE** (`fs.watch` on `.aipe/` + a reconcile safety net — realtime, no
lost update), and is **theme-aware** (light/dark). The SPA is self-contained
(HTML/CSS/JS inlined, embedded in the binary via a text import, no external CDN),
so `--compile` keeps working. Everything stays local; nothing leaves the machine.
It binds localhost by default.

```sh
aipe serve                       # http://127.0.0.1:4317
aipe serve --port 8080 --workspace ../aipe-opvibes
```

### Execution-envelope recommendation — `aipe capabilities` / `aipe execution`

Every dispatch has four axes: `mode` (in-process subagent vs. a detached
session), `intensity` (normal vs. `ultracode`), `harness` and `tier`/`model`.
Left to guesswork, the cheapest correct choice rarely gets made. `aipe start`
already probes this machine's harness binaries automatically and writes
`.aipe/capabilities.yaml` — a claim with a date, not a fact, so it stays
unconfirmed until you run `aipe capabilities confirm` (the PE's word
overriding it). Even if that record is somehow missing, `aipe execution
propose --journey <id>` self-heals: it probes right there, says so, and
proceeds — it only refuses if that probe finds no usable harness at all.
`propose` then crosses the record against `.aipe/execution-policy.yaml` and
prints, per unit, every *viable* envelope with a `cost-index` and a `GATED`
marker where the policy needs the PE's signature — it enumerates and prices,
it never chooses. Once the PE approves and the coordinator records the chosen
envelope per unit, `aipe execution plan --journey <id>` groups the recorded
choices into waves (session mode binds `--model` per wave, not per unit) and
reports the wave-level cost and any gate. **`cost-index` is a coarse relative
index, never money** — AIPe cannot know your token price, plan, or rate
limits. See [dossier 14](docs/dossie/14-execution-envelope.md).

### Session-mode dispatch — `aipe session`

A specialist is normally dispatched as an in-process **subagent**, sharing
the coordinator's context and lifetime. `aipe session dispatch --journey <id>`
instead starts it as a real, detached `agentop` session
with its own full context window (and, opted in, `ultracode`) — for units
heavy or long enough that a shared context would starve them. It records into
the journey ledger instead of returning; `aipe session collect --journey <id>`
polls and classifies each unit as `landed`, `running`, or `dead-silent`. A
per-harness containment hook stops a dispatched specialist from opening or
killing further sessions — `aipe session grant` is the only authorised
escape, and today its quota **cannot yet take effect**: `agentop` does not
stamp `AGENTOP_SESSION_ID` into the specialist's environment, so the
consuming side has nothing to check against (the command says so). Only
`claude-code` and `gemini` are containable today; `codex` and `copilot` each
require an interactive trust step AIPe's unattended dispatch cannot clear, so
`aipe dispatch validate` rejects them from session mode outright. `aipe
session doctor` reports whether `agentop` (>= 1.9.0, from the *agentistics*
project — not the unrelated npm package of the same name) is installed;
without it, `mode: session` is simply unavailable and every unit dispatches
as a subagent, unaffected. See [dossier 15](docs/dossie/15-session-dispatch.md).

## Status

| # | Sub-project | Status | Dossier |
|---|---|---|---|
| 1 | `/context-brain` — factual map of a context | Merged | [01](docs/dossie/01-context-brain.md) |
| 2 | `/make-workspace` — clone the repos | Merged | [02](docs/dossie/02-make-workspace.md) |
| 3 | `SessionStart` hook — coordinator context injection | Merged | [03](docs/dossie/03-session-hook.md) |
| 4 | `/relationship` — cross-repo relationship discovery | Merged | [04](docs/dossie/04-relationship.md) |
| 5 | `/hire-specialists` — persona skills | Merged | [05](docs/dossie/05-hire-specialists.md) |
| — | Unified `aipe` CLI + zero-dependency distribution | Merged | [06](docs/dossie/06-unified-cli-distribution.md) |
| 6 | **Phase B — Operation** (worktree · dispatch · journey · `/operate` · dashboard) + portability + toolbox + `/aipe-add-repo` | Merged | [07](docs/dossie/07-phase-b-operation.md) |
| 7 | **AIPe Web Console** (`aipe serve` — responsive org chart · pipeline · detail · embedded terminal, live over SSE) | Built | [08](docs/dossie/08-web-console.md) |
| 8 | **Monorepo package granularity** (`package` as the unit of work) + toolbox uninstall | Built | [09](docs/dossie/09-module-granularity.md) |
| 9 | **Spec-first operation** (coordinator Orientation Spec + PE gate + specialist SDD) | Built | [10](docs/dossie/10-spec-first-operation.md) |
| 10 | **Model policy** (`aipe model` — model selection by tier + authorization/volume gates) | Built | [12](docs/dossie/12-model-policy.md) |
| 11 | **Toolbox kits** (`aipe skill add sdd-lite\|spec-kit\|pdd` + `aipe skill preset` — vendored Spec Kit, wired PDD plugin) | Built | — |
| 12 | **`/handoff`** (portable `CLAUDE.md` export for a collaborator who won't install AIPe) | Built | [13](docs/dossie/13-handoff.md) |
| 13 | **Execution-envelope recommendation** (`aipe capabilities probe\|show\|confirm`, `aipe execution propose\|plan`) | Built | [14](docs/dossie/14-execution-envelope.md) |
| 14 | **Session-mode dispatch** (`aipe session dispatch\|collect\|grant\|doctor\|guard` via `agentop`) | Built | [15](docs/dossie/15-session-dispatch.md) |

### Roadmap (pending)

| Item | Notes |
|---|---|
| Persona load-order validation | Needs a live interactive session (persona identity surviving a third-party skill loaded on top). Can't be done autonomously. |
| Harness adapters beyond Claude Code | The `aipe` CLI is already harness-agnostic; an adapter needs another harness to target + validate against. Deferred. |
| Non-Claude-Code harness adapters | The `aipe` CLI is already harness-agnostic; only the skills are Claude-Code-shaped. Deferred (Claude Code suffices for now). |
| Release + Cloudflare wiring | Deferred debt — see [`OPEN-DECISIONS.md`](OPEN-DECISIONS.md). Publish the release, then create the redirect rules. |
| Codex/Copilot session-mode containment | Both CLIs gate on an interactive trust step (Codex: per-hook-hash `/hooks` trust; Copilot: directory trust) that AIPe's unattended dispatch cannot clear headlessly today, so their adapters return `containmentHook(): null` and stay ineligible. Needs a documented non-interactive bypass from either CLI. |
| `aipe session grant` redemption | The quota machinery is implemented and tested, but consuming it requires `agentop` to stamp `AGENTOP_SESSION_ID` into the specialist's environment, which it does not do yet. Blocked on that agentop-side change. |

## Laws & conventions

The rules the framework enforces (most as tested CLI, a few as skill prose):

- **Parallel-dispatch law** (the one law the coordinator can't break): the same
  repo **serializes** (never two dispatches on one repo at once), distinct repos
  run in **parallel**, capped at **16** concurrent. Adjudicated by
  `aipe dispatch validate`, never by hand.
- **Worktree-per-journey isolation:** each dispatch works in
  `<repo>/.worktrees/<journey>-<slug>/` on branch `aipe/<journey>/<slug>`.
  `.worktrees/` is excluded via `.git/info/exclude` (never a tracked
  `.gitignore`). `remove`/`prune` refuse to delete uncommitted or unpushed work
  unless `--force`.
- **PR attribution:** commits carry the persona as a **namespaced git author
  name** (`aipe/<Persona>`, set per-worktree via `extensions.worktreeConfig`),
  with `user.email` **inherited** so the PE's real account is the true author.
  Each **specialist opens its own PR**.
- **Hiring brief:** a canonical shape (task, worktree, branch, relevant
  relations, delivery contract, escalation trigger) assembled at dispatch and
  **never persisted** — the durable record is the journey ledger + the PRs.
- **Cross-repo escalation:** a specialist never edits another repo; it escalates
  the need to the coordinator, who takes it to the **PE** (cross-repo scope is
  the PE's decision).
- **Publish the brain, never the repos or secrets:** allowlist `.gitignore`;
  personas stored in `.aipe/` and rehydrated, not regenerated.
- **Secrets never enter the published catalog:** `aipe mcp add` refuses literal
  secrets in an MCP config (env references only; `--allow-secrets` overrides).
- **Non-destructive growth:** `--merge` modes for relations and personas fold a
  new repo in without disturbing existing edges/personas.
- **Session containment:** a specialist dispatched via `aipe session dispatch`
  can never open or kill an `agentop` session — every containable harness's
  adapter writes a `PreToolUse`-shaped hook into **that unit's own worktree**
  (never the PE's own workspace) that denies it. `aipe session grant` is the
  only authorised escape, and it is scoped to one `(journey, session)` pair.
- **English-only repository:** code, specs, plans, skills, docs, and commit
  messages are English; interaction with the PE may happen in any language.

## Install & use

```sh
# 1. Install the aipe binary (no Bun/Node/npm needed)
curl -fsSL https://aipe.openvibes.tech/cli | sh

# 2. Create a workspace. `aipe start` is a plain terminal program (no AI):
#    it shows an arrow-key list of harnesses, asks the workspace name,
#    creates aipe-<name>/ (a publishable git repo) with the integration inside,
#    and probes this machine's harness binaries automatically — no separate
#    step needed before the coordinator can propose a priced dispatch envelope.
aipe start
#    ? Choose your agent harness:  ❯ Claude Code
#    ? Workspace name:  minha-empresa
#    aipe: checked which harnesses are available on this machine:
#    aipe:  - OK claude-code claude 2.1.4
#    aipe:  - NOTE capabilities: probed, not confirmed — a binary on PATH is
#             not an authenticated binary. Run `aipe capabilities confirm`
#             once you have checked.
#    ✓ Created aipe-minha-empresa/

# 3. Open that folder in your harness and just say hi.
cd aipe-minha-empresa && claude
#    The coordinator asks for your repos and drives onboarding; after each step
#    it tells you to open a NEW session to continue — no slash commands to memorize.
#    Once onboarded, bring a demand and it runs /operate.
```

Two surfaces: **`aipe start`** (terminal, deterministic) picks the harness and
creates the self-contained, publishable `aipe-<name>/` workspace; the
**coordinator** (the LLM, inside the harness) runs onboarding and then operates.
The install is **project-scoped** — `.claude/settings.json` (a `SessionStart`
hook calling `aipe session-context`) plus the skills live in the folder, so
nothing is installed globally and no marketplace/plugin step is required. The
same project-scoped integration is installed **inside each specialist repo** too
(by `/hire-specialists`, and repaired by `aipe rehydrate`), so opening a session
directly in a repo gets that repo's persona-scoped context instead of the
coordinator's.

Today `aipe start` only offers **Claude Code** and the experimental
**generic/AGENTS.md** adapter as a *workspace* harness — Codex, Gemini,
Copilot, Antigravity and Cursor are listed but `coming-soon` there. That is a
separate question from which harness a *unit* can be dispatched to under
session mode (below): a claude-code workspace can still dispatch a QA unit to
`gemini`, since that only needs the `gemini` binary present, not a supported
`aipe start` integration for it.

One more step becomes relevant once you are operating, and it's optional:

```sh
# 4. `aipe start` already probed your capabilities (unconfirmed — a binary on
#    PATH is not an authenticated binary). Once you've actually checked what
#    it found, put your word on record:
aipe capabilities confirm
#    Skipping this is fine too: `aipe execution propose` still runs on an
#    unconfirmed record (it just prints a NOTE saying so on every line), and
#    if a workspace somehow has no capabilities record at all, `propose`
#    probes automatically right there rather than refusing outright.
#    `aipe capabilities probe` re-runs the detection by hand — useful right
#    after installing a new harness binary — and `aipe capabilities show`
#    flags drift (a recorded harness that has since appeared or vanished).

# 5. For session-mode dispatch (a specialist running as its own detached
#    agentop session instead of an in-process subagent), install agentop
#    (>= 1.9.0, from the agentistics project — NOT the unrelated npm package
#    of the same name) and check it:
aipe session doctor
#    Without agentop, mode: session is simply unavailable; every unit
#    dispatches as a subagent, which needs nothing extra and is the default.
```

## Requirements & distribution

AIPe is meant to run for **anyone, in any agent harness, on any OS**. The
portable core is a single CLI (`aipe`):

- Onboarding: `start · context-brain · make-workspace · relationship ·
  hire-specialists · read-state · session-context`
- Handoff (standalone, no workspace): `handoff` — one-shot `CLAUDE.md`
  export for a collaborator who won't install AIPe.
- Operation & growth: `worktree · dispatch · journey · dashboard · serve ·
  rehydrate · skill · mcp · add-repo · capabilities · execution · session`

- **End users need no runtime.** The CLI compiles to a standalone executable
  per OS/arch (`bun build --compile`), so there's **no Bun, Node, or npm**
  requirement on the host. The `bin/aipe` launcher (and `bin/aipe.cmd` on
  Windows) resolves the right binary: `$AIPE_BIN` → `dist/<host>` → cached
  download → **Bun dev fallback** (only when developing in this repo) →
  best-effort download from the GitHub release.
- **Any harness.** Claude Code integration (the slash-command skills + the
  `SessionStart` hook) is just one adapter over that CLI; another harness only
  needs to call the `aipe` binary. The generated persona files are plain
  Markdown skills.
- **Building the binaries:** `bun run build` (all targets) or
  `bun run build:host`. CI (`.github/workflows/release.yml`) builds every target
  on a `v*` tag and attaches them to a GitHub Release.

Developers of AIPe itself still use Bun (see Development below).

## Repository layout

```
src/cli.ts                    # unified `aipe` entry point: dispatches every subcommand
src/<name>/                   # deterministic TS per capability (types, logic, cli.ts run(), __tests__/)
  context-brain, make-workspace, relationship, hire-specialists, start, session-hook   # onboarding
  worktree, dispatch, journey, rehydrate, toolbox, add-repo, dashboard, serve, handoff  # operation & growth
  capabilities, execution, session                                                      # envelope recommendation + agentop dispatch
bin/aipe, bin/aipe.cmd        # launchers: pick the standalone binary for the host (or Bun dev fallback)
scripts/build.ts              # cross-platform `bun build --compile` into dist/ (gitignored)
skills/<name>/SKILL.md        # coordinator-facing flows (Claude Code adapter):
                              #   onboarding (context-brain, make-workspace, relationship, hire-specialists)
                              #   operation  (operate, toolbox, aipe-add-repo)
hooks/session-start           # SessionStart hook: injects coordinator awareness via `aipe session-context`
.github/workflows/release.yml # builds all target binaries → GitHub Release
docs/superpowers/specs/       # design specs (brainstorming output), one per sub-project
docs/superpowers/plans/       # implementation plans
docs/dossie/                  # execution ledger: decisions, plan, review, final state per sub-project
```

A workspace using this plugin (e.g. `aipe-opvibes/`) is itself a git repo:

```
aipe-opvibes/
  ├── .gitignore                 # allowlist: publish .aipe/ + .claude/, ignore repos/secrets
  ├── .aipe/
  │    ├── brain.yaml            # repos (URLs, paths, stacks)
  │    ├── state.yaml            # onboarding phases
  │    ├── relations/graph.yaml  # cross-repo edges (+ README.md)
  │    ├── personas.yaml         # roster (coordinator + specialists)
  │    ├── personas/<repo>/<slug>/SKILL.md   # published persona sources (for rehydrate)
  │    ├── toolbox.yaml          # skill-packages + MCP catalog
  │    ├── skills/<name>/SKILL.md# published toolbox-skill sources
  │    ├── journeys/<id>.yaml    # per-demand dispatch ledger (audit)
  │    ├── journeys/<id>/orientation.md    # the approved Orientation Spec (scope + per-unit envelope)
  │    ├── journeys/<id>/prompts/<fqid>.md # session-mode: exactly what each specialist was told
  │    ├── journeys/<id>/grants/<sessionId>/  # session-mode: spawn-quota tokens issued via `aipe session grant`
  │    ├── capabilities.yaml     # what this machine can run (probed automatically by `aipe start`; `aipe capabilities probe|show|confirm`)
  │    └── execution-policy.yaml # wave-level spending limits (optional; conservative defaults if absent)
  ├── .claude/                   # SessionStart hook + AIPe skills
  └── <repo>/                    # cloned repo (NOT published), with:
       ├── .claude/skills/<persona>/SKILL.md   # installed persona (rehydratable)
       └── .worktrees/<journey>-<slug>/        # isolated dispatch working trees
```

## Development

- Runtime (for developing AIPe): [Bun](https://bun.sh) + TypeScript strict.
  End users of the plugin need no runtime — see "Requirements & distribution".
- Tests: `bun test`. Type-check: `bunx tsc --noEmit -p tsconfig.json` (or
  `bun run typecheck`). One known environment-only test failure exists
  (`make-workspace/git.test.ts`, a git-remote URL rewrite specific to some
  sandboxes; passes on a clean runner).
- Build standalone binaries: `bun run build` (all) / `bun run build:host`.
- Every sub-project is built through brainstorming → a written design spec →
  an implementation plan → TDD execution → review → a dossier entry. See
  [`docs/dossie/README.md`](docs/dossie/README.md) for the convention.
- The repository is **English-only**; interaction with the PE may happen in any
  language.
