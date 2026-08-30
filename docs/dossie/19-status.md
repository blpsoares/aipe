# Dossier 19 — `aipe status` (who / what / repo / status, and the delta after every change)

**Status:** Merged (`fbed3cd`, PR #29, 2026-08-28; journey `j-20260825-yn`).
**Spec:** [`docs/status-cli-sdd.md`](../status-cli-sdd.md).

## What this is for

When several sessions run in parallel, the PE keeps asking one question — *who is
doing what, in which repo, at what status* — and the coordinator kept
hand-assembling that answer in chat and getting it wrong: once reporting a PR
missing that existed, once reporting a live specialist as finished
(`docs/status-cli-sdd.md:6`). The repo's governing invariant applies: anything
past raw agent output is a deterministic, tested CLI, and judgement stays in
prose. `aipe status` is that CLI — the single source of the parallel-work
picture, derived once and shown on three surfaces.

## One derivation, three surfaces

The core is a pure function `assemble(input): StatusReport`
(`src/status/assemble.ts:135`) fed by a single I/O boundary `loadReport(workspace,
opts)` (`src/status/load.ts:31`). Three consumers call the same path and never
re-derive: the `aipe status` command, the post-change **delta**, and the
SessionStart **state block**. `loadReport` reads four things — the journey
ledgers (the source of who/what/repo/status), the persona roster (role
resolution), the model policy (gated-tier detection) and the brain (context name
+ preference) — in parallel (`src/status/load.ts:32`).

The `StatusReport` has four data groups (`src/status/types.ts:82`): `journeys[]`
(open/done/total rollups), `units[]` (one `UnitRow` per dispatch: fqid,
specialist, role, branch, PR, status, mode, sessionId, liveness, hasEvidence —
`src/status/assemble.ts:53`), `waiting[]` (what blocks the PE), and the
`liveness`/`pref`/`elision` metadata.

**"Waiting on you"** is the report's spine: `waitingItems`
(`src/status/assemble.ts:92`) emits one row per distinct block — `gated` (a policy
tier the journey has not been granted, unit still open), `escalated`,
`redirected`, `blocked`, and `no-evidence` (a delivered/verified unit missing its
evidence). A single unit can raise several.

## Liveness is honest by construction

Liveness reuses the exact function `aipe session collect` runs —
`dispatchPhase` (`src/session/poll.ts:94`), extracted so both obey one honesty
rule. Subagent units are `null` (there is no session to poll); no sessionId is
`dead-silent`; a session list that cannot be read reliably is `unknown` and is
**never** flipped to "dead" (`resolveLiveSessions`, `src/status/liveness.ts:18` —
agentop absent ⇒ `source:"none"`; a non-zero exit or unparseable JSON ⇒
`reliable:false`, "cannot tell", not "nobody"). agentop's own `activity` field is
deliberately never consulted for the alive-vs-dead axis
(`src/session/poll.ts:90`). The display labels (`alive` / `silent` / `unknown`)
are render-time strings in `liveCell` (`src/status/render.ts:102`), not the
internal enum.

## The delta: show only what a change touched

After a state-changing command, `aipe status` prints a **delta** — only the units
the change touched, plus the frame around them (in-flight + waiting), as a few
short tables (`renderDelta`, `src/status/render.ts:209`; emitter `logStatusDelta`,
`src/status/delta.ts:46`). Two call sites are wired: after `session dispatch`
(changed = that journey's session-mode units) and after each landing `journey
record` (changed = the exact repo/package/task/specialist recorded —
`src/journey/cli.ts:201`). Both are wrapped so a **display failure never undoes
the dispatch or the record** (`src/status/delta.ts:46`).

The delta prints only when **three gates all pass** (`src/status/delta.ts:50`):
not silenced (`--no-status` or `AIPE_STATUS_DELTA=off/0/false/no`), stdout is a
TTY (so pipes and hooks never receive a table), and the saved preference
`auto === true`. Off a terminal it is silent by default.

## SessionStart state block, and the preference

When a coordinator session starts with no repo at cwd, the SessionStart hook
appends a **state block** (`src/session-hook/read-state.ts:229`) — the same
`StatusReport`, rendered by `renderStateBlock` (`src/status/context-block.ts:34`),
budget-capped at 900 characters, richest-first, always preserving the counts and
the "run `aipe status`" pointer. It is produced with `liveness:false` so the hook
**never shells out to agentop** and stays fast (`src/status/load.ts:24`); it only
appears once all three onboarding phases are `done` (`safeStateBlock`,
`src/session-hook/read-state.ts:243`).

The **preference** (`context.statusUpdates: { auto, format }` in the brain,
`src/context-brain/types.ts:48`) controls whether the coordinator auto-pushes a
status table after each change, and in which format (detailed | compact).
**Absence means `auto:false, format:"detailed"`** (`DEFAULT_STATUS_PREF`,
`src/status/types.ts:19`; the read path never throws and never migrates,
`src/status/pref.ts:12`). It is toggled without redoing onboarding via `aipe
status config [--auto true|false] [--format detailed|compact]`
(`src/status/config.ts:31`), and reaches the coordinator two ways: as the
awareness clause "STATUS UPDATES: auto-push is ON/OFF"
(`src/session-hook/awareness.ts:43`) and inside the report's `pref`.

## Commands

- **`aipe status [--journey <id>] [--all] [--json] [--compact|--detailed]`** — the
  human table (JOURNEYS / UNITS / WAITING ON YOU / NOTES), `--json` for the
  assembled shape verbatim. Default scope is open-work journeys plus the 3 most
  recent closed ones carrying at least one dispatch (`src/status/scope.ts:27`;
  empty journeys never take a slot, and the elision is noted in NOTES).
- **`aipe status config [--auto …] [--format …]`** — read/set the preference; no
  flags prints the current value.

## Left open / notes for a reader

- The SessionStart block and the delta use **two different definitions of "in
  flight"** for the same word — the hook uses ledger status
  (dispatched/delivered, because it must not shell out), the delta uses resolved
  liveness phases. Same concept, two derivations; a reader comparing the two
  surfaces will see different membership. This is intentional
  (`src/status/context-block.ts:22` vs `src/status/render.ts:207`).
- `aipe status config` rewrites `brain.yaml` through `stringify`, which preserves
  key order but **strips YAML comments** — the same way every other
  context-brain writer touches the file. The byte-for-byte guarantee in the SDD
  covers only the *read* paths (`docs/status-cli-sdd.md:66`). Flagged in the
  dossier's [divergences appendix](README.md#appendix--divergences-escalated-not-cosmetic).
