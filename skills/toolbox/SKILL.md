---
name: toolbox
description: Use to add or review the context's toolbox — extra skill-packages/frameworks (e.g. a spec-driven-development kit) and MCP servers available to the coordinator and specialists. Add when the PE wants a framework or MCP installed into some or all repos; review before dispatching so you route the right tool to a task (and don't over-apply a heavy framework to a trivial edit).
---

# /toolbox

The toolbox is the set of extra capabilities the context can use beyond the
personas: **skill-packages/frameworks** (like an SDD kit) and **MCP servers**.
The catalog lives at `.aipe/toolbox.yaml` (published with the workspace); the
actual installs live inside each repo (and, for MCPs, in `.mcp.json`), rebuilt
by `aipe rehydrate` on another machine. Everything past your understanding of a
tool is a deterministic `aipe` command.

## Adding a skill-package / framework

1. **Understand it.** Read the skill's own documentation (its `SKILL.md` or
   README) so you can describe it accurately — what it is, what it's for, and
   **when it should and should not be used**. This routing hint is the point:
   later you must know that "change a button's colour" does *not* warrant
   spawning a full SDD flow, while "design a new billing package" does.

2. **Pick the repos with the PE.** A framework can go into one repo or several.
   Shared frameworks are still installed **individually** per repo; the catalog
   entry at the workspace root is what gives you the cross-repo view.

3. **Install via the CLI.** Write a JSON payload and run:
   ```bash
   aipe skill add --input <file.json> --workspace <workspace>
   ```
   ```json
   {
     "name": "sdd",
     "description": "Spec-driven development kit (spec → plan → tasks).",
     "objective": "Structure substantial features spec-first.",
     "whenToUse": "Substantial features/refactors; NOT trivial edits (copy, colours, one-liners).",
     "repos": ["embark", "prontuario"],
     "source": "/path/to/the/skill/dir/or/SKILL.md",
     "routing": {
       "taskTypes": ["feature", "refactor"],
       "skipFor": ["styling", "copy", "one-liner"],
       "minSize": "large"
     }
   }
   ```
   `routing` is optional but recommended: it lets `aipe skill match` decide
   mechanically whether a skill applies, instead of you interpreting the prose.
   `taskTypes` = only these; `skipFor` = never these; `minSize` =
   `small|medium|large` floor.
   Output: `INSTALLED <repo>` per repo, then `OK skill=<name>`. The content is
   copied into each repo's `.claude/skills/<name>/` and into
   `.aipe/skills/<name>/` (the published source of truth).

## Adding an MCP server

Decide the scope with the PE:
- **workspace** — shared by the coordinator and *every dispatched specialist
  subagent* (they run in the coordinator's session). Prefer this for anything
  many repos need.
- **repo** — only for sessions/dispatches in the named repos.

```bash
aipe mcp add --input <file.json> --workspace <workspace>
```
```json
{
  "name": "postgres",
  "scope": "workspace",
  "repos": [],
  "description": "Shared read-only DB access.",
  "config": { "command": "mcp-postgres", "args": [], "env": { "PG_URL": "${PG_URL}" } }
}
```
Writes/merges `.mcp.json` (workspace root or per repo) and records the catalog.

> **Secrets:** the catalog is published, so `aipe mcp add` **refuses** a config
> that carries a literal secret (a secret-named field, or inline `user:pass@`
> URL credentials, whose value isn't an env reference). Use `"${PG_URL}"` and
> set the real value in the machine's environment. `--allow-secrets` overrides
> only for a deliberate, non-sensitive literal.

## Reviewing before you dispatch

Before decomposing a demand, read the catalog so you route correctly:
```bash
aipe skill list --workspace <workspace>
aipe mcp list --workspace <workspace>
```
For a mechanical decision on a specific task, ask which skills apply:
```bash
aipe skill match --task-type <feature|refactor|styling|copy|...> [--size small|medium|large] --workspace <workspace>
```
`MATCH <name>` lines are the skills whose structured `routing` fits the task
(un-routed skills always match — judge those from their `whenToUse`). Fold each
matched tool into the specialist's hiring brief; leave heavy frameworks out for
tasks that don't match (e.g. a `styling` task won't match an SDD kit that lists
`skipFor: [styling]`).

## Removing a tool

Uninstall closes the loop (add → list → match → remove):
```bash
aipe skill remove <name> --workspace <workspace>   # drops the catalog entry,
                                                   # .aipe/skills/<name>/ and each
                                                   # repo's .claude/skills/<name>/
aipe mcp remove <name> --workspace <workspace>     # drops the catalog entry and
                                                   # the server from every .mcp.json
```
Both refuse with `ERROR not-found …` if the name isn't catalogued, and leave
every other skill/MCP untouched. `aipe mcp remove` preserves the other servers in
each `.mcp.json`.

## Rules

- Governance (MUST): you are the coordinator — you NEVER edit repo source
  yourself. All code work flows through the dispatch gate in `/operate` (decompose
  → dispatch a specialist in a worktree → PR); the non-exceptions there ("simple",
  "urgent", "one file", "I already know the fix") never apply. Here you only run
  the `aipe skill` / `aipe mcp` CLI. Note the envelope: the process-skills a kit
  installs run INSIDE the dispatched specialist, never in you.
- Never hand-write `.aipe/toolbox.yaml`, a repo's `.claude/skills/<name>/`, or an
  `.mcp.json` — always through `aipe skill` / `aipe mcp`, so the catalog and the
  installs stay in sync and survive publishing.
- A shared skill is installed per repo but catalogued once at the root.
- Secrets never enter the catalog — env references only.
