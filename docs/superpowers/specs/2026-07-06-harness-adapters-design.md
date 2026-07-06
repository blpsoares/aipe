# Harness adapters — architecture spec

**Date:** 2026-07-06
**Status:** Design proposal — **awaiting PE decision** (implement now vs. keep as
documented foundation). No implementation is done; this spec is the deliverable.
**Depends on:** `2026-07-01-aipe-context-brain-design.md`,
`2026-07-04-unified-cli-distribution-design.md`.

---

## 1. Purpose

AIPe's stated goal is to run "for anyone, in any agent harness, on any OS." The
portable core already exists — the `aipe` CLI is harness-agnostic data-and-logic,
compiled to a zero-dependency binary. But three surfaces are still **specific to
Claude Code**, and today they are hard-wired rather than sitting behind an
abstraction. This spec names exactly what those surfaces are, proposes a
`HarnessAdapter` seam, and shows what a second adapter would cost — so the PE can
decide whether to implement it now or bank it as a documented foundation.

The `start` picker already lists the intended targets (`claude-code` supported;
`codex`, `gemini`, `copilot`, `antigravity`, `cursor`, `generic` coming-soon) —
this spec is the plan that turns "coming-soon" into a real adapter.

---

## 2. What is portable today vs. Claude-Code-specific

### 2.1 Already harness-agnostic (the core — no change needed)

- **The whole `aipe` CLI data model + logic:** `brain.yaml`, `state.yaml`, the
  relationship graph (nodes/edges by fqid), `personas.yaml`, journeys, the
  dispatch **law** (`aipe dispatch validate`), worktree provisioning + per-tree
  git identity, the toolbox catalog, `dashboard`, `validate-personas`. None of
  these know what a harness is.
- **Git worktree isolation** and the `aipe/<Persona>` per-worktree author — pure
  git.
- **The coordinator "awareness" *content*** (`buildAwareness` in
  `session-hook/awareness.ts`) — the actual instructions to the coordinator. It
  is plain prose; only the *delivery mechanism* and the slash-command names in it
  are Claude-Code-flavored.

### 2.2 Claude-Code-specific (what an adapter must own)

| # | Surface | Where it lives today | Claude-Code assumption baked in |
|---|---------|----------------------|----------------------------------|
| A | **Integration install** | `start/install.ts` `installClaudeCode()` | Writes `.claude/settings.json` with a `SessionStart` hook (`matcher: startup\|resume\|clear\|compact`, `command: aipe session-context …`) + `.claude/skills/<name>/SKILL.md` for each onboarding skill. |
| B | **Session-context delivery** | `session-hook/awareness.ts` `renderSessionContext()` | Emits Claude Code's exact hook JSON: `{hookSpecificOutput:{hookEventName:"SessionStart", additionalContext}}`. A different harness injects startup context a different way (an `AGENTS.md`, a rules file, a system-prompt preamble, its own hook schema). |
| C | **Persona / skill file format + location** | `hire-specialists/render.ts` + `run.ts` (writes `<repo>/.claude/skills/<slug>/SKILL.md`); `rehydrate`; `toolbox/skills.ts` | Assumes Claude Code skill auto-discovery: `.claude/skills/<slug>/SKILL.md` with `name`/`description` frontmatter. Another harness discovers agent instructions elsewhere (`.cursor/rules/*.mdc`, `AGENTS.md`, `.github/copilot-instructions.md`, a "custom modes" file …). |
| D | **Command/flow surface** | `skills/*/SKILL.md` (the coordinator flows, invoked as `/context-brain`, `/operate`, …) | The flows are written as Claude Code slash-command skills. Their *logic* delegates to the CLI, but their *packaging and invocation* is Claude Code's. |
| E | **MCP install target** | `toolbox/mcp.ts` (`.mcp.json`) | `.mcp.json` is close to a cross-harness standard, but the path/merge convention is Claude Code's; a harness may want its own MCP config location. |

Everything in 2.2 shares one trait: it is **how the coordinator/persona is
delivered to a specific harness's loader**, never *what* it says or *what data*
it computes. That is the natural cut line for the adapter.

---

## 3. Proposed seam: `HarnessAdapter`

A single interface, one implementation per harness, resolved from the existing
`HARNESSES` registry by `id`.

```ts
export interface HarnessAdapter {
  id: string;            // "claude-code", "codex", …  (matches HARNESSES)
  label: string;
  status: "supported" | "coming-soon";

  // A — write the harness-native integration into the workspace folder:
  //     startup-context hook/config + the onboarding flow files.
  installIntegration(workspaceDir: string): Promise<InstallReport>;

  // B — wrap the portable awareness text into this harness's startup-context
  //     mechanism. For Claude Code: the SessionStart hook JSON. For a file-based
  //     harness: return the file path + content to write (or "" if it injects
  //     via a hook command instead).
  renderStartupContext(awareness: string): StartupContextDelivery;

  // C — where and how a persona is materialized so THIS harness auto-loads it.
  personaFile(repo: string, slug: string): { path: string; render(body, meta): string };

  // D — how the coordinator flows (context-brain, operate, …) are packaged for
  //     this harness (skills, prompt files, custom modes, or a single AGENTS.md).
  flowFiles(): Array<{ path: string; content: string }>;

  // E — where MCP servers are registered (default: shared `.mcp.json` writer).
  mcpConfigPath(scope: "workspace" | "repo", repo?: string): string;
}
```

