# Next session — handoff to Phase B (Operation)

**Where the project is:** AIPe has two big phases — **(A) Onboarding** (map a
context) and **(B) Operation** (the coordinator executes demands and delivers
PRs). **Phase A is complete**: the four onboarding steps (`context-brain`,
`make-workspace`, `relationship`, `hire-specialists`) plus the zero-dependency
packaging (unified `aipe` CLI, `aipe start` workspace creator, compiled
cross-platform binaries, project-scoped Claude Code install). **Phase B has not
started** — it is the next big block of value.

**Do NOT do here:** the release + Cloudflare wiring (see `OPEN-DECISIONS.md` →
"Deferred debt"); harness adapters beyond Claude Code; persona load-order
validation (needs a live session).

---

## Paste this to start the next session

> We're continuing the AIPe project (read `README.md` first). Phase A —
> Onboarding — and the zero-dependency packaging are done and committed. Your
> job this session is to design and begin building **Phase B — Operation**: the
> part where the coordinator receives a demand from the PE, decomposes it,
> dispatches the per-repo specialists (the personas from `/hire-specialists`) to
> work in parallel while respecting cross-repo relations, and each specialist
> delivers a PR — with cross-repo matters escalated to the PE.
>
> **Before writing anything**, build full context by reading, in order:
> 1. `README.md`
> 2. `docs/superpowers/specs/2026-07-01-aipe-context-brain-design.md` (the
>    foundation spec — the company analogy, the pipeline, the open questions in
>    §7/§8, and the coordinator/specialist model)
> 3. `docs/dossie/README.md` and dossier entries `01`–`06`
> 4. `OPEN-DECISIONS.md`
> 5. Skim the `.aipe/` artifacts these produce (`brain.yaml`, `state.yaml`,
>    `relations/graph.yaml`, `personas.yaml`) and the two-mode persona
>    `SKILL.md` format, plus the `aipe` CLI subcommands in `src/cli.ts`.
>
> **Then follow the repo's methodology** (see `docs/dossie/README.md`):
> brainstorm with me → write a design spec in `docs/superpowers/specs/` → an
> implementation plan in `docs/superpowers/plans/` → execute TDD → add a dossier
> entry. Everything committed is English-only; talk to me in Portuguese.
>
> Phase B spans the two roadmap items still open:
> - **Worktree-per-journey (foundational):** isolate each dispatched
>   specialist's work in its own git worktree so parallel specialists don't
>   collide.
> - **Dispatch mechanics:** the concrete "hiring brief" the coordinator hands a
>   specialist (deliberately deferred in sub-project 5), the parallel-dispatch
>   law (same repo serializes, distinct repos run in parallel, cap of 16), how a
>   dispatched persona actually runs (subagent vs. worktree + fresh session vs.
>   other), and how each specialist opens its PR.
>
> **Open design questions to resolve with me during brainstorming — ask before
> committing to a design:**
> - Exact shape of the hiring brief (task description, relevant files, delivery
>   contract).
> - How a persona is actually invoked to do work in a harness-agnostic way.
> - PR creation/attribution per specialist, and the cross-repo escalation flow.
> - Where the boundary sits between deterministic CLI (`aipe`) and
>   coordinator-driven prompting, keeping the established "everything past raw
>   agent output on disk is a tested CLI" pattern.
>
> Start on a **new branch off the latest default branch** (don't reuse the
> onboarding branch). Do not touch the deferred release/Cloudflare debt.

---

## Quick repo orientation for the next session

- **Skills** (coordinator-facing flows): `skills/<name>/SKILL.md`.
- **CLI** (deterministic core): `src/cli.ts` dispatches subcommands in
  `src/<name>/` (`context-brain`, `make-workspace`, `relationship`,
  `hire-specialists`, `start`, `session-hook`). Each exports `run(args)`.
- **Awareness / hook:** `src/session-hook/awareness.ts` (`aipe
  session-context`), consumed by `hooks/session-start` and the project-scoped
  `.claude/settings.json` that `aipe start` writes.
- **Build/dist:** `scripts/build.ts` (`bun run build`), `bin/aipe` launcher.
- **Tests:** `bun test` (one known environment-only failure in
  `make-workspace/git.test.ts` due to this sandbox's git URL rewrite; passes on
  a clean machine). Type-check: `bun run typecheck`.
