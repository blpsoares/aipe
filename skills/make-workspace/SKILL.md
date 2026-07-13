---
name: make-workspace
description: Use in step 2 of AIPe onboarding to materialize (git clone) the repositories declared in .aipe/brain.yaml inside the workspace, idempotently. Does not create a worktree, does not detect stack, does not edit the brain.
---

# /make-workspace

**Announce on entry:** "Using make-workspace to clone the brain's repos."

Materializes the context's brain repos on the machine. You (the coordinator) do NOT
clone by hand — you delegate to the typed CLI, which decides per repo (clone / skip /
error), never overwrites anything, and updates `state.yaml`.

## When to use / when NOT

**Use it when:** onboarding step 2 — `.aipe/brain.yaml` exists and the repos are not
yet cloned into the workspace.

**Do NOT use it when:** there's no brain yet (run `/context-brain` first — cloning
without the map is meaningless); or you only need to add one new repo (use
`/aipe-add-repo`, which clones incrementally). This skill only **clones** — it never
detects stack, creates worktrees, or edits the brain.

## Flow

1. **Confirm the workspace.** By default it's the current directory (must be an
   `aipe-<context>` folder with `.aipe/brain.yaml`).

2. **Check the precondition.** The brain must exist. If there is no
   `<workspace>/.aipe/brain.yaml`, guide the PE to run `/context-brain` first —
   it makes no sense to clone without the map.

3. **Run the CLI:**
   ```bash
   aipe make-workspace --workspace <workspace>
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

- Governance (MUST): you are the coordinator — you **NEVER** edit repo source
  yourself, because all code work must flow through the dispatch gate in `/operate`
  (decompose → dispatch a specialist in a worktree → PR) to keep the audit trail and
  worktree isolation intact; the non-exceptions there ("simple", "urgent", "one
  file", "I already know the fix") never apply. Here you only run the `aipe` CLI.
- Determinism (MUST): never clone or edit `brain.yaml`/`state.yaml` by hand — always
  through the CLI, so clone/skip/error decisions stay idempotent and nothing is
  overwritten.
- NEVER create worktrees here — that's a separate sub-project; doing it here corrupts
  the clean-clone assumption the later phases rely on.
- Auth failure is **NEVER** worked around (no credential-guessing, no URL rewriting):
  report the exact git message to the PE, because a silent workaround clones the wrong
  thing or leaks credentials.

## Common mistakes

- *"Fixing" an auth/access error by editing the URL* → report the git message to the
  PE; the fix is granting access or correcting the brain via `/context-brain`.
- *Re-cloning a repo that's already present* → the CLI `SKIP`s it; trust the
  idempotent output, don't force.

## Self-review gate (before telling the PE this step is done)

- [ ] Cloning ran through `aipe make-workspace`, not manual `git clone`.
- [ ] Every repo shows `OK cloned` or `SKIP` — any `ERROR` was reported verbatim, not
      worked around.
- [ ] `STATE workspace=done` before pointing the PE to `/relationship`; on `pending`,
      the missing repos were listed.
