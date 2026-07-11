---
name: aipe-add-repo
description: Use to add a new repository to an already-onboarded context without redoing onboarding by hand. Appends the repo to the brain, re-clones, re-discovers cross-repo relations, and hires just the new repo's personas — leaving existing personas (and their names) untouched.
---

# /aipe-add-repo

**Announce on entry:** "Using aipe-add-repo to add one repo incrementally."

Companies grow; hand-editing `brain.yaml` and re-running the whole onboarding
does not scale. This skill adds one repo incrementally. Everything
deterministic is an `aipe` command; only relation discovery and persona prose
need agents.

Run this in one session, start to finish — it briefly marks the context as
"reconfiguring" (relationship + specialists → pending) and returns it to `done`
at the end.

## When to use / when NOT

**Use it when:** the context is already onboarded (`state.yaml` all `done`) and the PE
wants to add **one** repo without redoing onboarding — preserving every existing
persona and its name.

**Do NOT use it when:** onboarding hasn't happened yet (run the onboarding flow from
`/context-brain`); or existing relations are badly stale — then run the full
`/relationship` (no `--merge`) to re-discover from scratch. This skill hires **only**
the new repo's personas; it MUST NOT re-hire or rename existing ones.

## Flow

1. **Collect the repo from the PE.** Ask for its `name`, `url`, intended `path`
   (relative to the workspace), and optional `stack`.

2. **Append it to the context:**
   ```bash
   aipe add-repo --name <name> --url <url> --path <path> [--stack a,b] --workspace <workspace>
   ```
   `OK added <name>` + `STATE relationship=pending specialists=pending`. On
   `ERROR duplicate-name`/`duplicate-path`, fix with the PE and retry.

3. **Clone it** (make-workspace is incremental — it skips repos already on disk
   and clones only the new one, then rehydrates existing personas/toolbox):
   follow the `/make-workspace` skill.

4. **Re-discover relations incrementally** (cheaper than a full re-run). A new
   repo relates to existing ones in both directions, but you don't need to
   re-analyze every existing pair:
   - Dispatch **one full read-only agent for the new repo** (its outgoing
     relations to all others), same schema as `/relationship`.
   - Dispatch **targeted reverse-scans for every existing repo** (default): a
     cheap agent per repo that looks *only* for references to the **new** repo
     (its name/package/URL) — a focused prompt, not a full re-analysis, but
     covering *all* repos so no incoming edge is missed. Only skip a repo if the
     PE explicitly accepts the cost/coverage trade-off.
   - **When to prefer a full re-run instead:** `--merge` assumes the relations
     *among the existing repos* haven't changed (true when you're only adding a
     repo). If you suspect the existing graph is stale — the repos changed a lot
     since onboarding — run the full `/relationship` (no `--merge`) to
     re-discover everything from scratch.
   - Stage each result to `.aipe/relations/.reports/<repo>.json`, then fold them
     into the existing graph:
     ```bash
     aipe relationship --merge --workspace <workspace>
     ```
     `--merge` unions the new edges into `graph.yaml` (never overwriting the
     existing ones) and backfills `stack` for the new repo only.

5. **Hire only the new repo's personas — without renaming existing ones.**
   - Read `.aipe/personas.yaml`; note every existing persona's name.
   - Resolve names for the new repo, feeding the **existing names as provided**
     so `--resolve-names` reserves them and the new repo gets fresh, unique
     names (ask the PE for the new dev/QA names, or leave them null):
     ```bash
     aipe hire-specialists --resolve-names --input <names.json> --workspace <workspace>
     ```
     In `<names.json>`, pin every existing repo to its current names and add the
     new repo's slots (null to auto-fill).
   - Dispatch **2 agents for the new repo only** (dev-fullstack + QA), same
     schema as `/hire-specialists`, and stage their reports to
     `.aipe/specialists/.reports/<newrepo>-<role>.json`.
   - Merge them into the roster (this preserves every existing persona):
     ```bash
     aipe hire-specialists --merge --workspace <workspace>
     ```
     `OK`/`MISSING` per pair + `STATE specialists=done` once the merged roster
     covers every repo.

6. **Confirm** `state.yaml` is back to all-`done` and tell the PE the repo is
   part of the context (its personas installed, relations mapped).

## Rules

- Governance (MUST): you are the coordinator — you **NEVER** edit repo source
  yourself, because all code work must flow through the dispatch gate in `/operate`
  (decompose → dispatch a specialist in a worktree → PR) to keep the audit trail and
  worktree isolation intact; the non-exceptions there ("simple", "urgent", "one
  file", "I already know the fix") never apply. Here you only run the `aipe` CLI and
  dispatch scoped subagents for the new repo.
- Preserve existing personas (MUST): ALWAYS use `aipe hire-specialists --merge` (not
  the plain overwrite) and pin every existing persona's name, because the plain run
  re-resolves and overwrites **all** names — renaming a persona the PE already knows
  breaks continuity and any in-flight worktree branches.
- Incremental scope (MUST): dispatch **only** the new repo's 2 agents (dev + QA);
  NEVER re-hire existing repos — that both wastes work and risks renaming them.
- Determinism (MUST): never hand-edit `brain.yaml`, `personas.yaml`, or `state.yaml`
  — always via `aipe`, so the merge stays valid.
- Atomicity (MUST): complete steps 2–5 in one session; leaving the context
  half-reconfigured (`relationship`/`specialists` stuck `pending`) blocks `/operate`
  until it's healed.

## Common mistakes

- *Running plain `hire-specialists` instead of `--merge`* → it overwrites every
  persona and renames them; always `--merge` with existing names pinned.
- *Ending the session mid-reconfigure* → finish steps 2–5 so state returns to `done`.
- *Fabricating the new repo's URL* → same rule as `/context-brain`: real remote or
  local path, never invented.

## Self-review gate (before telling the PE the repo is part of the context)

- [ ] Only the new repo was cloned, relation-scanned, and hired — existing repos untouched.
- [ ] `--merge` was used for both relations and hiring; existing persona names survived.
- [ ] `state.yaml` is back to all-`done` — nothing left `pending`.
- [ ] Every write went through `aipe`; no state file was hand-edited.
