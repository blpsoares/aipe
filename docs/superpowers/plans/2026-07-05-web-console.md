# AIPe Web Console — Implementation Plan

> **For agentic workers:** implement task-by-task, TDD. Steps use checkbox
> (`- [ ]`) syntax for tracking.

**Goal:** Ship `aipe serve` — a zero-dependency Bun HTTP server that renders the
whole company as a responsive web app (desktop cockpit + mobile flow): the org
chart, workers by state, the pipeline with each worker's stage, and a per-entity
detail panel. Live via SSE. Plus an embedded **web terminal** so the PE can drive
the workspace (run `aipe`, `git`, tests) directly from the browser.

**Spec:** `docs/superpowers/specs/2026-07-05-web-console-design.md`.

**PE decisions (2026-07-05):**
- **Live updates: SSE** (`GET /api/stream`) — realtime, no data loss, low
  complexity. `fs.watch` on `.aipe/` pushes a fresh snapshot on change; a
  heartbeat keeps the connection alive. Client uses `EventSource` (auto-reconnect).
- **Snapshot: additive, single source.** Extend `buildSnapshot` with new fields
  (stacks, relation edges, toolbox detail, worktree rows, journey timestamps).
  The TUI and the web console read the *same* snapshot; existing dashboard tests
  keep passing.
- **Embedded web terminal.** The PE wants to work from the web app. Zero-dep
  means no native PTY, so this is a **persistent-shell command console**: one
  long-lived `$SHELL` per WebSocket, commands streamed in, stdout/stderr streamed
  back with forced ANSI color. Full-screen TUIs (vim, `less`) are out of scope
  (documented). Bound to **localhost**; the terminal endpoint refuses non-loopback
  binds unless `--allow-remote-terminal`.

## Architecture

Same CLI+asset split as the rest of AIPe. One new deterministic subcommand,
`aipe serve`, backed by:

```
src/serve/
  ├── snapshot-ext.ts   # (lives in src/dashboard/snapshot.ts) additive fields
  ├── handler.ts        # pure handleRequest(req, ctx) → Response for GET / and /api/snapshot (testable, no socket)
  ├── terminal.ts       # persistent-shell session: spawn $SHELL, feed stdin, stream stdout/stderr, sentinel-framed turns
  ├── server.ts         # Bun.serve: wires handler + SSE stream (fs.watch) + WS terminal; localhost guard
  ├── cli.ts            # `aipe serve [--port] [--host] [--workspace] [--allow-remote-terminal] [--no-open]`
  ├── app.html          # the self-contained SPA (HTML/CSS/JS inlined), embedded via text import
  └── __tests__/{handler,terminal,server}.test.ts
```

**Boundary:** the deterministic, tested surface is `buildSnapshot` (extended),
`handleRequest`, the terminal session framing, and `aipe serve` arg parsing +
localhost guard. The SPA is a static embedded asset; its only data source is the
snapshot API/stream and the terminal WS. No LLM.

## Global constraints

- TypeScript **strict**; `bunx tsc --noEmit` clean before every commit.
- Tests with `bun test`. Pure handler unit-tested without a socket; SSE + WS
  covered by a real `Bun.serve` bound to an ephemeral port in a test.
- Reuse existing readers (`buildSnapshot`, `readGraph`, `readToolbox`,
  `listWorktrees`, `readBrain`) — do **not** re-implement aggregation.
- The SPA is **self-contained**: no external CDN/font/script. Embedded via
  `import app from "./app.html" with { type: "text" }` so `--compile` keeps it.
- Localhost by default. Terminal WS refuses non-loopback host without
  `--allow-remote-terminal`.
- English-only repository; PE interaction may be any language.

## Tasks

### Block 1 — Extend the snapshot (additive)
- [ ] 1.1 Add to `Snapshot`: `repoInfos: {name, stack}[]`, `relations:
  {from,to,type,detail?}[]`, `toolboxDetail: {skills[], mcps[]}`, `worktreeRows:
  WorktreeView[]`, `journeys` gain best-effort `updatedAt` (file mtime),
  `generatedAt`. Keep every existing field (TUI + tests unaffected).
