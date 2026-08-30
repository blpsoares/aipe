# The execution envelope: pricing a task before it runs

Before a unit is dispatched, AIPe decides *how* it will run — and it prices every
way it could, so the choice is made with cost visible rather than after the bill
arrives. That bundle of decisions is the **execution envelope**. The point of the
abstraction is separation: the CLI enumerates and prices the options; the
coordinator, which has context the code does not, chooses; and the policy gates
constrain both.

## Four axes

An envelope is exactly four axes — no more (`src/execution/types.ts:20`):

- **mode** — `subagent` or `session`. A subagent runs inside the coordinator's
  own context; a session is a detached agent with its own context window, opened
  through `agentop`.
- **harness** — which agent harness runs it (`claude-code`, `gemini`, …).
- **tier** — an abstract model tier: `fast | standard | reasoning | frontier`
  (`src/model/types.ts:6`).
- **intensity** — `normal` or `ultracode` (multi-agent orchestration).

A *priced* envelope adds a coarse `costIndex`, a `gated` flag, and the reasons it
is gated (`src/execution/types.ts:28`). The chosen envelope is recorded on the
ledger dispatch row (`tier`, `model`, `mode`, `intensity`, `harness` —
`src/journey/types.ts:99`), so an audit can see not just *what* was built but
*how much machine* was pointed at it.

## Propose prices; it never chooses

`aipe execution propose` enumerates the full cross-product of mode × tier ×
intensity for every present harness and prices each
(`src/execution/propose.ts:82`), then sorts cheapest-first so the default reading
is the cheap one (`src/execution/propose.ts:101`). It deliberately does **not**
pick: the choice, and the reasoning behind it — that this bugfix touches auth,
that this unit depends on a contract not yet landed — belong to the coordinator,
which has that context and the code does not (`src/execution/propose.ts:1`).
`propose` is pre-choice; `plan` is post-choice, run once the PE has approved the
spec and the envelope is recorded per unit (`src/execution/cli.ts:2`).

The cost index is a coarse relative proxy, never currency: mode × tier ×
intensity, where the cheapest envelope (subagent + `fast` + `normal`) is 1
(`src/execution/cost.ts:20`). `ultracode` multiplies by 8 — the single largest
lever, which is why it is gated.

## Session mode must be governable

Not every harness may run in session mode. The rule is one line: a harness is
session-eligible only if it can be **contained** — governed by a block-before-
execute hook trusted with no human present. `propose` consults the single
authority (`isContainable`) and excludes session mode for a non-containable
harness with the reason *"not containable — AIPe never starts a session it cannot
govern"* (`src/execution/propose.ts:73`). Subagent mode is always offered for a
recognized harness; only session mode is gated on containment. The same guard is
re-consulted, never reimplemented, at plan time
(`src/execution/cli.ts:290`) — because `aipe dispatch validate` is advisory and a
ledger unit can name any harness, so the binding check runs on the path that
actually starts a session. See `unsupported.md` and the `harness-containment`
diagram for *why* codex and copilot are not containable, and for the wider
three-state containment ledger (`src/harness/compat.ts`) that also records `cursor`
as proven non-containable and `antigravity` as unestablished.

(A subtle trap the code guards: the adapter registry falls back to `claude-code`
for an unknown id, so asking `isContainable` about a nonsense harness would
wrongly answer *true*. `propose` checks the registry directly first and excludes
an unregistered harness before ever asking about containment —
`src/execution/propose.ts:63`.)

## What the PE must authorize

Two axes are gated behind an explicit, recorded PE authorization. The default
execution policy gates the `ultracode` intensity and the `frontier` tier
(`src/execution/policy.ts:8`), and `gateReasonsFor` attaches a human-readable
reason to any envelope that trips one (`src/execution/propose.ts:15`). At the
**wave** level, two more limits fire: more concurrent sessions than the policy's
gate, and a wave whose summed cost index exceeds the ceiling
(`src/execution/waves.ts:44`). These are the limits the PE does not negotiate,
and the policy clamps itself so they can always fire — `maxSessionsPerWave` is
clamped to the session ceiling and never raised (`src/execution/policy.ts:40`).

The model layer mirrors this. `gateFor` returns `needs-authorization` for a
policy-gated tier that the journey has not been granted
(`src/model/resolve.ts:25`), and the grant is a `JourneyAuthorization` recorded on
the ledger only after the PE says yes in the live session
(`src/journey/types.ts:120`); `grantedTiers` reduces those grants to the set the
gate consults (`src/journey/ledger.ts:218`). A second, softer gate watches
*volume*: past a threshold of `reasoning`-tier dispatches in one journey, the
model check returns `notify` — the coordinator must tell the PE, though it never
blocks (`src/model/check.ts:14`). Opus is the deliberate `reasoning` escalation
that this volume gate watches.

## Tier is abstract; the model is per-harness

A tier is not a model — it is a role a model plays, resolved per harness. Each
adapter maps the four tiers to concrete ids: for Claude Code, `fast` → Haiku,
`standard` → Sonnet, `reasoning` → Opus, `frontier` → Fable
(`src/harness/claude-code.ts:193`); Gemini, codex and copilot each carry their own
table. A harness with no mapping (the generic adapter) returns `null`, and the
coordinator falls back to the session default — but the tier's policy gates still
apply either way (`src/harness/types.ts:149`). This is why the envelope stores
both `tier` (the policy-bearing abstraction) and `model` (the concrete id that
actually ran).

## The concurrency ceilings

Two hard ceilings bound a wave. Subagent concurrency is capped at 16 — the
dispatch law's real limit (`src/dispatch/types.ts:41`). Session concurrency is far
lower, 4: sixteen real sessions, each with its own context window and some fanning
out under `ultracode`, is a different order of cost entirely
(`src/dispatch/types.ts:46`). The session cap is the default `maxSessionsPerWave`
and the hard clamp the policy cannot raise.

---

**What breaks if you touch this.** The propose/choose split is load-bearing: if
the CLI started choosing, it would be choosing without the context that makes the
choice correct. The containment gate on session mode is the safety property —
`unsupported.md` covers what happens when a harness cannot pass it. And the gates
are the PE's cost controls; the honest limit today is that the cost index is a
*relative* proxy, not real token or dollar metering (`docs/dossie/14-execution-
envelope.md:197`) — do not read a costIndex as a budget. Foundational record:
`docs/dossie/14-execution-envelope.md` and `12-model-policy.md`.
