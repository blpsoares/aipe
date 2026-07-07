---
name: hire-specialists
description: Use in step 4 (last) of AIPe onboarding to hire the context's specialists — 1 dev-fullstack + 1 QA per repo — installing each as a persona skill inside its repo, plus the cross-repo personas.yaml registry. Resolves persona names with the PE, dispatches 2 subagents per repo (one per role), then hands the structured results to a deterministic CLI.
---

# /hire-specialists

Hires the context's specialists: for every **hiring group**, one dev-fullstack
persona and one QA persona, each installed as a two-mode skill inside its repo
(`<repo>/.claude/skills/<name>/SKILL.md`). A **hiring group** is a node in the
relationship graph (`.aipe/relations/graph.yaml`) — a **whole repo** for a plain
single-purpose repo, or a **package** (`repo/package`, an **fqid**) for each package
of a monorepo. So a monorepo with 3 packages hires 3 dev + 3 QA, one pair per
package; a plain repo hires 1 dev + 1 QA, exactly as before. You (the coordinator)
drive naming and dispatch subagents that write persona prose — name resolution,
validation, and file writing are handled by a deterministic CLI, same as the
earlier onboarding steps.

## Flow

1. **Confirm the workspace.** By default the current directory (must be an
   `aipe-<context>` folder with `.aipe/brain.yaml`).

2. **Check the precondition.** Read `.aipe/state.yaml`. If `phase.relationship`
   is not `done`, stop and guide the PE to run `/relationship` first — there's
   no stack/relations data to ground personas in yet.

3. **Read `brain.yaml`** (repos, stack, `context.coordinator`) and
   `.aipe/relations/graph.yaml` (its `nodes:` = the hiring groups, and `edges:`)
   directly, to have them on hand for steps 4 and 6. The **nodes** are the units
   you hire against: `fqid: embark` (a whole repo) or `fqid: prontuario/api` (a
   package). If the graph has no `nodes` (a legacy context), the CLI falls back to
   one group per repo automatically.

4. **Ask the PE for names, one hiring group at a time.** For each node/fqid, ask
   for the dev-fullstack's name and the QA's name. The PE may answer or ask you
   to generate one — leave that slot `null`, the CLI fills it. Assemble the
   answers into a `ProvidedNames` JSON object **keyed by fqid**, e.g.:
   ```json
   {
     "embark": { "devFullstack": "Joaquim", "qa": null },
     "prontuario/api": { "devFullstack": null, "qa": null },
     "prontuario/apps/web": { "devFullstack": "Ana", "qa": null }
   }
   ```
   (For a context with no monorepos, the fqids are just the repo names — this is
   identical to the pre-package flow.)

5. **Resolve final names.** Write that JSON to a temp file and run:
   ```bash
   aipe hire-specialists --resolve-names --input <file.json> --workspace <workspace>
   ```
   The CLI prints one JSON line: `{"coordinator":"Nicolas","personas":[{"fqid":"prontuario/api","repo":"prontuario","package":"api","role":"dev-fullstack","name":"Ana"}, ...]}`.
   Every name here is final and unique across the whole context (including
   the coordinator's) — this is what you dispatch with next, not whatever the
   PE originally typed.

6. **Dispatch one agent per (fqid, role) — all in parallel.** For
   each entry in the resolved `personas` list, launch an agent and give it:
   - Its assigned `name`, `role` (`dev-fullstack` or `qa`), `repo`, and
     `package` (null for a whole-repo persona).
   - The hiring group's `stack` (the package's own stack from the graph node, or
     the repo's `stack` for a whole-repo group).
   - The group's relations (edges from `graph.yaml` where `from` or `to`
     equals this **fqid** — a package persona sees its package's edges, including
     intra-monorepo ones).
   - The coordinator's name and the context name.
   - Instructions to write the **body** of a Claude Code skill file: one
     identity paragraph grounded in the stack/relations of **this package/repo**,
     then two short sections — (a) how to behave when dispatched as a subagent
     with a hiring brief (a scoped task description handed to you by the
     coordinator at dispatch time): stay within this package/repo, report back
     through the coordinator, never touch another repo; (b) how to behave
     when the PE opens a session directly inside this repo: pair with them
     directly as this package/repo's fullstack dev/QA, same posture as any Claude
     Code session, colored by this group's stack/relations awareness.
   - A forced structured output matching exactly this shape:
     ```json
     {
       "repo": "<repo-name>",
       "package": "<local package id, or omit/null for a whole-repo persona>",
       "role": "dev-fullstack | qa",
       "name": "<assigned name from step 5>",
       "body": "<markdown body for SKILL.md, below the frontmatter>"
     }
     ```

7. **Save each result** to
   `<workspace>/.aipe/specialists/.reports/<slug>.json` (create the directory if
   needed; any unique filename works — the CLI keys off the report's
   `repo`+`package`+`role`, not the filename).

8. **Run the CLI:**
   ```bash
   aipe hire-specialists --workspace <workspace>
   ```

9. **Translate the output to the PE:**
   - `OK <fqid> <role>` → that persona's `SKILL.md` was written.
   - `MISSING <fqid> <role>` → no report file (the agent may have failed or
     timed out). The reports directory is preserved when any pair is
     missing, so re-dispatching just the missing pairs and re-running the
     CLI is safe and won't lose the ones that already succeeded.
   - `STATE specialists=done|pending` → aggregated state.

10. **Report the artifacts.** On `done`, point the PE to `.aipe/personas.yaml`
    (the full roster) and to each `<repo>/.claude/skills/<name>/SKILL.md`.
    Mention that onboarding is now complete — opening a session directly
    inside a repo will load that repo's personas automatically.

11. **Install the spec-first floor + offer the heavier kits.** Run
    `aipe skill preset --workspace <workspace>` — it installs the always-on
    **`sdd-lite`** floor (short spec + evidence + task doc) into every repo, no
    prompt. Then offer the PE, in **one** message, the routed kits:
    **spec-kit** on packages with non-trivial work
    (`aipe skill add spec-kit --repo <r>`) and **pdd** on any repo that is a
    legacy migration/port (`aipe skill add pdd --repo <r>`). Presets do the
    rest; at dispatch time you route the right kit per task with
    `aipe skill match`.

## Rules

- Never write `personas.yaml`, `state.yaml`, or any persona `SKILL.md` by
  hand — always through the CLI.
- Always exactly 2 personas per **hiring group** (1 dev-fullstack + 1 QA) — a
  whole repo for a plain repo, or each package of a monorepo. Never skip QA. A
  monorepo is hired per package (per graph node), not as one repo-wide pair,
  unless you deliberately judge it cohesive enough to hire at the repo fqid.
- Names must be resolved via `--resolve-names` (step 5) **before** dispatch —
  an agent must be told its final name to write coherent identity prose.
- Each subagent must stay scoped to its own repo when writing persona
  content — no cross-repo file access.
- Re-running `/hire-specialists` after it already reached `done` re-resolves
  names, re-dispatches all 2N agents, and overwrites every persona `SKILL.md`
  + `personas.yaml` from scratch — there's no incremental regeneration.
- The hiring brief itself is never written to disk by this skill — only
  documented, in prose, inside each persona's `SKILL.md`. Its concrete shape
  is decided by you (the coordinator) at dispatch time in future work
  sessions.
