# Web console UX + serve tooling + persona agent-types — design spec (j-20260708-n8 v2)

**Date:** 2026-07-08
**Journey:** j-20260708-n8 (spec v2, PE-approved)
**Status:** Built — see [`plans/2026-07-08-org-chart-ux.md`](../plans/2026-07-08-org-chart-ux.md).
**Scope:** the `aipe` repo only — `src/serve/*` (web console + server + CLI),
`src/hire-specialists/*` + `src/rehydrate/*` (persona tooling), and generated
`<repo>/.claude/agents/<slug>.md` files. No new runtime deps, no framework, no
graph library; the frontend stays a vanilla single-file HTML.

This spec grew in three PE waves, all delivered on one branch/PR because they all
touch `aipe/serve` + adjacent tooling (avoids `app.html` merge conflicts):

- **Part A — Org chart UX** (§1–4 below).
- **Part B — serve background mode, live specialist monitor, view persistence** (§5).
- **Part C — real persona names on dispatch via `.claude/agents/` types** (§6).

---

# Part A — Org chart UX

**Scope (Part A):** `src/serve/app.html` only (SVG org graph built by template
strings; manual pan/zoom via Pointer Events).

---

## 1. Problem

The organogram view (`org()` → `renderOrgSvg()` desktop / `renderOrgTree()`
mobile) is hard to navigate once there are many repos/personas:

- **Pan is hijacked by text selection.** There is no `user-select` rule in the
  file, so dragging across the SVG `<text>` labels selects text instead of
  panning. Pan works only when the drag starts over empty canvas.
- **No fullscreen.** A wide graph is cramped inside the card.
- **Poor navigability at scale.** The only zoom affordances are mouse wheel and
  double-click-to-reset — undiscoverable, and unusable without a mouse. There is
  no way to find a specific repo/persona in a crowded graph.
- **Weak accessibility.** Nodes are `<g tabindex="0">` with no role/label and no
  keyboard activation, so they are unreachable/unusable via keyboard + AT.

## 2. Goals

1. Pan drags freely without ever selecting text, **without** breaking the click
   that opens a specialist's CV drawer (`openWorker`).
2. A **fullscreen** toggle for the org view (Fullscreen API), re-initializing
   pan/zoom on enter and exit.
3. **Search/filter** (by repo / persona / role / package) that reduces the nodes
   shown, in both the desktop SVG and the mobile tree.
4. **Visible zoom controls**: zoom-in, zoom-out, reset — in addition to wheel and
   double-click.
5. **Accessible nodes**: `role`/`aria-label`, and keyboard activation (Enter /
   Space) on clickable specialist nodes.

## 3. Non-goals

- Rewriting the graph in a framework or graph library (stays vanilla + SVG).
- Changing the snapshot API, server, or any file outside `src/serve/app.html`.
- Layout/algorithm changes to how nodes are positioned.

## 4. Acceptance

- With many repos/personas, dragging over labels pans the graph and selects **no**
  text; clicking a specialist node still opens their drawer (`openWorker`).
- Fullscreen button enters/exits fullscreen; pan/zoom resets on transition.
- Typing in the search box reduces the visible nodes (desktop + mobile); clearing
  it restores the full graph.
- Zoom-in / zoom-out / reset controls are visible and functional.
- Specialist nodes are focusable, labelled, and activate via keyboard.
- Repo test suite stays green (`bun test`), typecheck clean.

---

# Part B — serve tooling & realtime specialist monitor

## 5.1 `aipe serve` in the background (detached)

Today `aipe serve` only runs in the foreground (blocks on a never-resolving
promise). Add a `--background` / `-d` / `--detached` flag that spawns a detached
child process running the same server, prints its **PID** and the exact command
to stop it, and exits 0 immediately. Foreground behaviour is unchanged when the
flag is absent.

- Scope: `src/serve/cli.ts` (+ a small helper), unit-tested where feasible.
- The child is `Bun.spawn`'d with the same args minus the background flag, detached
  and stdio-decoupled, so it outlives the parent shell.
