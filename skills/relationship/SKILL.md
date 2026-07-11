---
name: relationship
description: Use in step 3 of AIPe onboarding to discover cross-repo relations (code deps, API contracts, shared infra, shared packages) once all repos are cloned, and to backfill the stack field in brain.yaml. Dispatches one read-only subagent per repo, then hands the structured results to a deterministic CLI.
---

# /relationship

**Announce on entry:** "Using relationship to map cross-repo relations."

Discovers how the repos in a context relate to each other, and documents that in
`.aipe/relations/`. Unlike `/context-brain` and `/make-workspace`, this skill needs
you (the coordinator) to dispatch subagents that actually read code — the merge,
rendering, and state update that follow are handled by a deterministic CLI, same as
the earlier onboarding steps.

## When to use / when NOT

**Use it when:** onboarding step 3 — `phase.workspace` is `done` (all repos cloned)
and you need to discover cross-repo edges + backfill `stack`.

**Do NOT use it when:** the workspace isn't cloned yet (run `/make-workspace` first —
there's nothing to read); or you only added one repo (use `/aipe-add-repo`, which
re-discovers incrementally with `--merge`). The subagents here are **read-only** —
this skill never writes to a repo.

## Flow

1. **Confirm the workspace.** By default the current directory (must be an
   `aipe-<context>` folder with `.aipe/brain.yaml`).

2. **Check the precondition.** Read `.aipe/state.yaml`. If `phase.workspace` is not
   `done`, stop and guide the PE to run `/make-workspace` first — there's nothing to
   read yet.

3. **Read `brain.yaml`** to get the repo list (`name`, `path`, and any already-known
   `stack`).