- [ ] 1.2 Tests: new fields populated from brain stacks / graph.yaml / toolbox /
  worktrees; existing dashboard tests still green.

### Block 2 — Pure request handler
- [ ] 2.1 `handleRequest(req, {workspace, html})`: `GET /` → SPA (text/html);
  `GET /api/snapshot` → `buildSnapshot` JSON; else 404. No sockets.
- [ ] 2.2 Tests: routes, content types, snapshot JSON shape, 404.

### Block 3 — Terminal session (persistent shell)
- [ ] 3.1 `createTerminalSession({shell, cwd, onData, onExit})`: spawn `$SHELL`
  (fallback `bash`) with `FORCE_COLOR=1`; `write(cmd)` runs it; sentinel frames a
  turn's end + exit code; `resize`/`close`. Pure enough to unit-test framing.
- [ ] 3.2 Tests: a command's output is streamed and the turn-done sentinel fires
  with the right exit code; cwd persists across commands (`cd` then `pwd`).

### Block 4 — Server (SSE + WS + localhost guard)
- [ ] 4.1 `startServer({workspace, port, host, allowRemoteTerminal})` using
  `Bun.serve` with the pure handler, `GET /api/stream` (SSE; `fs.watch` on
  `.aipe/` debounced + heartbeat), and `WS /api/terminal` (guarded).
- [ ] 4.2 `aipe serve` CLI: flags, default port 4317, host 127.0.0.1, prints URL.
- [ ] 4.3 Tests (real ephemeral port): `/` serves HTML, `/api/snapshot` JSON,
  `/api/stream` emits an initial `snapshot` event, terminal refused on non-loopback
  without the flag.

### Block 5 — The SPA (`app.html`)
- [ ] 5.1 Shared design system: theme-aware (light/dark via
  `prefers-color-scheme`), status color tokens matching the TUI semantics
  (active/delivered/escalated/available), one CSS file inlined.
- [ ] 5.2 **Desktop cockpit** (≥900px): header KPIs; org chart as an SVG graph
  (coordinator hub → repo clusters → specialist nodes colored by state, relation
  edges); pipeline **board** (columns = stages, cards = dispatches w/ repo,
  specialist, PR); right **detail panel** for a selected node/dispatch/journey.
- [ ] 5.3 **Mobile flow** (<900px): KPI header; worker **list grouped by repo**
  with state chips; tap → worker pipeline timeline; org chart as a collapsible
  tree; gestures over hover.
- [ ] 5.4 Live: `EventSource('/api/stream')` re-renders on each snapshot; graceful
  reconnect/stale banner.
- [ ] 5.5 **Terminal panel**: xterm-lite (scrollback `<pre>` + input line, minimal
  ANSI SGR color, `\r`/backspace), WebSocket to `/api/terminal`; collapsible;
  desktop docked bottom, mobile full-screen tab.

### Block 6 — Wire-up, verify, dossier
- [ ] 6.1 Register `serve` in `src/cli.ts` + HELP; note in README "Requirements &
  distribution" command list and Roadmap→done.
- [ ] 6.2 `bun test` + `bunx tsc --noEmit` green; drive `aipe serve` against a
  seeded workspace end-to-end (curl `/`, `/api/snapshot`, `/api/stream`), confirm
  the SPA renders and the terminal runs a command.
- [ ] 6.3 Dossier `docs/dossie/08-web-console.md` (decisions, plan, execution,
  review, final state) + index updates.

## Out of scope (unchanged from spec)
- Write actions *to the pipeline* from the UI (dispatch/approve buttons) — the
  terminal is the deliberate, general-purpose escape hatch instead.
- Multi-workspace / remote hosting / auth beyond the localhost guard.
- Full-screen TUI programs in the web terminal (no PTY under the zero-dep rule).
