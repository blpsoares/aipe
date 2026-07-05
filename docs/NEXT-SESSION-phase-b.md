# Next session — after the Phase B autonomous build (2026-07-05)

Everything below was built autonomously overnight on branch
`claude/phase-b-operation-design-17ytcc`, per your "implemente TODAS elas" +
"modo automático" directive. It is committed, tested (169 pass / 1 known
env-only fail), and type-clean. This note is the handoff + the doubts you asked
me to save for us to discuss.

## What got built (all of this session's demands)

1. **Phase B — Operation.** `aipe worktree|dispatch|journey` + the `/operate`
   skill. Coordinator opens a journey, decomposes a demand, sequences via
   `graph.yaml`, validates each batch against the physical law (same-repo
   serialize, cap 16), provisions a worktree per specialist, dispatches each as
   a subagent with an ephemeral hiring brief, collects delivered/escalate,
   escalates cross-repo to you, tears down on merge.
2. **Publishable/portable workspaces.** `aipe start` now `git init`s + writes an
   allowlist `.gitignore` (brain in, repos/secrets out); personas are dual-written
   to `.aipe/personas/` and restored by `aipe rehydrate` (auto after clone).
3. **Toolbox.** `aipe skill|mcp add|list` + `/toolbox` skill: install
   skill-packages (per-repo) and MCPs (workspace-shared or per-repo), catalogued
   in `.aipe/toolbox.yaml` with a `whenToUse` routing hint.
4. **Incremental `/aipe-add-repo`.** `aipe add-repo` + `hire-specialists --merge`
   add one repo without renaming/regenerating existing personas.

## Decisions I made autonomously (flag any you'd change)

- **PR attribution:** per-worktree `user.name = aipe/<Persona>`, email inherited
  (your prefix idea). Confirm the `aipe/<Persona>` format reads right to you.
- **Worktrees live inside the repo** (`<repo>/.worktrees/...`, your pick),
  excluded via `.git/info/exclude`.
- **add-repo re-runs `/relationship` fully** (a new repo can relate both ways).
  Correct but costs N agents; incremental relation discovery is a future
  optimization.
- **add-repo hire is incremental** (`--merge`) so it does NOT re-spend tokens on
  existing repos — only the new repo's 2 agents run.
- **MCP config is stored in the published catalog** — so I kept secrets out by
  convention (env refs like `${PG_URL}`), documented in `/toolbox`.

## Doubts to resolve together (the important ones)

1. **MCP secrets.** The toolbox catalog is published. Today the rule is
   "env-var references only, never literal secrets," enforced by docs/convention.
   Do you want `aipe mcp add` to **validate/redact** literal-looking secrets and
   refuse them? (My lean: yes, add a guard.)
2. **Persona load-order validation** (from onboarding) still needs a live
   interactive session — can't be done autonomously. Want to run it together?
3. **Specialist subagent dispatch is Claude-Code-shaped in the `/operate` skill.**
   The `aipe` CLI is harness-agnostic, but the actual "run a subagent wearing the
   persona in its worktree" step is prose in a Claude Code skill. For another
   harness we'd write its adapter skill. Priority?
4. **Worktree cleanup policy.** `remove` is guardrail-protected but manual (the
   coordinator calls it on merge). Do you want a `aipe worktree prune --journey`
   that sweeps all merged/removed dispatches for a journey at once?
5. **`whenToUse` authoring.** The coordinator writes the routing hint from the
   tool's docs. Is a free-text hint enough, or do you want structured tags
   (e.g. size thresholds, task types) so routing is more deterministic?

## Untouched, as instructed

Release + Cloudflare wiring (deferred debt in `OPEN-DECISIONS.md`), harness
adapters beyond Claude Code, and the persona load-order live check.
