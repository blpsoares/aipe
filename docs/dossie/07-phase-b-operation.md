# Dossier 07 — Phase B (Operation) + portability, toolbox, incremental add-repo

**Status:** Merged to `main` (built on `claude/phase-b-operation-design-17ytcc`).
**Specs:** `2026-07-05-phase-b-operation-design.md`,
`2026-07-05-workspace-portability-design.md`, `2026-07-05-toolbox-design.md`.
**Plan:** `2026-07-05-phase-b-operation.md`.

This session designed and built **Phase B — Operation** (the coordinator
executing demands and delivering PRs) plus three PE-requested capabilities that
surfaced during the same session: publishable/portable workspaces, a context
toolbox (skill-packages + MCPs), and incremental repo addition.

## Decisions (brainstorm, 2026-07-05)

Phase B's four open mechanics were resolved with the PE:

1. **Specialists run as subagents + worktree isolation** (not fresh headless
   sessions). Reuses persona "mode A" and the onboarding fan-out shape; sidesteps
   the fact that persona `SKILL.md`s are uncommitted (a fresh worktree checkout
   wouldn't carry them).
2. **Hiring brief = canonical but ephemeral** JSON, assembled at dispatch, never
   persisted (honours `hire-specialists` decision 7).
3. **CLI adjudicates the physical dispatch law**; the coordinator keeps
   decomposition + sequencing. (PE delegated this choice; picked "CLI adjudica".)
4. **PR attribution:** commits carry the persona as a **namespaced git author
   name** (`aipe/<Persona>`) set per-worktree via `extensions.worktreeConfig`,
   with `user.email` **inherited** so GitHub attributes to the PE's real account
   — the PE's refinement: prefix so it's clear whose account it really is.

Mid-session the PE added, and I resolved with them:

5. **Workspace portability:** the workspace is a publishable git repo (allowlist
   `.gitignore`: brain in, repos/secrets out); personas are **stored in `.aipe/`
   and rehydrated** (not regenerated) so another machine continues without
   re-spending LLM tokens.
6. **Toolbox:** a published catalog (`.aipe/toolbox.yaml`) of skill-packages and
   MCPs, installed per-repo (skills) or workspace/per-repo (MCPs), with a
   `whenToUse` routing hint so heavy frameworks aren't over-applied.

Then, in autonomous mode ("implemente TODAS elas"), all of it was built.

## What shipped (all TDD, English-only, committed)

**Phase B core (`src/`):**
- `worktree/` — `aipe worktree create|list|remove` over `git worktree`.
  Convention `<repo>/.worktrees/<journey>-<slug>/` on `aipe/<journey>/<slug>`;
  per-worktree identity; `.git/info/exclude`; remove guardrail (refuses on
  uncommitted/unpushed unless `--force`). Real-git integration tests.
- `dispatch/` — `aipe dispatch validate` (pure `validateBatch`: same-repo
  serialize, cap 16, repo/specialist existence) + personas roster reader.
- `journey/` — `aipe journey start|record|show`, durable ledger at
  `.aipe/journeys/<id>.yaml` (audit, not the brief).
- `skills/operate/SKILL.md` — the coordinator Operation flow (journey →
  decompose → sequence via `graph.yaml` → per wave: validate law → provision
  worktrees → dispatch subagents with the ephemeral brief → collect
  delivered/escalate → escalate cross-repo to the PE → teardown on merge).
- Onboarded coordinator awareness now points to `/operate`.

**Portability (`src/`):**
- `start/scaffold.ts` — `git init` + allowlist `.gitignore` + workspace README.
- `hire-specialists/run.ts` — dual-writes personas to `.aipe/personas/`.
- `rehydrate/` — `aipe rehydrate` restores personas + toolbox; `make-workspace`
  calls it post-clone.

**Toolbox (`src/toolbox/`):** `aipe skill add|list`, `aipe mcp add|list`,
catalog `.aipe/toolbox.yaml`, per-repo skill install + `.mcp.json` merge,
`skills/toolbox/SKILL.md`. Secrets kept out of the catalog (env refs only).

**Incremental add-repo (`src/add-repo/`):** `aipe add-repo` (append brain +
mark relationship/specialists pending) + `hire-specialists --merge`
(`runHireSpecialistsMerge`/`mergeRegistry`: fold a new repo's personas into the
existing roster, preserving every hired persona and its name) +
`skills/aipe-add-repo/SKILL.md`.

## Verification

- **Repo-wide: 169 pass / 1 fail**, the single failure the known environment-only
  `make-workspace/git.test.ts` remote-URL rewrite case (documented in dossiers
  05/06; passes on a clean runner). `bunx tsc --noEmit` clean.
- **End-to-end smoke through the `bin/aipe` launcher** (Bun dev fallback): a temp
  workspace with two real git repos + brain/personas — `journey start`,
  `dispatch validate` (lawful → OK, same-repo → REJECT exit 1),
  `worktree create ×2` (distinct repos), `worktree list`, `journey record/show`,
  `worktree remove`; verified the per-worktree identity is `aipe/<Persona>` with
  the real email inherited; `skill add/list`, `mcp add` (env-ref, no literal
  secret), `add-repo`, and `rehydrate` (restored skill + MCP).

## New `aipe` subcommands

`worktree`, `dispatch`, `journey`, `rehydrate`, `skill`, `mcp`, `add-repo` —
each `run(args): Promise<number>` behind the established `import.meta.main`
pattern, wired into `src/cli.ts`. New skills installed by `aipe start`:
`operate`, `toolbox`, `aipe-add-repo` (6 → now 8 AIPe skills).

## Follow-up in the same session (PE review)

After review the PE asked to apply the improvements I'd recommended and add a
live view; all shipped, tested, committed:

- **`aipe dashboard`** — a colored live TUI (buildSnapshot/renderDashboard):
  header, KPI row, workers-by-repo with status derived from the ledgers,
  pipeline per journey.
- **`aipe mcp add` refuses literal secrets** (findSecrets; `--allow-secrets`
  overrides) — the catalog is published.
- **Incremental `aipe relationship --merge`** (combineMergedEdges/pruneEdges/
  runRelationshipMerge) — `/aipe-add-repo` now does 1 full agent for the new
  repo + cheap targeted reverse-scans instead of N full agents.
- **`aipe worktree prune --journey`** — batch teardown, guardrail-protected.
- **Structured toolbox routing** — `SkillEntry.routing { taskTypes, skipFor,
  minSize }` + `aipe skill match` for mechanical tool selection.
- **Web Console spec** (`2026-07-05-web-console-design.md`) — the responsive
  desktop+mobile visualization, planned as the **final** sub-project (build last,
  once the pipeline data model is fully settled).

Repo-wide after the follow-up: **all suites green except the one known
env-only git-remote test**; `bunx tsc --noEmit` clean.

## Deferred / open (see docs/NEXT-SESSION-phase-b.md)

- Load-order validation (still needs a live session).
- MCP-config secret validation/redaction (catalog is published).
- Truly-incremental relation discovery (add-repo re-runs `/relationship` fully).
- Skill/MCP uninstall; harness adapters beyond Claude Code; release/Cloudflare.
