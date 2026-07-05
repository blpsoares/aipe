# AIPe Web Console — design spec (FINAL sub-project, build last)

**Date:** 2026-07-05
**Status:** **Built** — see [`plans/2026-07-05-web-console.md`](../plans/2026-07-05-web-console.md)
and [`dossie/08-web-console.md`](../../dossie/08-web-console.md). Served by
`aipe serve`; plan decisions: live updates via SSE, additive single-source
snapshot, and a PE-requested embedded web terminal.
**Depends on:** everything — `brain.yaml`, `relations/graph.yaml`,
`personas.yaml`, `.aipe/journeys/*.yaml`, `toolbox.yaml`, live `git worktree`;
reuses the dashboard's `buildSnapshot` aggregation (`src/dashboard/snapshot.ts`).

> **Why last (PE's directive):** this is the capstone visualization. It only
> pays off when the whole pipeline it renders is complete and correct — org
> chart, active/contracted/available workers, per-worker pipeline stage,
> escalations, PRs. Building it before the data model settles would mean
> re-working the views repeatedly.

---

## 1. Purpose

A **responsive web app** with **two purpose-built experiences** — one tuned for
**desktop**, one for **mobile** — to visualize, at a **top-tier level of
detail**, the whole company at a glance:

- the **org chart / organograma** — coordinator → per-repo specialists, over the
  cross-repo relations graph;
- **workers by state** — active (mid-dispatch), contracted (hired), available
  (idle), plus escalated;
- the **pipeline** — every journey, each dispatch, and the exact **stage** each
  worker is at (dispatched → delivered → escalated → merged), with PR links;
- context facts — repos, stacks, relations, toolbox (skills + MCPs).

## 2. Data source & serving (zero-dependency)

The app renders the same `.aipe/` truth the `aipe dashboard` TUI already
aggregates. Serve it with a new **`aipe serve [--port] [--workspace]`**
subcommand: a **Bun built-in HTTP server** (no framework, honoring AIPe's
zero-dependency rule) that exposes:

- `GET /` → a **self-contained SPA** (HTML/CSS/JS inlined, no external CDN — same
  constraint as artifacts; assets embedded via text imports so `--compile`
  keeps working);
- `GET /api/snapshot` → JSON from an **extended** `buildSnapshot` (add per-repo
  stacks, relation edges, toolbox, journey timestamps, dispatch history);
- live updates via **polling** (simple) or **SSE** (`GET /api/stream`) — decide
  in the plan.

Everything stays local (no auth, binds localhost by default). No data leaves the
machine.

## 3. Two experiences (responsive, not just reflowed)

- **Desktop:** a dense, multi-panel cockpit — the org chart as an interactive
  graph (coordinator hub, repo clusters, specialist nodes colored by state) over
  the relations edges; a pipeline **board** (columns = stages, cards = dispatches
  with repo/specialist/PR); side panels for a selected worker/journey with full
  detail (brief summary, branch, worktree, escalation reason, PR status).
- **Mobile:** a focused vertical flow — KPI header, a **worker list** grouped by
  repo with state chips, tap-through to a worker's pipeline timeline; the org
  chart as a collapsible/zoomable tree rather than a wide graph. Gestures over
  hover.

Shared design system (theme-aware light/dark), but **distinct layouts and
interaction models** per breakpoint — the PE asked for two *experiences*, not
one squeezed layout.

## 4. Boundary

Deterministic CLI: `aipe serve` + the extended `buildSnapshot` (tested). The SPA
is a static, self-contained asset served by the binary; its state comes only
from the snapshot API. No LLM. The coordinator never needs it to operate — it's
an observability surface for the PE.

## 5. Out of scope (for its own cycle to decide)

- Write actions from the web UI (dispatch/approve from the browser) — read-only
  first; mutations are a later, carefully-scoped addition.
- Multi-workspace / remote hosting / auth — localhost-only first.
- Historical analytics beyond the current journeys on disk.

## 6. Build order note

Implement only after: Phase B (done), portability (done), toolbox (done),
add-repo (done), dashboard (done), and any routing/prune refinements (done).
This spec is the placeholder + shape; its plan + TDD come in the final cycle.
