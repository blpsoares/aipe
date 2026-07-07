# Dossier 08 — Module granularity (relationship + hire-specialists by fqid)

**Status:** Implemented on `claude/aipe-finalize-i6443p` (finalization session,
frente 1 of 4).
**Spec:** `2026-07-05-module-granularity-design.md`.
**Plan:** `2026-07-06-module-granularity.md`.

This is the change that "closes" the monorepo story: the relationship graph and
the hiring unit move from **repo** to **fqid** (`repo` or `repo/module`), so a
monorepo's internal structure and cross-repo structure are represented — and
reconciled — by the same mechanism.

## Decisions (brainstorm)

1. **fqid model, backward compatible by construction.** A node id is `repo`
   (whole repo, == today's identity) or `repo/module`. The fqid of a
   single-module repo *is* the repo name, so every legacy graph, roster, report,
   and test stays valid unchanged. fqid parsing splits on the **first** slash
   (a module id may contain slashes: `apps/web`).
2. **Single-phase discovery kept.** Still N agents (one per repo); each now also
   enumerates its own `modules` and may tag a relation with a local `from`
   module. No two-phase module census — the token/fan-out shape is unchanged.
3. **Best-effort target granularity (§5 of the spec).** A consumer may only know
   the target repo, not its module. We do **not** invent a target module: the
   `consumes`/`exposed-by` pair auto-merges only when both sides used the same
   two fqids; otherwise both edges are kept (the existing "perspectives keep
   divergence visible" philosophy). When both sides *do* agree at module level,
   they merge into one edge with two perspectives — verified end-to-end.
4. **Hiring unit = graph node (the "hiring group").** Each node (a repo or a
   module) gets its dev+QA pair. No graph nodes (legacy/none) → fall back to one
   group per repo. A monorepo is hired per module by default; the coordinator may
   still hire at the repo fqid if it judges the repo cohesive. "2 per repo"
   became "2 per hiring group."
5. **Persona prose grounded in the module.** A module persona's `SKILL.md` lives
   at the repo root (`<repo>/.claude/skills/<slug>/`, where skills must live) but
   its description and body describe `repo/module` and the module's own stack.

## What shipped (all TDD, English-only)

**Relationship (`src/relationship/`):**
- `fqid.ts` — `makeFqid` / `parseFqid` / `repoOf`.
- `types.ts` — `ModuleEntry`, `GraphNode`; `RepoReport.modules?`,
  `RawRelation.from?`.
- `reports.ts` — parses optional `modules` + relation `from` (legacy reports
  still valid).
- `merge.ts` — `toRawEdges` qualifies `from` to an fqid; `buildNodes`
  (declared modules → module nodes, module-less repos → whole-repo node,
  undeclared edge endpoints → synthesized minimal nodes); `combineNodes` /
  `pruneNodes` for the incremental path.
- `render.ts` — `renderGraphYaml(nodes, edges)` emits `nodes:` + `edges:`;
  `renderReadme` renders per-module sub-sections for a monorepo, unchanged for a
  plain repo.
- `read-graph.ts` — returns `{ nodes, edges }`; parses the new shape and
  synthesizes nodes from a legacy edges-only graph.
- `run.ts` — both `runRelationship` and `runRelationshipMerge` build/persist and
  union nodes.

**Hire-specialists (`src/hire-specialists/`):**
- `groups.ts` — `HiringGroup`; `repoGroups` (fallback) + `readHiringGroups`
  (graph nodes → groups, restricted to present repos).
- `types.ts` — `HiringGroup`; `fqid`/`module` on `PersonaAssignment`,
  `PersonaReport.module?`, `PersonaRegistryEntry.fqid`/`module`; `ProvidedNames`
  keyed by fqid.
- `naming.ts` — `resolveNames(groups, coordinator, provided)` over groups × roles.
- `render.ts` — description grounded in `repo/module` + `module`/`repo` unit.
- `registry.ts` — entries carry `fqid`/`module`; `mergeRegistry` keys by fqid.
- `read-personas.ts` — normalizes legacy rosters (missing `fqid`/`module` → null,
  fqid falls back to repo).
- `run.ts` — iterates hiring groups; coverage = every group × both roles; persona
  stack = the group's (module's) stack.
- `cli.ts` — `OK/MISSING <fqid> <role>`.

**Dashboard (`src/dashboard/`):** `WorkerView` gains `fqid`/`module`; the render
shows a `[module]` tag so two devs in the same monorepo are distinguishable.

**Skills:** `relationship/SKILL.md` and `hire-specialists/SKILL.md` updated for
module discovery, the new report schemas, fqid-keyed names, and hiring groups.

## Verification

- **Repo-wide: 202 pass / 1 fail** — the single failure is the known
  environment-only `make-workspace/git.test.ts` remote-URL rewrite (documented in
  dossiers 05–07; passes on a clean runner). `bunx tsc --noEmit` clean.
  `bun run build:host` succeeds.
- **End-to-end through the compiled binary:** a two-repo context (a monorepo
  `mono` with `api`+`web` modules + a plain `embark`). `aipe relationship`
  produced a `graph.yaml` with 3 fqid nodes and the intra-monorepo
  `mono/web → mono/api consumes` edge; the cross-repo pair `embark consumes
  mono/api` ⟷ `mono/api exposed-by embark` **merged into one edge with two
  perspectives** (module-level pairing through the same mechanism). `README.md`
  rendered per-module sub-sections. `hire-specialists --resolve-names` produced
  6 personas — one dev+QA pair for `embark`, `mono/api`, and `mono/web` — keyed
  by fqid.

## Backward compatibility

Every change is a superset (spec §8). A single-module repo's fqid == its name;
legacy graphs (edges only), legacy reports (no `modules`/`from`), and legacy
rosters (no `fqid`/`module`) all still parse and behave identically. The existing
repo-level test suites pass with only additive changes.

## Deferred / open

- Two-phase discovery (module census first) — single-phase best-effort is enough
  for v1.
- Automatic module→hiring-group clustering — the coordinator decides grouping;
  the CLI defaults to node granularity.
- Per-module `stack` backfill into `brain.yaml` (stays repo-level).
