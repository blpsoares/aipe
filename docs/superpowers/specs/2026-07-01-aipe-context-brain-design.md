# AIPe — AI Product Engineer

**Date:** 2026-07-01
**Status:** Design approved (foundation) — spec focused on `/context-brain`

---

## 1. Vision

AIPe is a framework (distributed as a Claude Code **plugin**) that turns
Claude into a **general engineering coordinator** and the user into a **Product Engineer
(PE)**. The PE brings demands (bugs, features, tasks spanning different scopes and repos);
the coordinator decomposes them, distributes them to **specialists** who work in parallel,
and returns deliverables (PRs) — always respecting the relationships between the repos.

The central analogy is that of a **company**:

| Role | Who it is | Real mechanics |
|---|---|---|
| **PE** | The user. CEO/Product: defines mission, priority, approves budget, decides cross-repo matters. | User in command, approving between phases |
| **Coordinator** | The main Claude. Manager/Head: receives demand, decomposes it, hires, reviews, escalates. Has a **name** set by the PE. | Workflow + the main loop reading results |
| **HR** | Hiring gate: validates a job opening against the ceiling and availability. | Policy function applied before spinning up an agent |
| **Specialists (contractors)** | Devs hired per task. Isolated scope, don't touch other repos, escalate upward. Have **names**. | Subagents (`agent()`) dispatched by the coordinator |

---

## 2. Terminology

- **Context / team** — a grouping of repos that belong to the same team/company.
- **Workspace** — the umbrella folder of a context, in the user's home directory, named
  `aipe-<context>` (e.g. `aipe-opvibes`). It's where the session is opened with the AIPe
  plugin installed at **folder scope**, and where the context artifacts and repos live.
- **Journey** — a work session between the PE and a coordinator. There can be several
  journeys in parallel; that's why work runs in isolated **worktrees**.
- **Brain file** — the factual map of the context (repos, URLs, paths, stacks).
- **Specialist / persona** — a "dev" with a name, materialized as a skill installed
  **inside the repo** it owns.

---

## 3. Persistence model (hybrid)

Artifacts have different natures and live in different places:

```
aipe-<context>/                     ← workspace (user's home dir, plugin at folder scope)
  ├── .aipe/
  │    ├── brain.yaml               ← map (URLs, paths, stacks)         [cross-repo]
  │    ├── relations/               ← output of /relationship           [cross-repo]
  │    ├── personas.yaml            ← registry (coordinator + contractors) [cross-repo]
  │    └── state.yaml               ← onboarding phase
  ├── <repo-a>/                     ← cloned by /make-workspace
  │    └── .claude/skills/<joaquim>/  ← persona skill installed IN the repo
  └── <repo-b>/
       └── .claude/skills/<maria>/
```

- **Context artifacts** (brain, relations, personas, state) → `.aipe/` in the workspace.
- **Persona skills** → inside each repo, so that opening a session directly in the repo
  automatically loads that specialist's persona.
- **The AIPe plugin** (the `/context-brain`, `/make-workspace`, etc. skills) is the
  *tool*; the artifacts above are the *data* it produces.

---

## 4. Onboarding pipeline (ordered by data dependency)

```
1. /context-brain          → URLs + paths + stacks (no cloning)       [no code needed]
2. /make-workspace (clone) → materializes the repos on the machine     [needs the brain's URLs]
3. /relationship           → fans out N agents that READ the code,
                             each discovers relations for its repo,
                             coordinator SYNTHESIZES and documents      [needs the repos present]
4. /hire-specialists → generates persona skills                 [needs stacks + relations]
```

Once the 4 steps are complete, the "coordinator onboarding" is done and the
**work sessions** (journeys / sessions N) begin.

---

## 5. `/context-brain` — detailed spec (current sub-project)

### Purpose
Produce the **brain file**: the factual map of a context, written to
`<workspace>/.aipe/brain.yaml`. It's purely knowledge — **no cloning, no code analysis**.
It's the source of truth the other 3 skills read.

### Input (interactive)
The skill runs conversationally and **the PE declares** the repos:
1. Asks for the **context name** (`context.name`).
2. Asks for the **coordinator name** (`context.coordinator`).
3. Receives the **repos** (URL + intended path). The PE can paste a list.
4. **Validates** whatever is possible without cloning (well-formed URL, non-colliding paths).
5. Writes `brain.yaml` and initializes `state.yaml`.

### Format — `brain.yaml`
```yaml
context:
  name: opvibes          # context/team name
  coordinator: Nicolas   # name the PE gave the coordinator
repos:
  - name: embark
    url: git@github.com:opvibes/embark.git
    path: ./embark         # relative to the workspace (portable across machines)
    stack: [typescript, bun]   # optional at this stage; filled in later if unknown
  - name: prontuario
    url: git@github.com:opvibes/prontuario.git
    path: ./prontuario
```

