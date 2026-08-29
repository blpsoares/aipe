# Dossier 22 — Web Console redesign (Agora / Equipe / Histórico, the 4-column board, org fit-to-view)

**Status:** Merged (`cc3a5d5`, PR #34, 2026-08-29; journey `j-20260827-s9`).
**Spec:** [`docs/serve-console-redesign-sdd.md`](../serve-console-redesign-sdd.md).

## What this is for

[Dossier 08](08-web-console.md) built the console — a Preact + `@preact/signals`
SPA served over `/api/snapshot` + SSE + a terminal WebSocket. It then **grew to
~10 views** (`floor`, `overview`, `pipeline`, `activity`, `monitor`, `org`,
`team`, `toolbox`, `status`, `settings`), which the SDD diagnoses as "4 photos of
`dispatches` + 2 of `workers`" — redundant cuts of the same data
(`docs/serve-console-redesign-sdd.md:28`). This redesign replaces the
**information architecture, not the transport**: the same SSE snapshot now feeds
three primary screens built around the questions a PE actually asks. The commit
deletes eight view files (and their tests) and renames `status → guide`.

## Three screens, each answering one question

The final view set is exactly five, declared in `routes.generated.ts` and sorted
by `nav.order`; the three non-footer routes are the primary nav and the mobile
tabbar (`components/BottomNav.tsx:8`):

| View | Route | Answers | Backing |
|---|---|---|---|
| **Agora** (Now) | `/` | "What needs you now + what's live." | `views/agora.view.tsx:141` |
| **Equipe** (Team) | `/team` | "Who is the team, how it's organized, what it can do." | `views/equipe.view.tsx:216` |
| **Histórico** (History) | `/history` | "What happened + how much was delivered." | `views/historico.view.tsx:72` |
| Glossário | `/guide` | jargon → plain language (footer) | `views/guide.view.tsx:110` |
| Ajustes | `/settings` | theme, language, notifications (footer) | `views/settings.view.tsx:153` |

**Agora** is built in three zones of progressive disclosure
(`views/agora.view.tsx`): *NeedsYou* — decision cards, with a calm "all clear"
empty state; *HappeningNow* — the live `working` column, one row per active
specialist; and *WholeBoard* — the full 4-column board plus "handled by others",
collapsed by default. **Histórico**'s metrics block is an **honest placeholder**:
it renders the real `delivered` count tile next to a `—` "not measured yet" pill,
because the per-period/per-project metric mechanism is a separate journey,
explicitly out of scope (`views/historico.view.tsx:12`).

## The 4-column board

Runtime in `runtime/board.ts`, rendered by `components/Board.tsx`. The columns
(`runtime/board.ts:19`) are **Working / Needs-you / In-review / Ready-to-merge**.
`columnOf(d, session)` (`runtime/board.ts:50`) maps by ledger status first, then
canonical liveness: `verified → ready`; `delivered → in-review`;
`failed/escalated/blocked/redirected → needs-you`; `merged/removed → off-board`
(they live in Histórico); otherwise a live/dispatched unit whose liveness is
`dead-silent`/`waiting`/`redirected`, or which is waiting on human approval, goes
to **needs-you**, else **working**.

Two things make this the cure for the old "spread across tabs" defect. First, each
card carries **persona + status chip + fqid/task + branch + actor + PR together**
(`components/Board.tsx:37`) and opens the worker drawer on click. Second, the board
reads **canonical liveness computed server-side** — `d.liveness`, a `UnitPhase`
produced by `annotateLiveness` calling the *same* `dispatchPhase` that `aipe
status` runs (`serve/payload.ts:71`; `src/session/poll.ts:94`) — it never
re-derives liveness in the browser. Two named traps are handled at that layer: a
live session whose agentop `activity === "waiting"` is waiting on a **person** and
is routed to needs-you, not working (`isWaitingApproval`, `runtime/board.ts:42`);
and a `dispatched` record whose worktree is gone from disk is forced to
`dead-silent` independently of agentop, so a dead record never shows as working
(`serve/payload.ts:77`). An unreadable `agentop session list` yields
`reliable:false → unknown`, never a mass "dead" (`serve/sessions.ts:112`). The
needs-you column is sorted PE-first via `boardActor`/`ACTOR_RANK`
(`runtime/board.ts:74`), so the cards the PE must act on rise to the top.

## Org fit-to-view

The old org chart started at a fixed `scale 1` and overflowed its container. The
fix is `fitTransform(content, viewport, margin)` (`runtime/org.ts:116`) — scale =
`min(availW/contentW, availH/contentH, 1)`, clamped to `[0.3, 3]`, centred, with
degenerate inputs collapsing to identity so no NaN precedes layout. `fitToView`
re-frames from the published `orgContent` size (`runtime/org.ts:131`), and — the
key behavioral detail — `zoomBy` with `dir === 0` (**reset**) calls `fitToView`,
not a blind return to `scale 1` (`runtime/org.ts:138`). `OrgChart.tsx` publishes
its rendered size and fits on mount, re-fits on a `ResizeObserver` (guarded for
test DOM absence) and on double-click; the SVG renders as `translate scale` with
`transform-origin: 0 0` to match the fit math (`components/OrgChart.tsx:194`,
`:267`, `:311`). A CSS constraint fix stops the wrap growing to the SVG's intrinsic
width (`.orgwrap` gets `overflow:hidden` and the grid item `min-width:0`).

The fit was proven in the **compiled binary** at ~1920px (`scale(0.337)`) and
~1366px, with `reset` re-framing via `fitToView`
(`docs/serve-console-redesign-sdd.md:319`). The QA method note is worth keeping for
a future maintainer: the automation harness was **pinned at 2560px** and could not
narrow the window, so responsive behavior below ~2560px was verified through a
fixed-width viewport rather than a real resize (`docs/serve-console-redesign-sdd.md:240`).

## i18n

The console is bilingual **EN (default) + PT**, a single `STR: Record<Lang,
Record<string,string>>` object with `Lang = "en" | "pt"` (`runtime/i18n.ts:3`).
`t(k)` resolves current-lang → en fallback → raw key; the language is persisted in
`localStorage["aipe-lang"]` and toggled from Settings. **Key parity is
test-enforced** — `i18n.test.ts` asserts `STR.en` and `STR.pt` carry exactly the
same keys. This is entirely self-contained in `src/serve/app/runtime/i18n.ts`; the
parallel `i18n-console` journey (`j-20260829-w2`) belongs to a **different repo**
(`openvibes-embark`) and does not touch this file.

## Left open / a divergence to escalate

An honesty-rule tension surfaced while documenting the board. The SDD (§11.3,
`docs/serve-console-redesign-sdd.md:406`) states liveness `unknown` "never becomes
'working' nor 'dead'." But `columnOf` falls through to `return "working"` for
`unknown` (`runtime/board.ts:66`), and Agora's *HappeningNow* renders the `working`
column as "specialists working this moment" (`views/agora.view.tsx:50`). The only
mitigation is a text flag — `CardNote` shows a "can't verify right now" label on
the card (`components/Board.tsx:33`). Net: an unverifiable unit is physically
placed under "Working / Happening now" with a caveat, which is in tension with the
SDD's own honesty rule. It is soft (labeled, not silent) but it is a real
doc-vs-code divergence; recorded in the dossier's
[divergences appendix](README.md#appendix--divergences-escalated-not-cosmetic) and
escalated, not fixed (I am scoped to `docs/dossie/**`).

Also deliberately absent: a **sub-task** visualization. This board is a kanban of
*dispatches*, not of the sub-tasks a single dispatch may fan into under the
path-lock of [dossier 18](18-path-lock.md) — that view remains blocked on purpose
(see the [README roadmap](README.md#roadmap--verified-against-code)).
