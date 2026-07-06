# Module granularity — design spec

**Date:** 2026-07-05
**Status:** Design approved — ready for implementation plan
**Depends on:** `2026-07-02-relationship-design.md`,
`2026-07-03-hire-specialists-design.md`

---

## 1. Purpose

Today AIPe reconciles a context at **repo granularity**: `/relationship`
produces edges whose `from`/`to` are repo names, and `/hire-specialists` hires
exactly 2 personas (dev-fullstack + QA) **per repo**. That is the right unit for
a fleet of small single-purpose repos, but it under-serves a **monorepo**, where
a single repo holds several independent modules (`apps/web`, `packages/api`,
`services/auth`, …) that relate to each other and to other repos with the same
five relation types. A repo-level graph collapses all of that into one node and
one persona pair, losing the internal structure that actually drives work.

This sub-project moves the node/edge model — and the hiring unit — from **repo**
to **fqid** (fully-qualified module id), so intra-monorepo structure and
cross-repo structure are represented by the *same* mechanism. It is the change
that "closes" the monorepo story.

---

## 2. The fqid

An **fqid** identifies a node in the relationship graph. It is one of:

- `repo` — a whole repo, used when the repo has no discovered sub-modules
  (a single-module repo). This is exactly today's node identity, so every
  existing graph, persona roster, and test remains valid unchanged.
- `repo/module` — a module inside a monorepo, where `module` is a path-like id
  relative to the repo root (e.g. `prontuario/api`, `prontuario/apps/web`).

Rules:

- The repo segment never contains `/` conceptually, but a module segment may
  (`apps/web`). fqid parsing therefore splits on the **first** `/`: everything
  before it is the repo, everything after is the module.
- A repo name alone (no `/`) always denotes the whole-repo node.
- fqids are stable strings used verbatim as map keys, edge endpoints, and
  hiring-group keys. No normalization beyond trimming.

Helper module `src/relationship/fqid.ts`:

- `makeFqid(repo, module?)` → `repo` when `module` is empty/absent, else
  `repo/module`.
- `parseFqid(fqid)` → `{ repo, module: string | null }`.
- `repoOf(fqid)` → the repo segment.

---

## 3. Discovery (the agent report)

Discovery stays **single-phase, N agents** (one read-only agent per repo) — the
token cost and fan-out shape are unchanged. What changes is the report schema:
each agent now additionally declares the **modules** it found in its own repo,
and each relation may carry a local `from` module.

Per-repo report schema (superset of the old one; old reports still parse):

```json
{
  "repo": "prontuario",
  "stack": ["typescript", "bun"],
  "modules": [
    { "id": "api", "stack": ["hono"], "description": "REST API for records" },
    { "id": "apps/web", "stack": ["react"], "description": "patient portal" }
  ],
  "relations": [
    { "from": "apps/web", "to": "prontuario/api", "type": "consumes",
      "detail": "calls GET /records", "evidence": "apps/web/src/api.ts:12" },
    { "from": "api", "to": "embark", "type": "exposed-by",
      "detail": "embark calls POST /records", "evidence": "api/routes.ts:8" }
  ]
}
```

- `modules` is **optional**. Absent or `[]` → the repo is single-module; its one
  node is the whole-repo fqid (= the repo name). Each module `id` is local to
  this repo; `stack`/`description` are optional per module.
- Each relation's `from` is **optional** and is a *local* module id (or absent =
  the whole repo). The CLI qualifies it: `from` present → `repo/from`; absent →
  `repo`. This is unambiguous because the agent only knows its own repo.
- Each relation's `to` is a **fully-qualified** fqid the agent writes: another
  repo (`embark`), a module in another repo (`embark/worker`), or a sibling
  module in its own repo (`prontuario/api`). The agent is given the other repos'
  names (as today) and told to qualify to a module *when it can identify one*,
  otherwise to fall back to the bare repo name. Best-effort target granularity is
  acceptable — see §5.

The enum of five relation types is unchanged and still schema-forced.

---

## 4. Reconciliation (the CLI, deterministic)

`mergeEdges` and node-building operate purely on fqids:

**Edges.** `toRawEdges` qualifies each relation's `from` to an fqid (§3) and
takes `to` verbatim. `canonicalize` is unchanged in spirit — it swaps
`published-by`→`imports` and `exposed-by`→`consumes`, and sorts the two
endpoints for symmetric `shares-infra` — but now over fqids. Edges dedupe by
`from|to|type`; complementary reports merge into one edge with both
perspectives, exactly as today. An **intra-monorepo** edge (both endpoints share
a repo prefix) and a **cross-repo** edge (different repo prefixes) are the same
data type and travel the same path — that is the "same mechanism" requirement.

**Nodes.** A new `nodes` list is persisted alongside `edges`. Nodes come from:

