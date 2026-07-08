# j-20260708-n8 v2 — Implementation Plan

> Implement task-by-task; keep `bun test` + typecheck green after each part.
> **Spec:** `docs/superpowers/specs/2026-07-08-org-chart-ux-design.md`.
> **Branch:** `aipe/j-20260708-n8/brand`. One PR (all touches `aipe/serve` +
> adjacent tooling — bundled to avoid `app.html` conflicts).

## Part A — Org chart UX (`src/serve/app.html`)

- [ ] CSS: `.orgwrap { user-select:none }` (+ vendor prefixes) so dragging over
      SVG `<text>` never selects text. Keep `.onode[onclick]` clickable.
- [ ] Org toolbar in `org()`: search input `#orgSearch`, zoom −/＋/reset buttons,
      fullscreen button. Wrap the graph in `#orgstage` for the Fullscreen API.
- [ ] Filter state `_orgQuery`; `renderOrgSvg()` + `renderOrgTree()` filter repos
      and workers by name/role/package. Edges only between visible columns.
- [ ] Zoom controls: hoist the transform apply to `applyOrgTransform()`; add
      `orgZoom(dir)` (in/out/reset toward wrap centre). Wire buttons.
- [ ] Fullscreen: `orgFullscreen()` toggles Fullscreen API on `#orgstage`;
      `fullscreenchange` resets + re-inits pan/zoom.
- [ ] A11y: `node()` emits `role="button"`/`aria-label`; keyboard Enter/Space on
      focused `.onode[onclick]` triggers its click. New i18n keys (en+pt).
- [ ] Partial re-render `refreshOrg()` on search input to preserve focus.

## Part B — serve tooling & monitor

### B1 background serve (`src/serve/cli.ts`)
- [ ] `--background|-d|--detached` → `Bun.spawn` a detached child with the same
      argv minus the flag; print `pid` + `kill <pid>`; return 0. Foreground path
      untouched. Factor arg parsing so it's unit-testable.

### B2 live monitor (`src/serve/monitor.ts` + `server.ts` + `app.html`)
- [ ] `monitor.ts`: resolve `~/.claude/projects/<slug>` from workspace cwd; list
      `*/subagents/agent-*.jsonl`; read `agent-*.meta.json` for persona label;
      tail (append reads + `fs.watch`); parse JSONL lines → monitor events
      (`say` = assistant text, `tool`/`file` = tool_use Bash/Edit/Write…).
      Pure parser `parseTranscriptLine()` unit-tested.
- [ ] `server.ts`: `GET /api/monitor` SSE stream of events + initial backlog.
- [ ] `app.html`: `monitor()` two-pane view (left stream, right files), agent
      picker, live `EventSource`, empty state. Nav + i18n entries.

### B3 view persistence (`src/serve/app.html`)
- [ ] `go(v)` writes `#/<view>` + `localStorage`; `boot()` restores from hash/
      storage; `hashchange` routes. Default `overview` when absent/invalid.

## Part C — persona agent-types

- [ ] `src/hire-specialists/agent.ts`: `renderAgentMd({name,role,repo,stack,body})`
      → frontmatter `name: <display>` + description + body. `extractBody(md)`
      strips SKILL.md frontmatter.
- [ ] `run.ts` `writePersonaFiles`: also write `<repo>/.claude/agents/<slug>.md`
      and `.aipe/personas/<repo>/<slug>/agent.md`.
- [ ] `src/rehydrate/personas.ts`: also restore/generate the agent file; add a
      backfill that builds agent files for every `personas.yaml` entry from the
      existing SKILL body. Expose via the rehydrate CLI (or a subcommand).
- [ ] Tests: extend hire/rehydrate suites; keep existing green.

## Validation
- `bun test` (whole repo) + `bunx tsc --noEmit` green after each part.
- Serve the app (`aipe serve` on an ephemeral port) and confirm: pan without
  selection, fullscreen, search/filter, zoom, node click opens the drawer,
  monitor view renders, F5 keeps the view.
- `aipe serve --background` prints PID + stop line and detaches.
</content>
