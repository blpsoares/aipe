# AIPe Module Granularity — design spec

**Date:** 2026-07-05
**Status:** Planned (approved by the PE, 2026-07-05).
**Depends on:** the whole existing model (`brain.yaml`, `relations/graph.yaml`,
`personas.yaml`, dispatch law, worktree lifecycle, journey ledger, `/operate`,
the dashboard/web-console snapshot).

## 1. Problem

Today the **unit of everything** — persona hiring, the dispatch law, worktrees,
PRs — is a declared **repo** (`{name, url, path}` in `brain.yaml`). A repo is the
git clone *and* the unit of work at once. That collapses for a **monorepo**:

- one monorepo declared → **1 dev + 1 QA for the whole thing**;
- the same-repo law serializes on the repo **name**, so two packages in one
  monorepo can never run in parallel — they serialize across waves.

A company-wide monorepo would be effectively **unusable** (one specialist pair
over everything, zero intra-repo parallelism). The PE's directive: solve this
with **granularity**, so specialists are dedicated at the right level.

## 2. Core idea — decouple the git clone from the unit of work

Introduce **`module`**: the unit of work *below* the repo. The repo becomes just
the **git-clone container**; the module is what gets a specialist pair, a
worktree, a PR, and a node in the relations graph.

**A repo with no declared modules is exactly one implicit module** (name = the
repo name, path = repo root). So every existing single-repo workspace behaves
identically — **100% backward compatible**; the module layer collapses onto the
repo layer when absent.

```yaml
repos:
  - name: platform            # the git clone (one)
    url: …
    path: ./platform
    modules:                  # OPTIONAL — absent ⇒ one implicit module (= the repo)
      - { name: core,    path: packages/core,    stack: [TypeScript] }
      - { name: billing, path: services/billing, stack: [Go] }
      - { name: web,     path: apps/web,         stack: [React] }
```

### Module identity
A module is keyed by `(repo, module)`; displayed as `repo/module`, or just `repo`
when it is the implicit whole-repo module. Fully-qualified id (`fqid`) `repo/module`
is unique across the context. A `resolveModules(brain)` helper yields the flat
list of units (one per real module, or one implicit unit per module-less repo) —
this is the single place the repo→unit expansion lives.

## 3. What becomes module-keyed

| Dimension | Was (repo) | Becomes (module) |
|---|---|---|
| Specialists | 1 dev + 1 QA / repo | 1 dev + 1 QA / module (dedicated) |
| Dispatch law | serialize by repo name | serialize by `fqid`; distinct modules of one repo run in **parallel**; cap 16 unchanged |
| Worktree | `<repo>/.worktrees/<journey>-<slug>/`, branch `aipe/<journey>/<slug>` | `<repo>/.worktrees/<journey>-<module>-<slug>/`, branch `aipe/<journey>/<module>/<slug>` — git allows many worktrees per clone. Implicit module keeps the old naming (compat). |
| Relations graph | edges between repo names | edges between module `fqid`s — this **unifies** cross-repo and intra-monorepo relations into one mechanism |
| PR | one per repo dispatch | one per module dispatch |
| Specialist confinement | the repo dir | the worktree, further scoped to `<module.path>` (prose guardrail) |

### 3a. (a) cohesive monorepo vs (b) multiple products in one root
- **(a) cohesive monorepo** (core, services, libs) → one repo with `modules`
  **that have relation edges** between them. Dedicated per-module specialists +
  intra-repo parallelism.
- **(b) independent products sharing one git root** → one repo with `modules`
  and **no edges** between them. The module boundary *is* the separation: each
  product gets a dedicated pair and runs fully in parallel.
- **genuinely separate git repos** → separate `repos` entries (unchanged). Never
  forced into a monorepo abstraction.

The module is always the dedicated unit; the only difference between (a) and (b)
is whether relation edges exist.

## 4. Module discovery — auto-detect + PE confirm

`aipe detect-modules --repo <name>` reads the monorepo's **own** workspace
manifests and proposes a module list the PE edits/approves:

- `pnpm-workspace.yaml` (`packages:` globs), `package.json` (`workspaces`),
- `turbo.json` / `nx.json` + `project.json`, `lerna.json`,
- `go.work` (`use` dirs), `Cargo.toml` (`[workspace] members`).

Deterministic + tested (glob expansion over the clone). The coordinator surfaces
the proposal in `/context-brain`; nothing is assumed without PE confirmation. A
repo the PE declares as flat (no modules) stays a single implicit module.

## 5. Hiring — lazy + groupable (scale)

A 50-package monorepo must not spawn 100 personas up front.

- **Lazy:** a module's dev+QA are hired the **first time a demand dispatches to
  it** (`/operate` calls `aipe hire-specialists --module <fqid>` if the roster
  lacks it). Onboarding hires only module-less repos + any modules the PE marks
  eager.
- **Groupable:** a module may carry a `group` (an "area"); modules in the same
  group **share one specialist pair** (keyed by `repo/group`). The PE groups
  utility packages so they don't each get a pair.
- `personas.yaml` entries gain `module` (and optional `group`); `--merge`
  preserves existing personas (as today). `deriveStatus` and the roster reader
  key on `(repo, module)`.

## 6. Ripple (all backward-compatible via the implicit module)

- `context-brain` — schema + validation for `modules` (+ `group`); `detect-modules`.
- `make-workspace` — still clones per repo (one clone); modules are subpaths.
- `relationship` — discovers/stores edges at module granularity; `graph.yaml`
  nodes become `fqid`s (a bare repo name = its implicit module).
- `hire-specialists` — per-module, lazy, groupable.
- `dispatch` — `DispatchEntry` gains `module`; `validateBatch` keys on `fqid`.
- `worktree` — module in the spec/naming/branch; confinement note in the brief.
- `journey` — `JourneyDispatch` gains `module`.
- `operate` — decompose per **module**, sequence via the module graph, hire lazily.
- `snapshot` / dashboard / **web console** — workers grouped repo → module →
  specialist; the org chart gains a module tier; pipeline cards show the module.

## 7. Boundary & phasing

Deterministic, tested CLI: the schema, `resolveModules`, `detect-modules`,
module-keyed dispatch law + worktree naming, per-module hiring. The coordinator's
prose owns decomposition/sequencing as before — now at module grain.

**Phasing** (each increment tested + green before the next):
1. Schema + `resolveModules` (implicit-module compat).
2. `detect-modules` (manifest readers).
3. Dispatch law + worktree naming keyed on module.
4. Hiring per module (lazy + group) + roster/status.
5. Relations at module grain.
6. `/operate` + journey `module`.
7. Snapshot + web-console module tier.

## 8. Out of scope
- Moving a module between repos; cross-module edits by one specialist (still
  escalated — a module never edits another module).
- Auto-grouping heuristics (the PE groups explicitly for now).