Supporting types: `InstallReport` (files written, for the CLI's user output),
`StartupContextDelivery = { mode: "hook"; command: string } | { mode: "file";
path: string; content: string }`.

**Registry.** `src/harness/registry.ts` maps `id → HarnessAdapter`.
`HARNESSES` (already in `start/start.ts`) becomes the *catalog*; the registry
holds the *behavior*. `start/cli.ts`'s `harness.id === "claude-code"` branch
becomes `getAdapter(harness.id).installIntegration(workspaceDir)`.

**The portable pieces stay put** and are *called by* adapters:
`buildAwareness(fields)` (content) feeds `renderStartupContext` (delivery);
`personaSlug` + the persona body the hiring agent wrote feed `personaFile`.

---

## 4. Refactor footprint (if implemented)

1. `src/harness/types.ts` — the interface + supporting types.
2. `src/harness/claude-code.ts` — move `installClaudeCode` (surface A), the
   `renderSessionContext` wrapper (B), the `.claude/skills/<slug>/SKILL.md`
   persona/skill path + `renderSkillMd` (C, D), and the `.mcp.json` path (E)
   behind the interface. **Pure move + adapter-ification; behavior identical, so
   the existing tests keep passing.**
3. `src/harness/registry.ts` — `getAdapter(id)`.
4. Thread the adapter through the three call sites that hard-code Claude Code:
   `start/cli.ts` (install), `hire-specialists/run.ts` + `rehydrate` (persona
   files), `toolbox/*` (skill/MCP targets). Each currently-hard-coded path
   becomes `adapter.personaFile(...)` / `adapter.mcpConfigPath(...)`.
5. `session-context` CLI stays the entry point Claude Code's hook calls; it asks
   the resolved adapter how to render (defaulting to `claude-code` for backward
   compat, since existing workspaces' hooks call `aipe session-context`).

A workspace records its harness (e.g. `harness: claude-code` in `state.yaml` or a
new `.aipe/harness`) written by `aipe start`, so every later command resolves the
same adapter.

## 5. A second adapter, concretely (to size the work)

Two realistic shapes for the first non-Claude target:

- **File-based harness (Codex CLI / "generic" / AGENTS.md-style):**
  `installIntegration` writes an `AGENTS.md` (or the harness's rules file)
  containing the coordinator awareness + a pointer to run `aipe` subcommands;
  `renderStartupContext` returns `{mode:"file", path:"AGENTS.md", content}`;
  `personaFile` writes a per-repo `AGENTS.md` fragment or a rules file instead of
  a `SKILL.md`; `flowFiles` inlines the flow instructions (no slash-command
  packaging). This is the **lowest-effort** second adapter and proves the seam.
- **IDE rules harness (Cursor):** `.cursor/rules/*.mdc` for personas/flows; a
  project rule for the coordinator awareness. More format work, same interface.

Either is ~1 new file (`src/harness/<id>.ts`) + registry entry + a fixture test
that asserts the files it writes. The **interface, registry, and the
Claude-Code-adapter extraction (step 4.1–4.5) are the real cost**; each further
harness is then additive.

## 6. Why this is a "propose, then decide" and not a "just build it"

A harness adapter can be *written* headlessly, but it can only be *validated* by
running AIPe inside that harness and watching a real session pick up the
integration — the same live-session constraint as persona load-order (dossier
09). Shipping a second adapter unvalidated would be exactly the "invented that I
validated it" failure the PE warned against. So the honest split is:

- **Now, low-risk:** extract the Claude-Code adapter behind the interface
  (behavior-preserving, fully unit-testable) — this is pure win and makes the
  core provably harness-agnostic.
- **Deliberate, needs the PE:** pick the *first* second harness and validate it
  live.

## 7. Recommendation (PE decides)

Two options, mutually exclusive for this cycle:

- **(a) Implement the seam now** — do steps 4.1–4.5 (the behavior-preserving
  Claude-Code extraction + registry + threading) and **one** file-based second
  adapter (`generic`/AGENTS.md) with fixture tests, leaving its *live* validation
  to the PE. Cost: a moderate refactor touching install, hire-specialists,
  rehydrate, toolbox; ~2 new source files + tests. Risk: low (the extraction is
  mechanical; the second adapter is additive and gated behind `coming-soon`
  until the PE validates it).
- **(b) Keep as documented foundation** — land this spec only; ship v1 on Claude
  Code; implement the seam when the PE has chosen and can live-test the first
  second harness.

**My recommendation: (a) the extraction is worth doing now** (it removes the
hard-coding and makes "any harness" real in the code, not just the prose), **but
defer the second live adapter to (b)** until the PE names the target harness and
can validate it. If the PE wants the whole thing in one go, (a) end-to-end with
`generic` as the demonstrator is ready to plan.

## 8. Out of scope

- Any harness-specific *runtime* behavior beyond install + context delivery +
  file formats (e.g. a harness's native sub-agent API) — the coordinator still
  drives dispatch via the portable CLI law + worktrees.
- Uninstall (tracked separately with skill/MCP uninstall).