1. Every module declared by every repo agent → `repo/module` fqid with the
   module's stack/description.
2. Every repo with **no** declared modules → one whole-repo node (`repo` fqid)
   with the repo's stack.
3. Any fqid that appears as an edge endpoint but was never declared (e.g. the
   agent referenced `embark/worker` but embark's agent didn't list it) →
   synthesized as a minimal node (fqid + parsed repo/module, empty stack), so the
   graph is self-consistent and no edge dangles.

Nodes are sorted by fqid and carry `{ fqid, repo, module, stack, description? }`.

**graph.yaml** gains a `nodes:` key:

```yaml
nodes:
  - fqid: embark
    repo: embark
    module: null
    stack: [typescript]
  - fqid: prontuario/api
    repo: prontuario
    module: api
    stack: [hono]
    description: REST API for records
edges:
  - from: prontuario/apps/web
    to: prontuario/api
    type: consumes
    perspectives: [...]
```

`readGraph` parses both the new `nodes` key and legacy graphs (edges only →
`nodes: []`), so incremental merge and hire-specialists tolerate old files.

**README.md** groups by repo, then lists that repo's module nodes and their
edges, so the PE sees monorepo internal structure at a glance. A single-module
repo renders exactly as today.

**Backfill** of `brain.yaml` `stack` is unchanged (still repo-level, from the
report's top-level `stack`).

---

## 5. Best-effort target granularity

A consumer agent may not know which *module* of the target repo exposes an
endpoint (it only reads its own repo). So a cross-repo relation may be reported
`to: "embark"` (repo-level) on one side while the exposing repo's own agent
reports `from: "worker", to: "prontuario/api"` (module-level) on the other.

We do **not** try to reconcile these into one edge. Both edges are kept —
consistent with the existing "perspectives keep divergence visible" philosophy
(relationship spec §5). The `exposed-by`/`consumes` pair only auto-merges when
both sides used the same two fqids. When they don't, the README shows both,
which is honest: the graph reflects exactly what each agent could see. This
avoids inventing a target module the consumer never actually identified.

---

## 6. Hiring unit = node (the hiring group)

`/hire-specialists` moves its hiring unit from **repo** to **fqid**. Concretely:

- The **hiring groups** are the graph's `nodes`. Each node (a repo or a module)
  gets its own dev-fullstack + QA pair. When `graph.yaml` has no nodes (legacy
  graph, or a context that skipped the new discovery), the groups fall back to
  `brain.yaml` repos — so every existing flow and test is unchanged.
- "Or a hiring group": the coordinator is free to hire at repo granularity for a
  monorepo it judges cohesive (by hiring against the repo fqid instead of each
  module fqid) — the CLI is granularity-agnostic. The default, when modules
  exist, is one pair per module node.
- A persona is keyed by `fqid` + `role`. `repoOf(fqid)` decides where its
  `SKILL.md` is written (`<repo>/.claude/skills/<slug>/` — skills always live at
  a repo root, even for a module persona) and the persona **prose is grounded in
  the module**: its identity paragraph, `description`, and behavior sections
  describe the module (`prontuario/api`), its stack, and its edges — not the
  whole repo.
- `personas.yaml` entries gain `fqid` and `module` (nullable) beside the existing
  `repo`; the coordinator remains `repo: null, module: null, fqid: null`.
- Coverage / `state.phase.specialists = done` means **every hiring group has both
  roles** (nodes when present, else repos).

Naming (`resolveNames`) iterates the hiring groups × roles rather than repos ×
roles. `ProvidedNames` is keyed by fqid. With no modules, fqid == repo, so the
input the PE gives is identical to today.

---

## 7. Snapshot / dashboard

`WorkerView` gains `fqid` and `module` (nullable). The dashboard groups workers
by repo (unchanged header) and, when a repo has module personas, shows the
module under each worker so the PE can tell `prontuario/api`'s dev from
`prontuario/apps/web`'s dev. Status derivation is unchanged (still by repo +
name; names are unique context-wide).

---

## 8. Backward compatibility (the load-bearing constraint)

Every change is a **superset**:

- fqid of a single-module repo == the repo name. Old graphs (edges with repo
  names, no `nodes`) parse and behave identically.
- Reports without `modules`/`from` are the old shape and produce repo-level
  nodes/edges.
- hire-specialists with no graph nodes falls back to repos.
- `personas.yaml` gains nullable fields; old rosters (no `fqid`/`module`) read
  with those fields `null`.

The existing test suites for single-repo/repo-level flows must keep passing with
at most additive assertions.

---

## 9. Out of scope

- Two-phase discovery (module census first, then relations) — single-phase
  best-effort (§5) is enough for v1.
- Automatic module clustering into hiring groups — the coordinator decides
  grouping; the CLI only provides node-granular defaults.
- Per-module `stack` backfill into `brain.yaml` (stays repo-level).
