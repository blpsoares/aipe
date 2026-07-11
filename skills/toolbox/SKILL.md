---
name: toolbox
description: Use to add or review the context's toolbox — extra skill-packages/frameworks (e.g. a spec-driven-development kit) and MCP servers available to the coordinator and specialists. Add when the PE wants a framework or MCP installed into some or all repos; review before dispatching so you route the right tool to a task (and don't over-apply a heavy framework to a trivial edit).
---

# /toolbox

**Announce on entry:** "Using toolbox to add/review the context's tools."

The toolbox is the set of extra capabilities the context can use beyond the
personas: **skill-packages/frameworks** (like an SDD kit) and **MCP servers**.
The catalog lives at `.aipe/toolbox.yaml` (published with the workspace); the
actual installs live inside each repo (and, for MCPs, in `.mcp.json`), rebuilt
by `aipe rehydrate` on another machine. Everything past your understanding of a
tool is a deterministic `aipe` command.

## When to use / when NOT

**Use it when:** the PE wants a framework or MCP installed into some/all repos, or you
need to **review** the catalog before dispatching so you route the right tool to a
task (and don't over-apply a heavy framework to a trivial edit).

**Do NOT use it when:** the tool is a per-task process concern — routing which kit a
specialist uses happens at dispatch via `aipe skill match`, inside `/operate`, not
here. This skill manages the **catalog + installs**, not runtime routing.

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

## The no-secrets gate (MUST — non-negotiable)

You **MUST NEVER** put a literal secret into a tool config. The catalog is
**published with the workspace**, so a literal token or inline `user:pass@` URL leaks
to everyone who sees the repo. Condition to pass: every sensitive value is an env
reference (`"${PG_URL}"`), with the real value set in the machine's environment.
`aipe mcp add` refuses a literal secret; `--allow-secrets` is only for a deliberate,
demonstrably non-sensitive literal — never to silence the check on a real credential.

**Table of non-exceptions (forbidden rationalizations).** Each thought means **STOP:**

| Rationalization | Ruling |
| --- | --- |
| "it's just a dev/test token" | Published catalog leaks it. Use `"${VAR}"` |
| "`--allow-secrets` will make the error go away" | That flag is for non-secrets only, never a real credential |
| "I'll rotate it later" | It's already published once committed. Never inline it |

## Rules

- Governance (MUST): you are the coordinator — you **NEVER** edit repo source
  yourself, because all code work must flow through the dispatch gate in `/operate`
  (decompose → dispatch a specialist in a worktree → PR) to keep the audit trail and
  worktree isolation intact; the non-exceptions there ("simple", "urgent", "one
  file", "I already know the fix") never apply. Here you only run the `aipe skill` /
  `aipe mcp` CLI. Envelope: the process-skills a kit installs run INSIDE the
  dispatched specialist, NEVER in you.
- Determinism (MUST): never hand-write `.aipe/toolbox.yaml`, a repo's
  `.claude/skills/<name>/`, or an `.mcp.json` — always through `aipe skill` / `aipe
  mcp`, so the catalog and the installs stay in sync and survive publishing.
- Right-sizing (MUST): ALWAYS give a framework a `routing` hint and honor it — a heavy
  kit (SDD) must NOT be routed onto a trivial task (a button colour, a one-liner);
  over-applying a framework slows every small edit and trains the model to ignore it.
- A shared skill is installed per repo but catalogued once at the root.

## Common mistakes

- *Inlining a real token in an MCP config* → use `"${VAR}"`; never `--allow-secrets` a
  credential (see the gate).
- *Adding a framework with no `routing`* → add `taskTypes`/`skipFor`/`minSize` so
  `aipe skill match` can decide mechanically instead of you interpreting prose.
- *Routing SDD onto a styling/copy task* → that's what `skipFor` prevents; leave heavy
  kits out of tasks that don't match.

## Self-review gate (before considering the tool added)

- [ ] No literal secret entered the catalog — every sensitive value is an env reference.
- [ ] The install ran through `aipe skill` / `aipe mcp`, not a hand-edited file.
- [ ] Frameworks carry a `routing` hint so `aipe skill match` can route them.
- [ ] The CLI printed `INSTALLED …` / `OK …` (not an `ERROR`) for every target repo.
