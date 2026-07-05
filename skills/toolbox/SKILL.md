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
   spawning a full SDD flow, while "design a new billing module" does.

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
     "source": "/path/to/the/skill/dir/or/SKILL.md"
   }
   ```
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

> **Secrets:** the catalog is published. Never put a literal secret in
> `config` — reference an environment variable (`"${PG_URL}"`) and set the real
> value in the machine's environment.

## Reviewing before you dispatch

Before decomposing a demand, read the catalog so you route correctly:
```bash
aipe skill list --workspace <workspace>
aipe mcp list --workspace <workspace>
```
Each `SKILL <name> [repos] <whenToUse>` line tells you whether a framework
applies to the task at hand. Fold the relevant tool into the specialist's
hiring brief (mention the installed framework/MCP and when to use it); leave
heavy frameworks out of briefs for trivial tasks.

## Rules

- Never hand-write `.aipe/toolbox.yaml`, a repo's `.claude/skills/<name>/`, or an
  `.mcp.json` — always through `aipe skill` / `aipe mcp`, so the catalog and the
  installs stay in sync and survive publishing.
- A shared skill is installed per repo but catalogued once at the root.
- Secrets never enter the catalog — env references only.
