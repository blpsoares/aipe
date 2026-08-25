# `aipe serve` — lifecycle, formatted output & the Floor (SDD)

> Journey `j-20260825-na`, unit `aipe` (Jesse, dev-fullstack). This is the
> committed spec + plan that travels with the PR. Implementation detail lives
> here; the cross-package shape lives in the approved Orientation Spec.
> `aipe skill match --task-type feature --size large` → `matched=0 of 0` (no SDD
> kit installed in this workspace), so this is a hand-authored SDD.

## Problem (from the Orientation Spec)

`aipe serve` is the PE's window into a running context and does not carry its
weight, in three rising sizes: (1) a half-built lifecycle (`--background` exists,
but no `status`/`stop`, and `--help` binds the port and dies), (2) ad-hoc attached
output (four bare `console.log`), and (3) an object-oriented console (org chart,
team list) when the PE needs an activity-oriented one.

## Front 1 — Finish the `serve` lifecycle

**Substrate already present.** `src/runtime/serve-registry.ts` records every
running console at `~/.aipe/serve/<pid>.json` (per-machine, **outside** the
workspace tree — so it is inherently never published, satisfying the "gitignored
pidfile equivalent" requirement), with liveness probing (`pidAlive`, signal 0)
and self-pruning (`runningServes`). `aipe upgrade` already consumes it. We build
`status`/`stop` on the same substrate — no second source.

**Pure logic** (`src/serve/lifecycle.ts`, TDD):
- `isHelpRequest(args)` — `--help`/`-h` anywhere.
- `serveSubcommand(args)` — a leading `status`/`stop` positional only.
- `selectForWorkspace(entries, ws)` — path-resolved match on both sides.
- `statusExitCode(matched)` — `0` running, `NOT_RUNNING_CODE=3` not (a clean
  answer, not the `1` a thrown error uses).
- `stopPlan(entries, ws)` — pids for this workspace, newest-first.
- `portHolder(entries, port, host)` — who holds a busy host:port.

**Wiring** (`src/serve/cli.ts`): `run()` handles `--help` (print + exit 0, **no
bind**) and `status`/`stop` **before** binding; a failed `Bun.serve` bind is
caught and re-reported naming the holder instead of a bare "is port in use?".
`stopCommand` signals `SIGTERM` and clears the registry entry (idempotent).

## Front 2 — Formatted attached output, in `agentop`'s register

Studied the real `agentop status` / `agentop --help` on this machine: a 2-space
margin, a bold orange title, dim uppercase section labels, aligned label/value
rows, `●`/`○` liveness dots. `src/serve/present.ts` (pure, TDD) renders the
banner, `status`, `stop`, `--help` and a live "N clients connected" line in that
register; `supportsColor(stream, env)` gates ANSI (off without a TTY, off under
`NO_COLOR`/`TERM=dumb`). `src/serve/server.ts` gains an `onClients` hook (live
SSE-client accounting across both streams); the CLI rewrites the live line in
place on a TTY. Every machine-readable value (URL, PID, port) is present verbatim
— color is only ever an SGR wrapper. No script/test greps the banner (the machine
channel is the registry JSON, which `upgrade` reads), verified before restyling.

## Front 3 — The Floor (activity-oriented console)

Design explored via a multi-agent pass (3 independent lenses — triage, narrative,
cockpit — judged and synthesized); the resulting information architecture is
below. It binds only to fields the snapshot already carries.

**New live signal (server).** The synthesis flagged that the client had *no*
agentop session stream. `src/serve/sessions.ts` reads `agentop session list
--json` (the READ-ONLY verb the specialist guard allows — not `ls`), and
`src/serve/payload.ts` folds the **relevant** sessions (those whose `cwd` is a
dispatch worktree) into the snapshot over the existing SSE. Degrades to `[]` when
agentop is absent. Used by both `GET /api/snapshot` and `/api/stream`.

**Pure derivations** (`src/serve/app/runtime/floor.ts`, TDD):
- `derivePhase(d, {session, laneActive, monConnDown, elapsedMs})` — exhaustive
  over all 8 `DispatchStatus`. Session mode reads agentop activity
  (working→implementing, exited→dead-silent, waiting→booting); **never** claims
  dead-silent from elapsed alone while blind (no session / monitor down).
- `costIndexOf(d)` — `MODE×TIER×INTENSITY` reusing `execution/cost.ts` verbatim,
  with a `defaulted` flag; labeled a coarse relative index, never currency.
- `openJourneyOf`, `deriveJourneyPhase`, `openWaveOf`, `countsByStatus`,
  `serializedBehind` (the same-package law), `isGateClass` (inferred gate),
  `buildDecisionInbox`, `unitTimeline`.

**Components:** `WizardRail` (pinned coordinator wizard: a never-swapping journey
strip + a body that changes shape per phase), `DecisionInbox` (ranked, deduped,
critical-first; empty list is the success state), `RepoGroup` (collapsible repo
groups → specialist accordions grouped by fqid with "behind X" serialization
spurs → per-repo green drawer). `views/floor.view.tsx` is the landing route (`/`,
`nav.order -1`); the eight legacy views keep their routes.

**Truthfulness gate** honored: `session grant`, session telemetry when no session
is matched, and codex/copilot session mode all render **PENDING**, never
actionable; gated envelopes are labeled *inferred*; warning-tier QA gaps are
labeled *derived* (the server ships only critical + escalated-open attention);
cost-index always carries the coarse-relative caveat; DEAD-SILENT is read-only
("killing is your call — the console never kills").

## Acceptance evidence

- `bun run version:check` → in sync (1.0.2); `bunx tsc --noEmit` silent.
- `bun test` → 1226 pass / 0 fail (164 files). New: lifecycle, present,
  cli-lifecycle, onclients, sessions, payload, floor (pure), floor.view.
- **Lifecycle proven across processes** (separate terminals, shared `AIPE_HOME`):
  `serve --background` starts; `serve status` from a fresh process shows it
  (exit 0); `serve --help` exits 0 **with the port occupied, without binding**;
  a second start on the busy port names the holder (exit 1); `serve stop`
  (exit 0); `serve status` after → not running (exit 3).
- `bun run build:host` → compiled `dist/aipe-linux-x64` serves the redesigned
  SPA (floor markup embedded, HTTP 200) — the `--compile` embed still works.
- The Floor rendered against the **real** workspace in a browser, both themes:
  pinned wizard (BOOTING body with the real cost-index-64 envelope), repo groups,
  specialist accordions, the law ("serializing", "behind lawson"), the decision
  inbox (critical dependency-not-landed + PENDING session grant). No external
  network requests (only a doc-link string inside bundled preact-iso; no external
  `<script>`/`<link>`/`fetch`).

## Out of scope (untouched)

D1–D7, any change to `agentop` (reading its JSON only), the auth/bind widening,
and the release workflow.
