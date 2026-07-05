# Dossier 08 — AIPe Web Console (`aipe serve`)

**Status:** Built on `claude/aipe-web-console-aownq8`.
**Spec:** `2026-07-05-web-console-design.md`.
**Plan:** `2026-07-05-web-console.md`.

The **final planned sub-project**: a zero-dependency, responsive web app that
renders the whole company (org chart, workers by state, pipeline with each
worker's stage, per-entity detail) served by a new `aipe serve`, reading the same
`.aipe/` truth the TUI dashboard already aggregates. The PE extended the scope
with an **embedded web terminal** so the workspace can be driven from the browser.

## Decisions (brainstorm, 2026-07-05)

The spec left two choices to the plan; the PE resolved both, plus one addition:

1. **Live updates → SSE, not polling.** The PE asked for "realtime, no loss, low
   complexity." `GET /api/stream` pushes a fresh snapshot the instant `.aipe/`
   changes (`fs.watch`, debounced) **and** reconciles on a slow timer so a missed
   filesystem event can never leave the UI stale — realtime with a safety net.
   The client is one `EventSource` (auto-reconnect). Snapshots are compared
   without their timestamp so a push only happens on a real change.
2. **Snapshot → additive, single source.** `buildSnapshot` gained per-repo
   stacks, relation edges, toolbox detail, worktree rows, journey `updatedAt`,
   and a `generatedAt` stamp — all layered on so the TUI and its tests are
   untouched. The web console and the TUI read the *same* snapshot.
3. **Embedded web terminal (PE addition).** The PE wanted to work from the web
   app. The zero-dependency law forbids a native PTY (node-pty), so this is a
   **persistent-shell command console**: one long-lived `$SHELL` per WebSocket
   whose cwd/env/state persist across commands, stdout+stderr streamed back with
   forced ANSI color. Full-screen TUIs (vim, `less`, the live dashboard) are out
   of scope (documented). Transport is Bun's built-in WebSocket. **Security:**
   bound to `127.0.0.1` by default; the terminal endpoint refuses a non-loopback
   bind unless `--allow-remote-terminal`.

## What shipped (all TDD, English-only)

**CLI + server (`src/serve/`):**
- `handler.ts` — pure `handleRequest(req, {workspace, html})`: `GET /` → the SPA,
  `GET /api/snapshot` → extended snapshot JSON, else 404. No sockets → unit-tested
  in isolation.
- `terminal.ts` — `createTerminalSession` (persistent `$SHELL`, sentinel-framed
  turns carrying exit codes) + a pure `frame()` splitter (holds back partial
  sentinels). Forces `FORCE_COLOR`/`CLICOLOR_FORCE`.
- `server.ts` — `Bun.serve` wiring the pure handler + the SSE snapshot stream
  (`fs.watch` + reconcile + heartbeat) + the WebSocket terminal, with the
  `isLoopback` guard.
- `cli.ts` — `aipe serve [--port] [--host] [--workspace] [--allow-remote-terminal]`,
  default `127.0.0.1:4317`.
- `app.html` — the self-contained SPA (HTML/CSS/JS inlined, inline SVG favicon,
  no external CDN), embedded via `import … with { type: "text" }` so `--compile`
  keeps it.

**Snapshot (`src/dashboard/snapshot.ts`):** extended additively (see decision 2).

**The SPA — two distinct experiences (spec §3):**
- **Desktop cockpit** (≥900px): KPI header; the org chart as an interactive SVG
  graph (coordinator hub → repo clusters → specialist nodes colored by state,
  over dashed relation arcs); a pipeline **board** (columns = stages, cards =
  dispatches with repo/specialist/PR); a right **detail panel** for the selected
  node/worker/repo/dispatch; a bottom terminal drawer.
- **Mobile flow** (<900px): a bottom tab bar → Overview (workers grouped by repo
  with state chips, tap-through detail), Org (collapsible tree), Pipeline (per-
  journey timeline), Terminal (full-height). Gestures over hover.
- Shared theme-aware design system (light/dark via `prefers-color-scheme` + a
  toggle); status colors match the TUI (active=blue, delivered=green,
  escalated=amber, available=muted, coordinator=violet).

## Verification

- `bun test` — **198 pass / 1 fail**; the single failure is the pre-existing
  environment-only `make-workspace/git.test.ts` (git-remote URL rewrite specific
  to some sandboxes; passes on a clean runner). 13 new tests: extended snapshot,
  the pure handler, terminal framing + a real persistent shell, and a real
  ephemeral-port server exercising `/`, `/api/snapshot`, the SSE first event, and
  the WebSocket terminal running a command.
- `bunx tsc --noEmit` — clean.
- **Driven end-to-end** against a seeded 3-repo workspace (Chromium/Playwright):
  desktop cockpit + mobile flow render in both themes; the detail panel populates
  on selection; the terminal ran `echo … && pwd` with correct output and cwd; the
  connection indicator reads **live**; editing a journey ledger on disk pushed a
  new snapshot over SSE and the DOM updated **without a reload** (escalated 1→0,
  delivered 1→2). The **compiled standalone binary** serves the full 38 KB SPA
  (not the placeholder) and the extended snapshot — confirming `--compile` embeds
  the `.html` text import.

## Boundary & out of scope

Read-only over the pipeline (no dispatch/approve buttons — the terminal is the
deliberate general-purpose escape hatch instead); localhost-only (no multi-
workspace/remote/auth beyond the loopback guard); no full-screen TUIs in the web
terminal (no PTY under the zero-dependency rule). The deferred release/Cloudflare
debt was **not** touched.

## Follow-up — emerald app-shell, live wiring, Team/CV, monorepo nomenclature

A second pass replaced the exploratory SPA with the approved **emerald
app-shell** and wired it end-to-end to real data.

**App-shell (`src/serve/app.html`, one self-contained file):**
- Sidebar nav (Overview, Org chart, Pipeline, Team, Toolbox, Activity, Terminal,
  Settings), a ⌘K command palette, dedicated views, a slide-over worker drawer,
  and a bottom tab bar for the **dedicated mobile layout** (single column, zero
  horizontal scroll — verified at 390px across every view).
- The single accent (emerald) is used only on components/bars/chips/buttons over
  a near-black neutral base.
- **Bilingual** EN (default) + PT-BR toggle, persisted; system data/logs stay in
  English. **Configurable notifications** (Web Audio chime + Notifications API
  desktop toasts, per-event), on a Settings screen.

**Live, no fake data:** a `setSnap()` layer derives all view state from the real
snapshot; `boot()` fetches `/api/snapshot` then subscribes to the named
`snapshot` SSE events on `/api/stream`; each push re-renders the current view and
diffs dispatches to emit activity events + notifications. The embedded terminal
runs over the `/api/terminal` WebSocket (`ready`/`out`/`end` frames). Server bug
fixed: `Bun.serve` `idleTimeout` was the 10s default, below the 25s SSE
heartbeat — raised to 255s so the stream is not cut.

**Team / CV area (user request):** a new snapshot field `personaCVs` (per roster
member: title, bio read from the persona skill's `description` front-matter, and
competences = role focus + unit stack). The **Team** view renders one CV card per
specialist (title, bio, competence chips, and live delivered / in-progress /
dispatch counts); the worker drawer shows the full CV plus in-progress and
delivered work derived from the journeys.

**Nomenclature (user request):** a repo that declares modules is now labelled
**monorepo** (emerald-bordered node) vs a plain **repo**, and the org chart gained
a **legend** spelling out coordinator / repo / monorepo / module / group /
specialist / relation, in both languages.

**Verification (follow-up):** `bun test` — **219 pass / 1 fail** (same pre-existing
environment-only git-remote test; 2 new persona-CV tests added). `bunx tsc
--noEmit` clean; `build:host` embeds the SPA. Driven end-to-end against a seeded
monorepo workspace (Chromium): real context/KPIs/org/workers render, `api` shows
as **monorepo** with Gustavo on the `gateway` module, the CV cards + drawer show
competences and deliveries, the terminal ran `echo … && pwd`, the connection
reads **live**, and no view overflows horizontally on mobile.