- Stop instruction printed: `kill <pid>` (POSIX).

## 5.2 Live specialist monitor

A new **Monitor** view + backend stream that shows, live, what each dispatched
subagent is doing: **left** = the stream of what it is "typing" (assistant text /
reasoning + the commands it runs); **right** = the files it is changing in real
time.

**Data source (read-only, established by investigation):** the Claude Code harness
persists each dispatched subagent's transcript as newline-delimited JSON at
`~/.claude/projects/<workspace-slug>/<parentSession>/subagents/agent-*.jsonl`,
with an `agent-*.meta.json` sidecar whose `description` labels the persona. The
`aipe` code writes none of this. The monitor **only reads/tails existing files** —
it does **not** change how the orchestration writes transcripts (that would be
cross-boundary and is explicitly out of scope / escalate).

- Backend: `src/serve/monitor.ts` resolves the project dir from the workspace cwd
  (`/`→`-`), enumerates the `agent-*.jsonl` files, tails them (append-only reads +
  `fs.watch`), and parses each line into monitor events: `{ agent, persona, kind:
  "say"|"tool"|"file", text?, tool?, file?, at }`. Exposed at `GET /api/monitor`
  as SSE, reusing the server's existing stream plumbing.
- Frontend: a `monitor()` view with a two-pane layout (left transcript stream,
  right changed-files list), an agent selector when several are active, live via
  `EventSource`. Empty state when no subagents are active.

**Cross-boundary guard:** if delivering this required editing how transcripts are
written (outside the repo), stop and escalate. It did not — tailing suffices.

## 5.3 View persistence across reload (F5)

Reloading always lands on Overview. The router `go(v)` must persist the current
view (URL hash `#/<view>`, mirrored to `localStorage`) so a reload restores it.
`boot()` reads the hash/stored view; `hashchange` (browser back/forward) routes.

## 5.4 Acceptance (Part B)

- `aipe serve --background` prints a PID + a stop instruction and returns to the
  shell; the server keeps serving; foreground mode unchanged.
- With active specialists, the Monitor view shows a live left stream + right
  changed-files list; with none, a clear empty state.
- F5 on any view restores that view (not Overview).
- Tests green, typecheck clean.

---

# Part C — real persona names on dispatch

## 6.1 Problem

Dispatched subagents show as **"claude"** because personas are only *skills*
(`<repo>/.claude/skills/<slug>/SKILL.md`), not *agent types*. There is no
`.claude/agents/` anywhere, so the coordinator can only dispatch the generic
agent type.

## 6.2 Fix

- **Generate an agent type per persona:** `<repo>/.claude/agents/<slug>.md` with
  frontmatter `name: <Persona display name>` + `description`, and a body carrying
  the persona identity (reused from the SKILL.md body). The coordinator can then
  dispatch `subagent_type: "<slug>"` and the real name appears.
- **Emit it automatically on hire:** extend `src/hire-specialists/` (`run.ts`
  `writePersonaFiles`, via a new `agent.ts` renderer) so every new/incremental
  hire writes the agent-type file next to the skill, and also into the
  `.aipe/personas/<repo>/<slug>/` source-of-truth so rehydrate can restore it.
- **Backfill already-hired personas:** extend `src/rehydrate/personas.ts` (and its
  CLI) to (re)generate `<repo>/.claude/agents/<slug>.md` for every persona in
  `personas.yaml`, deriving the display name from the roster and the body from the
  existing SKILL.md. Idempotent; safe to re-run.

## 6.3 Non-goals (Part C)

- Renaming already-running agents in flight (impossible; applies to next
  dispatches after landing).
- Touching persona *content/identity* — only the packaging into an agent type.

## 6.4 Acceptance (Part C)

- After hire, each persona has both a `SKILL.md` and a `.claude/agents/<slug>.md`
  with `name: <Persona>`.
- The backfill command generates the agent files for all existing personas from
  `personas.yaml`, idempotently.
- `src/hire-specialists/__tests__/` and `src/rehydrate/__tests__/` stay green.
</content>
</invoke>
