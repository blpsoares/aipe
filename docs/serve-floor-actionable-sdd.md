# The Floor, made actionable — legibility for a reader with no AIPe vocabulary (SDD)

> Journey `j-20260826-uu`, unit `aipe` (Jesse, dev-fullstack). This is the
> committed spec + plan that travels with the PR. The cross-package shape lives
> in the approved Orientation Spec (`.aipe/journeys/j-20260826-uu/orientation.md`,
> incl. the "Adicionado em v2" section). `aipe skill match` → no SDD kit in this
> workspace, so this is hand-authored.

## Problem (from the Orientation Spec)

The PE opened The Floor and could not use it: *"não me diz nada, não sei o que
preciso fazer, onde fazer, como fazer… como ir resolvendo as pendências pra ir
sumindo as pendências."* The v1.1.0 Floor was built to **inform**; the PE needs
it to let them **resolve**. Concretely:

1. Every pending item must answer four questions in the PE's own framing — **what**
   it is (plain language, never the machine token), **why** it appeared, **what to
   do** (with the exact command, copyable in one click; the console stays
   read-only and never executes), and **where** (repo, unit, branch, worktree,
   journey).
2. **Resolved means gone** — the list shrinks on its own via SSE; no manual dismiss.
   An item the PE cannot resolve by any action does not belong in a *decision*
   inbox — it goes to observations, and says why it is there.
3. **No unexplained jargon anywhere** — each term explains itself in place (hover /
   gloss / link to the status guide) or is rewritten. The test is a reader with
   no AIPe vocabulary.
4. **Repo rows must earn their space** — the row itself answers "is anything here
   waiting on me, and what?", not just collapsed counters.
5. Fix the five Important interface-sweep findings (they are the same screen).

Plus the **v2 addendum**: the Decision Inbox and the header must count **the same
thing** — the PE saw "12 precisam de você" in the header and "9" in the
coordinator panel.

## The v2 diagnosis, corrected

