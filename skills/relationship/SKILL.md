---
name: relationship
description: Use in step 3 of AIPe onboarding to discover cross-repo relations (code deps, API contracts, shared infra, shared packages) once all repos are cloned, and to backfill the stack field in brain.yaml. Dispatches one read-only subagent per repo, then hands the structured results to a deterministic CLI.
---

# /relationship

Discovers how the repos in a context relate to each other, and documents that in
`.aipe/relations/`. Unlike `/context-brain` and `/make-workspace`, this skill needs
you (the coordinator) to dispatch subagents that actually read code — the merge,
rendering, and state update that follow are handled by a deterministic CLI, same as
the earlier onboarding steps.

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
   - A forced structured output matching exactly this shape:
     ```json
     {
       "repo": "<repo-name>",
       "stack": ["typescript", "bun"],
       "relations": [
         {
           "to": "<other-repo-name>",
           "type": "imports | published-by | consumes | exposed-by | shares-infra",
           "detail": "one sentence describing the relation",
           "evidence": "path/to/file.ts:line"
         }
       ]
     }
     ```
     `relations` may be an empty array. `type` must be exactly one of the five
     listed values — nothing else.

5. **Save each result** to `<workspace>/.aipe/relations/.reports/<repo-name>.json`
   (create the directory if needed). One file per repo, exactly as the agent
   returned it.

6. **Run the CLI:**
   ```bash
   <plugin-path>/bin/aipe relationship --workspace <workspace>
   ```

7. **Translate the output to the PE:**
   - `OK <repo>` → a report was found and merged in.
   - `MISSING <repo>` → no report file for that repo (the agent may have failed or
     timed out). The reports directory is preserved when any repo is missing, so
     re-dispatching just the missing repos' agents and re-running the CLI is safe
     and won't lose the ones that already succeeded.
   - `STATE relationship=done|pending` → aggregated state.

8. **Report the artifacts.** On `done`, point the PE to
   `.aipe/relations/graph.yaml` (machine-readable source of truth) and
   `.aipe/relations/README.md` (human-readable summary), and mention that
   `brain.yaml` may now have `stack` filled in for repos that didn't declare one.

9. **Next step:** once `relationship=done`, the context is ready for
   `/hire-specialists`.

## Rules

- Never write `graph.yaml`, `README.md`, `brain.yaml`, or `state.yaml` by hand —
  always through the CLI.
- Each subagent must stay scoped to its own repo — no cross-repo file access. The
  CLI is what reconciles perspectives from different repos, not the agents
  themselves.
- Re-running `/relationship` after it already reached `done` re-dispatches all N
  agents and overwrites `graph.yaml`/`README.md`/backfilled `stack` from scratch —
  there's no incremental merge across full runs.
- `stack` backfill never overwrites a value the PE already declared in `brain.yaml`.
