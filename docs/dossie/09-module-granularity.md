# Dossier 09 — Monorepo module granularity + toolbox uninstall

**Status:** Built on `claude/aipe-web-console-aownq8`.
**Spec:** `2026-07-05-module-granularity-design.md`.

The biggest change since Phase B: decouple **the git clone** from **the unit of
work**. A new **`module`** is the unit below the repo (a package/service/app in a
monorepo); the repo is just the clone. This makes a company-wide monorepo usable
(dedicated per-module specialists + intra-repo parallelism) instead of collapsing
to one specialist pair. Bundled with the small, independent toolbox **uninstall**
that closes the add·list·match·remove loop.

## Decisions (PE, 2026-07-05)
- **Unit name:** `module`. A repo with no `modules` is one implicit module (the
  whole repo) → 100% backward compatible.
- **Discovery:** auto-detect from the monorepo's own workspace manifests + PE
  confirm (`aipe detect-modules`).
- **Hiring scale:** lazy + groupable — modules sharing a `group` share one
  specialist pair, so a 50-package monorepo stays tractable.
- **(a) cohesive monorepo** → modules with relation edges; **(b) independent
  products in one root** → modules without edges; **separate git repos** → stay
  separate repo entries. The module is always the dedicated unit.

## What shipped (TDD, backward compatible via the implicit module)
- **Schema:** `RepoEntry.modules: [{name, path, stack?, group?}]`, validated
  (name/path required, unique per repo).
- **`resolveModules(brain)`** (`src/context-brain/modules.ts`): the single
  repo→unit expansion; `fqid` = `repo/module` (or bare `repo` when implicit);
  `resolveGroups()` collapses a shared `group` into one team; `moduleFqid`,
  `findModule`.
- **`aipe detect-modules`** (`src/detect-modules/`): reads pnpm-workspace.yaml,
  package.json workspaces, go.work, Cargo `[workspace] members`; expands globs;
  infers stack (TS/JS, Go, Rust). `--json` or MODULE/STATE lines.
- **Dispatch law:** serializes by module `fqid` — distinct modules of one
  monorepo run in parallel; same module rejects (`same-module <fqid>`), a
  module-less collision keeps `same-repo <repo>`.
- **Worktrees:** module encoded as `aipe/<journey>/<module>--<persona>`,
  round-tripped through list/prune; implicit modules keep the old naming.
- **Journey:** `JourneyDispatch.module`; `journey record`/`worktree
  create|remove` accept `--module`.
- **Hiring:** `resolveNames` iterates hiring groups; PersonaAssignment/Report/
  RegistryEntry carry optional module/group (omitted for flat repos, so existing
  rosters/tests are byte-identical).
- **Snapshot + web console:** workers carry module/group; a new `modules` list;
  the repo detail panel shows a Modules section (group chips) and specialist rows
  show the module label.
- **Skills:** `/context-brain` documents declaring `modules`; `/operate`
  decomposes per module, batches with `module`, provisions/records per module.
- **Toolbox uninstall:** `aipe skill|mcp remove <name>` (drops the catalog entry
  + every installed copy / `.mcp.json` server, other tools intact; not-found
  guard). Closes add·list·match·remove.

## Verification
Full suite green (1 pre-existing env-only failure); typecheck clean; compiled
binary carries `detect-modules`. Verified in Chromium against a monorepo seed
(`api → gateway/workers` render with the `backend` group chip; a module-scoped
persona shows its module label).

## Deferred (coordinator-prose, not deterministic core)
- **Relations at module grain** — `graph.yaml` nodes are already plain strings,
  so a fqid works as a node today; updating `/relationship` to discover
  intra-monorepo edges automatically is a prose follow-up.
- **Per-module persona *body* generation** — the `/hire-specialists` subagent
  prose still authors one body per unit; the deterministic roster is module-aware.
