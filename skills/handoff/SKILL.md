---
name: handoff
description: Generate a single portable CLAUDE.md that hands off cross-repo context (clone instructions, repo purposes, and relations) to someone who will never install AIPe — e.g. a non-technical collaborator's own Claude Code session. Clones any repo not already local, dispatches one read-only subagent per repo, then a deterministic CLI merges and renders the final file.
---

# /handoff

**Announce on entry:** "Using handoff to generate a portable context handoff."

## When to use / when NOT

**Use it when:** you (a technical PE) want to hand a working, self-contained
context to someone who won't run AIPe themselves — a designer, PM, or any
collaborator whose own Claude Code session should already know which repos
exist, where they go, and how they relate.

**Do NOT use it when:** you're building a real ongoing AIPe workspace for
yourself — use `/context-brain` → `/make-workspace` → `/relationship` →
`/hire-specialists` instead. `/handoff` never writes `.aipe/brain.yaml` or
personas; it's a one-shot export, not a workspace.

## Flow

1. **Collect the repo list** from the PE: for each repo, a remote URL, an
   already-cloned local path, or both. Ask for a short context name too
   (used in the `CLAUDE.md` title) and where the output folder should be
   (`--out`, defaults to the current directory).

2. **Clone what's missing:**
   ```bash
   aipe handoff clone --repo <url-or-path> [--repo <url-or-path> ...] --out <dir>
   ```
   Prints `OK <repo> (<url>)` per repo that's ready (cloned, already present,
   or a valid local git repo — its remote is auto-detected via `git remote
   get-url origin` when only a local path was given), or `ERROR <repo>: <msg>`
   for one that failed. A failed repo is recorded and still shows up in the
   final `CLAUDE.md`'s `## Pending` section — this command never aborts on a
   single repo's failure.

3. **Dispatch one read-only subagent per successfully-materialized repo, in
   parallel**, scoped to that repo's directory only. Give it:
   - Its own repo name and path (from the `OK` line in step 2).
   - The full list of the *other* repos in this handoff (name only), so it
     knows what to look for.
   - Instructions to report a one-sentence `purpose` (what this repo is/does),
     its `stack` (from manifest files), and every relation it finds to
     another repo in the list — same relation contract used by
     `/relationship`.
   - A forced structured output matching exactly this shape:
     ```json
     {
       "repo": "<repo-name>",
       "purpose": "one sentence describing what this repo is/does",
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
     `relations` may be an empty array. `type` must be exactly one of the
     five listed values — nothing else.

4. **Save each result** to `<out>/.aipe-handoff/.reports/<repo-name>.json`
   (create the directory if needed) — one file per repo, exactly as the
   agent returned it.

5. **Run the CLI:**
   ```bash
   aipe handoff render --out <dir> --name "<context name>" [--file <path>]
   ```
   Writes the final `CLAUDE.md` (default `<dir>/CLAUDE.md`, override with
   `--file`).

6. **Translate the output to the PE:**
   - `WROTE <path>` → the file was generated.
   - `MISSING <repo>` → no report file for that repo (the agent may have
     failed). `.aipe-handoff/` is preserved when any repo is missing, so
     re-dispatching just the missing repos' agents and re-running `render`
     is safe and won't lose the ones that already succeeded.
   - `STATE handoff=done|pending` → whether every repo got a report.

7. **Hand off the file.** On `done`, `.aipe-handoff/` (manifest + staged
   reports) is deleted automatically — `<dir>/CLAUDE.md` is the only
   artifact left besides the cloned repos. Tell the PE to send that single
   file (or the whole `<dir>` folder, if repos were cloned into it) to the
   recipient: they drop it into an empty folder, open Claude Code there, and
   their harness already has the full setup + architecture map — no
   technical questions needed.

## Rules

- Governance (MUST): you are the coordinator — you **NEVER** edit repo
  source yourself here; this skill's subagents are **read-only** and MUST
  stay scoped to their own repo, same as `/relationship`.
- Determinism (MUST): never hand-write `CLAUDE.md` or
  `.aipe-handoff/repos.json` — always through the CLI.
- This skill never creates `.aipe/`, `brain.yaml`, or personas — that's the
  real onboarding pipeline's job, not this one-shot export's.

## Common mistakes

- *One subagent analyzing several repos* → one read-only agent per repo,
  scoped to its own path.
- *Hand-writing the `CLAUDE.md` after the agents report* → stage each
  report to `.aipe-handoff/.reports/<repo>.json` and let
  `aipe handoff render` merge them.
- *Inventing a relation `type`* → must be exactly one of the five listed
  values.
