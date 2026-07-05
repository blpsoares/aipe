---
name: aipe-add-repo
description: Use to add a new repository to an already-onboarded context without redoing onboarding by hand. Appends the repo to the brain, re-clones, re-discovers cross-repo relations, and hires just the new repo's personas — leaving existing personas (and their names) untouched.
---

# /aipe-add-repo

Companies grow; hand-editing `brain.yaml` and re-running the whole onboarding
does not scale. This skill adds one repo incrementally. Everything
deterministic is an `aipe` command; only relation discovery and persona prose
need agents.

Run this in one session, start to finish — it briefly marks the context as
"reconfiguring" (relationship + specialists → pending) and returns it to `done`
at the end.

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

4. **Re-discover relations** (a new repo can relate to existing ones in both
   directions, so this is a full re-run that overwrites `graph.yaml` and
   backfills `stack`): follow the `/relationship` skill.

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

- Never hand-edit `brain.yaml`, `personas.yaml`, or `state.yaml` — always via
  `aipe`.
- Use `aipe hire-specialists --merge` (not the plain overwrite) so existing
  personas and their names survive.
- Complete steps 2–5 in one session; don't leave the context half-reconfigured.
- Only the new repo's 2 agents are dispatched — do not re-hire existing repos.