4. **Dispatch one subagent per repo, in parallel.** For each repo, launch a
   read-only agent (Explore or general-purpose) scoped to that repo's directory
   only. Give it:
   - Its own repo name and path.
   - The full list of the *other* repos in the context (name + known stack, if
     any), so it knows what names/URLs/packages to look for.
   - Instructions to report **every** relation type it finds — code imports of
     another context repo's package, API calls to/from another context repo,
     shared infrastructure (same DB/queue/bucket/env), or packages it publishes
     that another context repo imports — plus the stack it detects for its own
     repo (from manifest files: `package.json`, `Cargo.toml`, etc.).
   - Instructions to also enumerate the repo's **packages** when it is a
     **monorepo** (a workspace/`packages/`/`apps/` layout, multiple manifests, a
     Turborepo/Nx/Cargo-workspace/pnpm-workspace config, etc.). Each package gets
     a path-like `id` local to the repo (`api`, `apps/web`), its own detected
     stack, and a one-line description. A plain single-purpose repo reports **no
     packages** (omit the field or send `[]`) — it becomes a single whole-repo
     node.
   - A forced structured output matching exactly this shape:
     ```json
     {
       "repo": "<repo-name>",
       "stack": ["typescript", "bun"],
       "packages": [
         { "id": "api", "stack": ["hono"], "description": "REST API for records" },
         { "id": "apps/web", "stack": ["react"], "description": "patient portal" }
       ],
       "relations": [
         {
           "from": "<local package id, or omit for the whole repo>",
           "to": "<fqid: another repo, `repo/package`, or a sibling `thisRepo/package`>",
           "type": "imports | published-by | consumes | exposed-by | shares-infra",
           "detail": "one sentence describing the relation",
           "evidence": "path/to/file.ts:line"
         }
       ]
     }
     ```
     `packages` and each relation's `from` are **optional** (absent = the whole
     repo). `relations` may be an empty array. `type` must be exactly one of the
     five listed values — nothing else. For `to`, qualify to `repo/package` when
     you can identify the specific target package; otherwise fall back to the bare
     repo name — best effort is fine, the merge keeps both sides' wording.

   **Monorepos (package-grain relations).** If a repo declares `packages`, discover
   relations at **package** granularity: dispatch one read-only agent per package
   (scoped to that package's `path`) and use the package's fully-qualified id
   `repo/package` as the node id — both in the report's `repo` field and in any
   `to` that points at another package (same monorepo or another repo). A flat
   repo keeps its bare name (its implicit package). This makes an intra-monorepo
   edge (`platform/web` → `platform/core`) and a cross-repo edge the *same*
   mechanism — graph nodes are plain fqid strings, so nothing else changes. Run
   `aipe detect-packages --repo <name>` first if you need the package list.

5. **Save each result** to `<workspace>/.aipe/relations/.reports/<repo-name>.json`
   (create the directory if needed). One file per repo, exactly as the agent
   returned it.

6. **Run the CLI:**
   ```bash
   aipe relationship --workspace <workspace>
   ```

7. **Translate the output to the PE:**
   - `OK <repo>` → a report was found and merged in.
   - `MISSING <repo>` → no report file for that repo (the agent may have failed or
     timed out). The reports directory is preserved when any repo is missing, so
     re-dispatching just the missing repos' agents and re-running the CLI is safe
     and won't lose the ones that already succeeded.
   - `STATE relationship=done|pending` → aggregated state.

8. **Report the artifacts.** On `done`, point the PE to
   `.aipe/relations/graph.yaml` (machine-readable source of truth — a `nodes:`
   list keyed by **fqid** plus an `edges:` list) and `.aipe/relations/README.md`
   (human-readable, grouped by repo then by package), and mention that
   `brain.yaml` may now have `stack` filled in for repos that didn't declare one.
   The `nodes` are the units `/hire-specialists` hires against — a whole-repo
   node for a plain repo, one node per package for a monorepo.

9. **Next step:** once `relationship=done`, tell the PE this step is complete
   and to open a **new session** in this workspace to continue with
   `/hire-specialists` (a fresh session keeps the coordinator's context clean;
   the SessionStart hook resumes onboarding automatically).

## Rules

- Governance (MUST): you are the coordinator — you **NEVER** edit repo source
  yourself, because all code work must flow through the dispatch gate in `/operate`
  (decompose → dispatch a specialist in a worktree → PR) to keep the audit trail and
  worktree isolation intact; the non-exceptions there ("simple", "urgent", "one
  file", "I already know the fix") never apply. Here you only run the `aipe` CLI and
  dispatch **read-only** subagents that MUST stay scoped to their own repo.
- Scope (MUST): each subagent stays scoped to its own repo — **NEVER** cross-repo
  file access — because the CLI is what reconciles perspectives from different repos;
  a subagent reading across repos produces double-counted, unverifiable edges.
- Determinism (MUST): never write `graph.yaml`, `README.md`, `brain.yaml`, or
  `state.yaml` by hand — always through the CLI, so the graph stays machine-valid.
- ALWAYS preserve a PE-declared value: `stack` backfill NEVER overwrites a `stack`
  the PE already put in `brain.yaml`.
- Re-running after `done` re-dispatches all N agents and overwrites
  `graph.yaml`/`README.md`/backfilled `stack` from scratch — there's no incremental
  merge across full runs (use `/aipe-add-repo` `--merge` for a single new repo).

## Common mistakes

- *One subagent analyzing several repos* → one read-only agent per repo (or per
  package for a monorepo), each scoped to its own path.
- *Hand-writing the graph after the agents report* → stage each report to
  `.aipe/relations/.reports/<repo>.json` and let `aipe relationship` merge them.
- *Inventing a relation `type`* → it must be exactly one of the five listed values.

## Self-review gate (before telling the PE this step is done)

- [ ] One read-only subagent per repo/package ran, each scoped to its own path.
- [ ] Every result was staged to `.reports/` and merged via `aipe relationship`.
- [ ] `STATE relationship=done` (every repo `OK`); any `MISSING` was re-dispatched.
- [ ] No `graph.yaml`/`README.md` was hand-edited; PE-declared `stack` survived.
