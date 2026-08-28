# SDD — `aipe status` (journey j-20260825-yn)

Spec/plan committed with the code, per the Orientation Spec (three layers: v1
items 1–7, v2 items 8–9, v3 item 10). One unit (`aipe`), one PR.

## Problem

Mid-session the PE said: *"tem muita coisa aqui e tem muita sessão aberta em
paralelo e eu não sei o que que é cada uma"*, then *"me faz uma tabela direta:
quem, o que, repo, status"*. Answering meant six commands by hand, three files
cross-referenced, and a table hand-assembled in chat — which the coordinator got
wrong twice (a PR reported missing that existed; a live specialist reported
finished). The framework invariant: **everything past raw agent output is a
deterministic, tested `aipe` CLI; judgement lives in skill prose.** A tested
renderer removes a class of coordinator error.

## The one calculation, three surfaces (no duplicated derivation)

The core is a single pure derivation, `assemble(): StatusReport`, fed by one I/O
boundary, `loadReport()`. Every surface consumes that report:

1. **`aipe status`** (item 3) — a human table (default) or `--json`.
2. **The post-change delta** (item 9) — after `session dispatch` / `journey
   record`, the changed units + the frame around them.
3. **The SessionStart state block** (item 8) — where the work stands, injected
   into every coordinator session.

`StatusReport` (src/status/types.ts): `journeys[]` (id, spec approval+version,
open/done counts), `units[]` (fqid, persona+role, branch, PR, status, mode,
sessionId, liveness, evidence), `waiting[]` (gated · escalated · redirected ·
blocked · no-evidence), `liveness` (source + reliability + honest note),
`pref` (the item-10 follow-preference), `elision`.

## Module map (`src/status/`)

| File | Responsibility |
|------|----------------|
| `types.ts` | The `StatusReport` shape and the follow-preference type. |
| `assemble.ts` | The pure derivation. Reuses `poll.dispatchPhase` for liveness and `journey/ledger.grantedTiers` for gating. |
| `scope.ts` | Default/`--journey`/`--all` selection + elision (open work + N recent closed; empty journeys never eat a slot). |
| `liveness.ts` | Asks agentop once; a failed/unparseable list is "cannot tell", not "nobody". |
| `pref.ts` | Read-path preference parse — degrades silently, never throws, never migrates. |
| `render.ts` | Aligned grid (glyph-width, no trailing whitespace), detailed/compact, JSON, and the delta. |
| `context-block.ts` | The item-8 state block, budget-capped (`STATE_BLOCK_MAX`). |
| `config.ts` | `aipe status config` — the typed change-your-mind path. |
| `load.ts` | The shared I/O boundary; degrades cleanly on a partial workspace. |
| `cli.ts` | `aipe status` + `aipe status config`. |
| `delta.ts` | The item-9 emitter (TTY + preference + silence gates; never breaks the operation). |

## Liveness must not lie (item 5)

Liveness is decided by `poll.dispatchPhase`, extracted from `session/poll.ts` so
`status` and `session collect` obey the *same* rules (D6). agentop's `activity`
field is never consulted (it reported `waiting` for a session mid-tool-call).
`alive`/`silent`/`unknown` are distinct; a failed or unparseable `session list`
is `reliable:false` → in-flight units degrade to `unknown`, never flipped to dead
(the dangerous direction); agentop absent → `unknown`, and the report says so.

## Item 8 — state at SessionStart, without breaking the session

`session-context` appends the state block only for the coordinator context and
only after onboarding is complete. It is fully guarded (`safeStateBlock`): any
failure degrades to today's context, and it does **not** shell out to agentop
(`liveness:false`) so the hook stays fast. Budget: `STATE_BLOCK_MAX` chars, tested
— when it overflows, names drop but the counts and the `aipe status` pointer
always survive. `read-state`'s `formatFields` (the KEY=value block the hook
parses) is **byte-for-byte unchanged** — proven: its source is identical to
`origin/main`. The preference reaches the coordinator on `Fields.statusUpdates`,
so it survives even if the richer block cannot be assembled.

## Item 9 — the delta, silenceable and auto-silent off a TTY

`logStatusDelta` prints only when all three gates are open: not silenced
(`--no-status`/`AIPE_STATUS_DELTA=off`), stdout is a TTY (auto-silent otherwise,
so a piped/parsed consumer never gets a table), and the follow-preference is
`auto:true`. It is wrapped so a display failure can never lose a dispatch or a
ledger record. Read-state/hooks never call it.

## Item 10 — the preference is a question, and the switch for item 9

`context.statusUpdates: { auto, format }` lives in the brain, written only by the
typed CLI. Invariants:

1. **Absence = `auto:false`.** The read path never throws, never migrates. Proven
   against the real 303-line brain (loads unchanged; every read path leaves the
   file byte-for-byte — md5 identical before/after).
2. **The voice always works.** `auto:false` silences the *push*; the *pull*
   (`aipe status`, voice triggers) is unconditional — encoded in the operate
   skill prose.
3. **On-the-spot format wins.** `--compact`/`--detailed` override the saved
   preference for one render without touching the brain.
4. **`add-repo` does not re-ask** and does not lose the field — it round-trips
   through the same parse→stringify (proven by test).
5. **Change your mind later** — `aipe status config --auto … --format …`, in
   `--help`; never hand-edited YAML.
6. **Typed validation.** The write path is loud: an invalid `format`/`auto` is a
   legible `ValidationError`, never a crash or silent default (opposite of the
   read path, which degrades so a hook never breaks).
7. **(10) is the switch for (9).** `auto:true` → the delta fires; `auto:false` →
   silent. Both formats reuse the item-3/8 derivation.
8. **The coordinator learns the preference** via the SessionStart awareness
   (`STATUS UPDATES: auto-push is ON/OFF`), two fields, not a ledger dump.

## Coordinator side (item 7)

`skills/operate/SKILL.md` gains a "Status reports for the PE" section (pull
triggers, format override, the auto-push switch, scope discipline); the README's
Operation section documents `aipe status`. Judgement (when) stays in prose; the
data (what) is the tested CLI.

## Test plan (RED→GREEN)

Fixture and pure-unit tests over: unit/journey/session assembly; the
waiting-on-the-PE derivation; scope + elision; render alignment/format/JSON; the
delta gates; the state-block budget; the preference parse (all four cases +
invalid); `config` round-trip + rejection; `add-repo` preservation; and every
degradation case (empty workspace, malformed ledger, zero-dispatch journey,
agentop absent). Gate: `version:check` → `typecheck` → `bun test` → build smoke,
plus the command driven against the real five-plus-journey workspace.
