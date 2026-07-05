# Context toolbox (skill-packages + MCP) — design spec

**Date:** 2026-07-05
**Status:** Design approved + implemented (same session)
**Depends on:** `2026-07-05-workspace-portability-design.md` (store+rehydrate),
`2026-07-05-phase-b-operation-design.md` (dispatch — how specialists use tools).

---

## 1. Purpose

Equip a context with capabilities beyond its personas: **skill-packages /
frameworks** (e.g. a spec-driven-development kit) and **MCP servers**. The
coordinator must be able to see, in one place, *what exists* and — crucially —
*when to use each*, so it routes the right tool to a task and doesn't spawn a
heavy framework for a trivial edit ("change a button's colour" ≠ run SDD).

## 2. Model

**One published catalog** `.aipe/toolbox.yaml` with two sections:
```yaml
skills:
  - name: sdd
    description: ...        # what it is
    objective: ...          # what it's for
    whenToUse: ...          # the routing hint (coordinator + specialists read this)
    repos: [embark, ...]    # installed into these
mcps:
  - name: postgres
    scope: workspace | repo # workspace = shared by all specialist subagents
    repos: [...]            # for scope=repo
    description: ...
    config: { ... }         # harness MCP server def — secret-free (env refs)
```

**Skills** are installed **individually per repo**
(`<repo>/.claude/skills/<name>/`) even when shared, plus a published source of
truth in `.aipe/skills/<name>/` — that root copy is what gives the coordinator
the cross-repo view and what rehydrate restores from.

**MCPs** are written to `.mcp.json` — at the **workspace root** (scope
`workspace`, shared by the coordinator session and therefore every dispatched
specialist subagent) or per **repo** (`<repo>/.mcp.json`). Because `.mcp.json`
isn't published, the catalog is the source of truth and rehydrate regenerates it.

## 3. Boundary (CLI vs coordinator)

Deterministic CLI: `aipe skill add|list`, `aipe mcp add|list` — copy files,
merge `.mcp.json`/`toolbox.yaml`, catalog metadata. Coordinator (`/toolbox`
skill): read the tool's own docs to *understand* it and write an accurate
`whenToUse`; pick repos/scope with the PE; before dispatch, read the catalog and
fold the relevant tool into a specialist's hiring brief.

`add` takes a JSON `--input` (rich metadata is awkward as flags), mirroring
`hire-specialists --resolve-names`.

## 4. Portability

Covered by store+rehydrate: `aipe rehydrate` re-installs catalog skills into
their repos (from `.aipe/skills/`) and regenerates every `.mcp.json` from the
catalog, reusing the idempotent `installSkill`/`installMcp` paths.

## 5. Out of scope / open

- **Secrets:** the catalog is published, so MCP `config` must reference env vars,
  never literal secrets. Convention + docs today; a validator is a follow-up.
- **Uninstall/remove** a skill/MCP — not built this cycle (add + list only).
- **Reading a tool's docs to auto-derive `whenToUse`** is the coordinator's
  judgement (prompting), not a CLI feature.
- **Auto-routing** (the coordinator deciding which tool a task needs) stays
  prompt-side; the CLI only stores the catalog it reasons over.