**Format choice: YAML** — because the PE will want to open and edit it by hand
(add a repo, fix a path). `stack` is optional at this phase: real stack detection
requires the code to be present, so it can either be declared by the PE or filled in
during clone/relationship.

### State — `state.yaml`
```yaml
phase:
  brain: done
  workspace: pending      # clone hasn't run yet
  relationship: pending
  specialists: pending
```
Any future session reads this and knows "where the coordinator left off." Triggering
each phase remains a deliberate act by the PE (control + cost).

### Workspace naming convention
`aipe-<context.name>` (e.g. `aipe-opvibes`). Ties it to the framework, inherits the
context's name, is short and sortable.

---

## 6. Design decisions already settled (for the next phases)

Recorded here so they don't get lost — each one becomes its own spec in its cycle.

- **Isolation by worktree:** every journey works in worktrees; parallel journeys
  don't collide. Suggested convention:
  `<repo>/.worktrees/<journey-id>-<specialist>/`.
- **Same-repo conflict = physical lock:** tasks in the same repo **serialize** (or
  use separate worktrees); different repos run in parallel freely. It's the one law
  the coordinator can't break.
- **Specialist pool (contractor model):** ceiling of **16 concurrent** (the tool's real
  concurrency limit). The specialist **requests** more contractors from the coordinator;
  the coordinator **analyzes** whether the demand justifies it (5? 2? none?) and **HR**
  validates against the ceiling and the cost. Expensive hires escalate to the PE.
- **Persona in two modes:** the persona skill needs to work both as (A) a **subagent**
  dispatched by the coordinator and (B) an **interactive persona** — the main Claude
  "wearing" the persona when opening a session in the repo, to pair directly with the PE.
- **Per-task progress file:** a standard scratchpad folder per task/specialist,
  **disposable** working context, deleted once resolved. **Guardrail rule:**
  nothing irreversible lives only there — the real deliverable is the **PR + git
  history**.
- **Delivery:** the specialist **always opens the final PR**.
- **Persona registry:** stores the coordinator's name + specialists' names by
  area/repo. On creation, the PE provides as many names as they want; the missing
  ones are generated randomly and saved.
- **Persona + third-party skills (SDD/PDD/superpowers):** load order — the
  persona skill loads first (establishes the context), then the third-party skill
  (e.g. `/speckit-specify`) operates within that context. **To be validated in a
  prototype.**

---

## 7. Roadmap (sub-projects, each with its own spec → plan → impl. cycle)

1. **`/context-brain`** — factual foundation. **(DONE, merged into main 2026-07-01.)**
2. **`/make-workspace`** — **clone-only:** materializes the brain's repos on the
   machine. See its own spec `2026-07-01-make-workspace-design.md`. Per-journey
   worktree setup is **out of scope** for this skill (became sub-project 3 below).
3. **Context-injection hook (`SessionStart`)** — **foundational** sub-project. See
   its own spec `2026-07-02-session-hook-design.md`. When opening a session in an
   `aipe-<context>/` (plugin at folder scope, only triggers at the root), it reads
   `.aipe/` and injects **a single block** with the coordinator's "awareness," in 3
   states driven by `state.yaml` (no brain → `/context-brain`; incomplete onboarding →
   setup guide; everything done → full coordinator). **On by default**, opt-out is
   conversational only (per session). Bash orchestrates + emits; Bun parses the YAML.
   This is what makes AIPe "be" a context, not just executables.
4. **Worktree-per-journey** — foundational sub-project: worktree isolation for
   parallel journeys (convention `<repo>/.worktrees/<journey-id>-<specialist>/`).
5. **`/relationship`** — fan-out of read-only agents discovering relations between
   repos; coordinator synthesizes and documents. It's a legitimate workflow case. Also
   **fills `stack`** back into the brain (resolves the 1st open question in §8).
6. **`/hire-specialists`** — generates the persona skills (two-mode format),
   including stack-specialists and a dedicated QA.
7. **`/aipe-add-repo`** (incremental) — adds a new repo, remaps only the affected
   relations and generates/updates the specialist, without hand-rewriting the brain.
   Companies only grow; hand-writing doesn't scale.

---

## 8. Open questions

- ~~Automatic `stack` detection: who fills the brain back in?~~ **Resolved:**
  `/relationship` fills it in (it already reads the code in depth).
  `/make-workspace` stays clone-only.
- Exact format of `personas.yaml` and the "hiring brief" (the object the
  coordinator hands to the specialist): will be designed in the
  `/hire-specialists` cycle.
- Prototype of the persona + third-party skill load (loading order).
