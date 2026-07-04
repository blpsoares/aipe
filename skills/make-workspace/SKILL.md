---
name: make-workspace
description: Use in step 2 of AIPe onboarding to materialize (git clone) the repositories declared in .aipe/brain.yaml inside the workspace, idempotently. Does not create a worktree, does not detect stack, does not edit the brain.
---

# /make-workspace

Materializes the context's brain repos on the machine. You (the coordinator) do NOT
clone by hand — you delegate to the typed CLI, which decides per repo (clone / skip /
error), never overwrites anything, and updates `state.yaml`.

## Flow

1. **Confirm the workspace.** By default it's the current directory (must be an
   `aipe-<context>` folder with `.aipe/brain.yaml`).

2. **Check the precondition.** The brain must exist. If there is no
   `<workspace>/.aipe/brain.yaml`, guide the PE to run `/context-brain` first —
   it makes no sense to clone without the map.

3. **Run the CLI:**
   ```bash
   <plugin-path>/bin/aipe make-workspace --workspace <workspace>
   ```

4. **Translate the output to the PE** (one line per repo):
   - `OK cloned <repo>` → cloned now.
   - `SKIP <repo> (already present)` → was already there, nothing touched.
   - `ERROR <repo>: <message>` → failed (auth, network, or path occupied by
     different content). Explain and suggest the fix (e.g. grant access to the repo,
     move the occupied folder, or fix the URL in the brain via `/context-brain`).
   - `STATE workspace=done|pending` → aggregated state.

5. **Next step:** if `workspace=done` (all present), tell the PE this step is
   complete and to open a **new session** in this workspace to continue with
   `/relationship` (a fresh session keeps the coordinator's context clean; the
   SessionStart hook picks up exactly where onboarding left off). If `pending`,
   list what's missing to the PE; re-running is safe and only completes what's
   missing.

## Rules

- Never clone or edit `brain.yaml`/`state.yaml` by hand — always through the CLI.
- Don't create worktrees here (that's a separate sub-project).
- Auth failure is never worked around: report the git message to the PE.
