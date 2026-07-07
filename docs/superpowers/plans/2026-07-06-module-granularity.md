# Module granularity — implementation plan

> Implements `docs/superpowers/specs/2026-07-05-module-granularity-design.md`.
> TDD, TypeScript strict, `bun test`. Checkboxes track progress.

**Goal:** Move the relationship node/edge model and the hire-specialists hiring
unit from **repo** to **fqid** (`repo` or `repo/module`), so intra-monorepo and
cross-repo structure use the same mechanism — fully backward compatible with the
existing repo-level flows.

## Global constraints

- Every change is a **superset** of today's behavior (spec §8). fqid of a
  single-module repo == the repo name; legacy graphs (edges only, no `nodes`),
  legacy reports (no `modules`/`from`), and legacy rosters (no `fqid`/`module`)
  must keep working. Existing tests may only be extended additively.
- Reconciliation stays pure/deterministic; no LLM past the per-repo agent report.
- Run `bun test` + `bunx tsc --noEmit` before each commit.

## Tasks

### T1 — fqid helper (`src/relationship/fqid.ts`)
- [ ] `makeFqid(repo, module?)`, `parseFqid(fqid)`, `repoOf(fqid)`.
- [ ] Tests: single-module (`embark` → repo=embark, module=null), module with a
  slash (`prontuario/apps/web` → repo=prontuario, module=apps/web), round-trip.

### T2 — relationship types + report parsing
- [ ] `types.ts`: add `ModuleEntry { id; stack?; description? }`, `GraphNode
  { fqid; repo; module; stack; description? }`; extend `RepoReport` with
  optional `modules`; extend `RawRelation` with optional `from`.
- [ ] `reports.ts`: parse `modules` (optional, validated) and relation `from`
  (optional). Legacy reports (neither field) still valid.
- [ ] Tests in `reports.test.ts` (extend): module-bearing report parses; legacy
  report parses unchanged; malformed module dropped.

### T3 — merge over fqids + node building (`merge.ts`)
- [ ] `toRawEdges` qualifies relation `from` → fqid (`repo` or `repo/module`),
  takes `to` verbatim. `canonicalize`/`sortEdges` unchanged in spirit, now over
  fqids.
- [ ] New `buildNodes(reports)`: declared modules → `repo/module` nodes;
  module-less repos → `repo` node; synthesize minimal nodes for undeclared edge
  endpoints; sort by fqid; carry stack/description.
- [ ] Tests (extend `merge.test.ts`): intra-monorepo edge, cross-repo module
  edge, node synthesis for undeclared endpoint, repo-level report still yields
  repo nodes + repo edges identical to before.

### T4 — render nodes + module-aware README (`render.ts`)
- [ ] `renderGraphYaml(nodes, edges)` emits `nodes:` + `edges:`.
- [ ] `renderReadme(nodes, edges, repoNames)` groups by repo → module nodes →
  their edges. Single-module repo renders as today.
- [ ] `read-graph.ts`: parse `nodes` (default `[]`), keep edge parsing; legacy
  graphs still load.
- [ ] Tests (extend `render.test.ts`, `read-graph`): nodes round-trip; legacy
  graph (edges only) loads with empty nodes.

### T5 — wire run.ts (full + merge paths) + cli
- [ ] `runRelationship`: build nodes, render with nodes, write graph. `RunResult`
  unchanged (still per-repo OK/MISSING for the coordinator report).
- [ ] `runRelationshipMerge`: combine nodes (union by fqid, prune to present
  repos) alongside edges.
- [ ] Tests (extend `run.test.ts`, `merge-incremental.test.ts`): graph.yaml has
  nodes after a module run; incremental merge unions module nodes.

### T6 — hire-specialists hiring unit = node
- [ ] `read-graph` reuse (or a thin reader in hire-specialists) to load nodes as
  hiring groups; fall back to `brain.repos` when nodes absent.
- [ ] `types.ts`: `PersonaAssignment`/`PersonaReport`/`PersonaRegistryEntry` gain
  `fqid` + `module` (nullable); keep `repo`.
- [ ] `naming.ts`: `resolveNames(groups, provided)` iterates hiring groups × roles
  keyed by fqid; `ProvidedNames` keyed by fqid.
- [ ] `render.ts`: description + slug grounded in the module fqid; `renderSkillMd`
  mentions the module when present.
- [ ] `run.ts`: iterate hiring groups; write persona under `repoOf(fqid)`;
  coverage = every group × both roles. `registry`/`mergeRegistry` carry fqid.
- [ ] `reports.ts`: parse optional `module`/`fqid` on persona reports.
- [ ] Tests: per-module hire (monorepo with 2 modules → 4 personas), repo-level
  fallback identical to today, registry carries fqid, merge path.

### T7 — snapshot/dashboard module awareness
- [ ] `WorkerView` gains `fqid`/`module`; snapshot fills from roster.
- [ ] Dashboard shows module under module-personas; repo-level unchanged.
- [ ] Tests (extend `dashboard.test.ts`): module worker renders its module.

### T8 — skills prose (docs, no test)
- [ ] Update `skills/relationship/SKILL.md`: module discovery, report schema with
  `modules` + relation `from`, fqid `to`.
- [ ] Update `skills/hire-specialists/SKILL.md`: hiring groups = nodes, per-module
  personas, fqid-keyed names.

### T9 — verify + dossier
- [ ] `bun test` (ignore known env-only git test) + `bunx tsc --noEmit` +
  `bun run build:host`; report real results.
- [ ] Dossier `08-module-granularity.md`; update dossier README index.
- [ ] Commit + push.
