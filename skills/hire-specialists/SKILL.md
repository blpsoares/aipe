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

**Announce on entry:** "Using hire-specialists to install the context's personas."

## When to use / when NOT

**Use it when:** onboarding step 4 (last) — `phase.relationship` is `done` and the
context needs its dev+QA personas installed per hiring group.

**Do NOT use it when:** relations aren't discovered yet (run `/relationship` first —
there's no stack/relations to ground personas in); or you only added one repo (use
`/aipe-add-repo`, which hires **only** the new repo and preserves existing names).
Re-running here after `done` re-resolves names and overwrites **every** persona from
scratch — never do that just to tweak one persona.

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
     through the coordinator, never touch another repo; **before claiming done,
     run `/verify-before-done`** and return evidence (commands + observed output) —
     a **dev** persona TDDs then proves the feature works; a **QA** persona runs
     `/review-delivery` (verify against the diff + acceptance, not the dev's report;
     calibrate severity) as the delivery gate. If the brief is insufficient, return
     `{status:'needs-clarification'}` instead of guessing; (b) how to behave
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

## The QA-per-group gate (MUST — non-negotiable)

Every hiring group gets **exactly** one dev-fullstack **and** one QA persona. QA is
not optional staffing — it is what makes the **QA delivery gate** in `/operate`
physically possible: no dev delivery is ever "done" until its repo/package's QA has
been dispatched and returned `passed`. A group hired without a QA has no gate at
operation time, so its deliveries can never be verified.

**Table of non-exceptions (forbidden rationalizations for skipping a QA).** Each
thought means **STOP:**

| Rationalization | Ruling |
| --- | --- |
| "the dev can test their own work" | Self-test ≠ the gate. MUST hire a separate QA |
| "this package is tiny" | MUST still hire dev + QA — 2 per group, always |
| "one QA can cover the whole monorepo" | Hire per graph node; each package needs its own gate |
| "we'll add QA later if needed" | No QA now = no delivery gate later. Hire it now |

## Rules

- Governance (MUST): you are the coordinator — you **NEVER** edit repo source
  yourself, because all code work must flow through the dispatch gate in `/operate`
  (decompose → dispatch a specialist in a worktree → PR) to keep the audit trail and
  worktree isolation intact; the non-exceptions there ("simple", "urgent", "one
  file", "I already know the fix") never apply. Here you only run the `aipe` CLI and
  dispatch scoped subagents that write persona prose.
- QA gate (MUST): ALWAYS exactly 2 personas per hiring group (1 dev-fullstack + 1 QA)
  — a whole repo for a plain repo, each package of a monorepo. **NEVER** skip QA (see
  the gate above). A monorepo is hired per package (per graph node), unless you
  deliberately judge it cohesive enough to hire at the repo fqid. The two personas
  are what makes the delivery gate **independent**: the dev proves its own work with
  `/verify-before-done`; a **different** persona (QA) gates it with `/review-delivery`
  against the diff — never the author reviewing themselves.
- Leaf rigor (MUST): every persona body instructs running the rigid process-skills
  when dispatched (TDD, `/verify-before-done`, and `/review-delivery` for QA), because
  the dispatched specialist IS the "dedicated session" whose assertiveness AIPe depends
  on — a persona that claims done without evidence breaks the whole guarantee.
- Determinism (MUST): never write `personas.yaml`, `state.yaml`, or any persona
  `SKILL.md` by hand — always through the CLI, so names stay unique and the roster
  stays valid.
- Names MUST be resolved via `--resolve-names` (step 5) **before** dispatch — an agent
  told its final name writes coherent identity prose; an unnamed agent cannot.
- Each subagent MUST stay scoped to its own repo when writing persona content — no
  cross-repo file access.
- The hiring brief itself is NEVER written to disk by this skill — only documented, in
  prose, inside each persona's `SKILL.md`; its concrete shape is decided by you at
  dispatch time in future sessions.

## Common mistakes

- *Hiring a group without a QA* → the operation-time delivery gate becomes impossible;
  always 2 per group.
- *Dispatching agents before `--resolve-names`* → resolve final unique names first,
  then dispatch.
- *Re-running to tweak one persona* → re-running overwrites **all** personas; use
  `/aipe-add-repo` for incremental additions.

## Self-review gate (before telling the PE onboarding is complete)

- [ ] Every hiring group (graph node) has exactly 1 dev + 1 QA — no group missing QA.
- [ ] Names were resolved via `--resolve-names` before any agent was dispatched.
- [ ] Each persona `SKILL.md` and `personas.yaml` was written by the CLI, not by hand.
- [ ] The CLI printed `OK <fqid> <role>` for every pair; any `MISSING` was re-dispatched.
- [ ] `STATE specialists=done`, and the spec-first floor was installed (step 11).