The v2 addendum diagnosed a *second* copy of the D5-twin living in
`src/dashboard/snapshot.ts` with its **own** `dependency-not-landed` derivation,
divergent from the fixed `src/journey/verify.ts`. **That is already fixed in the
base.** Commit `f7a1a0c` ("attention do console = motor do journey verify — fonte
única") made `computeAttention` call `verifyJourney` directly; `snapshot.ts` has
no independent derivation. Confirmed against the real workspace: `attention` and
the CLI agree (zero `dependency-not-landed` for out-of-demand producers).

**So the "12 vs 9" contradiction is not a server divergence — it is client-side.**
Three surfaces counted three different things off the *same* data:

- the header (`WizardRail`) counted the **raw `attention` array** (all findings,
  incl. warnings);
- the Decision Inbox, the mobile FAB and the coordinator panel counted the
  **derived decision list** (`buildDecisionInbox`, filtered + client-derived).

Against the live workspace today that was **0 vs 1** — still a contradiction. The
fix is a single count source, not a change to `snapshot.ts` (which was already
right). This is documented here because the addendum pointed at the wrong file.

## Design

### One count, everywhere (`runtime/store.ts`)

`decisionInbox` (unchanged engine) is split by a new `section` field into
`decisions` (only the PE can unblock) and `observations` (the coordinator / dev /
QA resolve). **`needsYouCount = decisions.length`** is the single "N need you"
number the header, the inbox badge, the mobile FAB and the coordinator panel all
read. No two numbers on the Floor can contradict again. (Also fixed a raw-JSX
render bug in `floor.view.tsx` where the FAB ternary printed as literal text.)

### The two sections answer "what needs ME?"

- **Precisam de você** — `escalation`, `gated`, `dead-silent`. Only the PE
  unblocks these. The empty list IS the success state.
- **Observações** — `no-evidence`, `failed-open`, `dependency-not-landed`,
  `qa-gap`, `redirected`, `blocked`. Real findings, but the coordinator/dev/QA
  own them. Shown apart, each naming who is handling it — so the PE is informed
  without being nagged to act on something they cannot (Spec §2). Against the real
  workspace this turns "1 false decision" into "0 decisions + 1 observation the
  coordinator is already handling" — the truthful state.

### Every item's four answers + its command (`runtime/floor.ts` `decisionAction`)

A pure mapping `DecisionItem (+ its dispatch, + the workspace dir) → ActionCard`:
`{ whatKey, whyKey, todoKey, actorKey, vars, command, commandNoteKey?, where }`.
Rendered by `DecisionInbox`'s `ActionRow`. Highlights:

- **what** — plain PT, never the token (`dependency-not-landed` →
  "Uma unidade entregou apoiada em outra que ainda não concluiu").
- **why** — interpolated with the specific unit / journey / producer / specialist.
- **what to do** — the concrete step **and** the exact command. The workspace dir
  now travels to the client (`Snapshot.workspaceDir`), so every command is
  `--workspace <the real absolute dir> --journey <id>` — copyable and correct for
  this machine, not a placeholder. One-click **Copy** (clipboard; read-only).
- **where** — repo · branch · worktree · journey · PR link, from the dispatch.
- **actor** — who acts next (you / the coordinator / the dev / QA).

**Commands are all read-only** and verified: `aipe journey show|verify
--workspace <ws> --journey <id>` and `git -C <worktree> log --oneline -20`. Where
no shell command resolves an item (a gated envelope — the PE authorizes in the
coordinator session), the card is **honest**: "Sem comando — você autoriza na sua
sessão do coordenador", never a fabricated command.

> **Decision: `redirected` shows `journey show`, not `journey reconcile`.**
> `aipe journey reconcile` auto-detects *merged PRs* — a different job — and
> mutates the ledger. Reconciling a spec after a live redirect is a coordinator
> judgment with no single command, so the card shows the read-only ledger state
> and names the actor. This keeps the read-only guarantee intact.

### Resolved means gone (Spec §2)

Every row derives from the snapshot via computed signals, so when the underlying
condition clears, the next SSE frame drops the item — no manual dismiss, no stale
card. Covered by a test that runs the pure engine one frame later.

### Blocked renders as blocked (defect D7)

The `blocked` ledger status (the j-20260825-84 signal) now has a first-class
`Phase`, an amber tone, a decision-inbox observation, and a coordinator-panel
line — "travado — o coordenador deve uma resposta". The panel can no longer infer
"está construindo" from a stalled unit. Derived client-side from the dispatch
status, because the server's `attention` array carries only criticals +
escalations (a warning-level block would never reach the client otherwise); this
is presentation only — the signal itself is not this journey's work.

### Repo rows earn their space (Spec §4)

Each row leads with the answer: **"N precisam de você"** (rose) when a decision
touches this repo, else **"nada aqui precisa de você"**, plus a plain-language
summary ("1 aguardando QA · 5 em andamento · 2 observações"). The status counters
remain as secondary detail, now with per-state hover glosses.

### No unexplained jargon (Spec §3)

In-place hovers gloss the surviving vocabulary — `spec`, `wave`, `cost-index`,
`serializing` ("em fila" in PT) — each pointing at what it means; the status
guide continues to document the full vocabulary. Machine tokens are gone from the
inbox entirely.

## The five Important interface-sweep findings

- **Horizontal overflow from the off-canvas `WorkerDrawer`** (`base.css:352`) —
  the drawer + scrim now render inside the fixed, overflow-clipped `#overlay`
  (the CSS already existed; the component was not using it). No page scroll width.
- **Back/forward to the Floor desynced topbar + nav** (`router.ts`) — a new pure
  `hashTarget()` maps an empty / bare `#/` hash on a hashchange to the Floor, so
  navigating back re-syncs `currentPath`.
- **Theme not persisted; Settings segment disagreed with the Topbar toggle** —
  a new `runtime/theme.ts` is the single source both controls go through;
  persisted to `localStorage["aipe-theme"]` and applied before first paint (inline
  boot script in `shell.html`), mirroring how language already persisted.
- **Command palette did not close after a goto/action** (`CommandPalette.tsx`) —
  `runItem()` dismisses the palette after every command (Enter and click).
- **"Write orientation spec" was a dead control** (`CommandPalette.tsx:88`) —
  removed. The read-only console authors no specs; a control that did nothing is
  not presented.

Minor findings from the sweep: not taken in this PR (scoped to the five Important
+ the actionability rework); noted for a follow-up.

## Tests (RED→GREEN)

Pure logic first: `decisionAction`'s four-answer + command mapping and the
decision/observation split (`floor-actionable.test.ts`); disappear-when-resolved;
`producerOf`; blocked phase + coordinator line; the single-count agreement. Each
Important fix has a test (`theme.test.ts`, `router.test.ts`, palette-close and
writespec-removed in `command-palette.test.tsx`, `#overlay` in
`worker-drawer.test.tsx`). Integration: a decision card renders the four answers +
a real copyable command, and the header count equals the inbox count
(`floor.view.test.tsx`).

## Comprehension audit (the ultracode pass)

The PE authorised ultracode to *explore and judge* the information design rather
than first-draft it. After the build, a 4-agent adversarial audit read the
rendered copy as three no-AIPe-vocabulary personas (non-technical PM; tech lead
with zero AIPe vocab; a skeptic hunting the original failure) and a synthesiser
ranked the gaps. Two of its "blocking" gaps were **artifacts of the audit's copy
digest, not the live screen** — it saw `<dir>/<id>` placeholders and "no command
on observation cards", but the live UI interpolates the real workspace/journey
into every command and shows a command on every card except the honest
no-command gated one (verified in-browser). The genuine gaps it surfaced were
folded in here:

- **Core nouns had no first-appearance gloss** — `unidade`, `jornada`,
  `coordenador`, `QA` now carry in-place hovers, and `coordenador` is defined as
  the orchestrating agent you talk to in *your coordinator session*.
- **"1 unidades"** pluralisation fixed → "1 unidade".
- **`wave` vs `onda`** — unified to `onda` in PT.
- **The gated card sent you to an undefined place** — its note now names the
  coordinator session (terminal/chat) so the one command-less "you act" card has a
  destination.

Deferred (noted for the Wave-2 QA comprehension gate, lower-risk polish): tighter
repo-row legibility with per-state legends and reconciled subtotals; a single
executor term (dev vs especialista); a plain-language pass on the observation
metaphors (aterrissar/reconciliar/produtora-consumidora) and on the card type
labels (GATED/NO-EVIDENCE). These are refinements on top of a screen that now
passes the core "what needs me / what to do / where" test.

## Verification

`bun test` green (1336), `bunx tsc --noEmit` silent, `bun run build:host` compiles
and the binary serves it. Driven against the **real workspace** (16 journeys):
header, inbox and coordinator all read the same count; the one real pending item
(a redirected unit) renders as an *observation* the coordinator is handling, with
its exact `aipe journey show` command — not a false "decision". Both `journey
show` and `journey verify` from the cards were run and produce correct output. A
crafted demo journey exercised the populated decision section (gated + escalation
+ blocked + no-evidence) to walk every card top to bottom; both themes complete,
no site-origin console errors, `prefers-reduced-motion` honoured.
