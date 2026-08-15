# Execution-envelope recommendation — design

**Status:** Approved, ready for planning.
**Origin:** brainstorming session, 2026-08-15.
**Builds on:** [`2026-08-14-agentop-session-dispatch-design.md`](2026-08-14-agentop-session-dispatch-design.md)

## Purpose

Session-mode dispatch gave the coordinator four axes it can vary per unit of
work: `mode` (in-process subagent vs. detached `agentop` session), `intensity`
(normal vs. `ultracode`), `harness` (which CLI runs the specialist), and
`tier`/`model`. All four are already recorded in the ledger and already pass
through the PE's approval of the Orientation Spec.

What is missing is the part that makes those axes worth having: **the
coordinator does not recommend, and cannot**. It does not know which harnesses
this machine actually has, what each combination costs, or which ones the PE
considers worth an authorization. Today the envelope arrives at the gate empty
and the PE fills it in from nothing.

The result is that the cheapest correct choice is rarely made. A one-line
rename runs on the same envelope as a cross-repo refactor, because nobody had
the information to say otherwise at the moment the decision was taken.

This spec makes the coordinator **arrive at the existing gate with a filled,
justified envelope** — and makes the expensive half of that judgement (what is
available, what is eligible, what it costs) a deterministic, tested `aipe`
subcommand rather than model arithmetic.

### What this is not

- Not a new gate. The PE already approves the Orientation Spec; that gate stays
  where it is and keeps its meaning. Only what arrives at it changes.
- Not an autonomous spender. The policy names which choices the coordinator may
  take on its own and which need a signature; nothing above the line executes
  unasked.
- Not a replacement for the coordinator's judgement. The proposal enumerates and
  prices; it never chooses.

## Architecture

Three pieces, each with one responsibility.

### `src/capabilities/` — what this environment can actually do

Probes for the harness binaries (`claude`, `gemini`, `codex`, `copilot`),
cross-references them against what `agentop` can start and which adapters are
containable, and writes `.aipe/capabilities.yaml`.

**A probe result is a claim with a date, not a fact.** A binary on `PATH` is not
an authenticated binary, and a harness that was containable last month may not
be after a CLI update. The file therefore records, per harness: what was
detected, how it was detected, when, and whether the PE has confirmed it. The
PE confirms on first run and can correct at any time; a correction outranks a
probe.

Rationale for probe-then-confirm rather than either alone: silent probing turns
an unauthenticated binary into a session that fails at dispatch, discovered
late; pure declaration goes stale the first time the PE installs something and
does not think to tell AIPe.

### `.aipe/execution-policy.yaml` — the limits the PE does not negotiate

Deliberately the sibling of the existing `.aipe/model-policy.yaml`, in the same
shape, read by the same kind of loader with the same conservative fallback when
absent or malformed. It carries:

- the ceiling on concurrent sessions per wave (default: the existing
  `SESSION_MAX_CONCURRENT` of 4 — the policy may lower it, never raise it past
  what the dispatch law already enforces);
- which choices require the PE's signature. Defaults: `ultracode` always, tier
  `frontier` always (inherited from `model-policy.yaml`'s existing
  `authorizationTiers`), and any wave above 2 concurrent sessions;
- a cost ceiling per wave, in the coarse unit defined below.

**Cost is a coarse relative unit, never currency.** AIPe cannot know a token
price, a plan, or a rate limit, and a spec that implies it can will get a
fabricated dollar figure. The unit is a **cost index**: a whole number where one
subagent unit at the `standard` tier is 1, and the multipliers for mode, tier
and intensity are declared in the policy file with conservative defaults. It
exists to make *relative* choices legible — that `ultracode` on four session
units is an order of magnitude above one subagent — not to predict a bill. Every
surface that shows it must label it as an index, never as money.

Extending `model-policy.yaml`'s existing `authorizationTiers` mechanism rather
than inventing a second gating vocabulary is the point: there must be one place
where "this needs a signature" is expressed.

### `src/execution/propose.ts` — the checkable proposal

For each unit in the wave, it crosses capabilities × policy × eligibility and
emits the **viable** combinations with a cost index, each marked free or gated.

**Eligibility is not reimplemented here.** Whether a harness can be session-
dispatched is already decided by `isContainable` and adjudicated by
`validateBatch` (`src/dispatch/law.ts`), which is the single authority and stays
so. `propose` consults it; it never keeps a second opinion about which harnesses
qualify. A proposal that offered something the law would then reject would be
worse than no proposal.

It **enumerates and prices; it never chooses.** A combination that is not viable
does not appear — if `gemini` is not authenticated, it is not offered, rather
than offered and failing at dispatch. But when a combination is excluded for a
reason the PE would find surprising, the exclusion is stated with its cause. A
harness silently vanishing from the list is indistinguishable from a bug.

## The flow

Steps 0–3 of `/operate` are unchanged. Step 3.5 — the Orientation Spec and its
approval — is where this lands.

**The coordinator runs `aipe execution propose --journey <id>`** and receives,
per unit, the viable envelopes with costs and gate markings.

**The coordinator then adds what only it knows**: the choice, the reason, and
the alternatives it discarded. The form of the reason is load-bearing. Not
"chose session/gemini/fast" but:

> *session, because the unit touches 40 files and a shared context would starve
> it; gemini, because this is the QA and the dev ran on claude; fast, because
> this is a mechanical rename, not design. Discarded ultracode: there is no
> solution space to explore here.*

Without the reasoning the PE can only accept or reject blind, which is the
situation this spec exists to end.

**The PE sees** the Orientation Spec as today, with the envelope filled and an
estimated wave cost. They approve as a block, edit a single unit, or send it
back for another reading.

**Below the gated line** the coordinator records its choice and proceeds. Above
it, it stops and asks. This is what prevents the PE approving "subagent, fast,
claude" thirty times to reach the one decision that mattered.

## The per-wave model constraint

In session mode the model is **per wave, not per unit**: `agentop` treats
`--model` as a batch-level flag, and `startBatch` refuses a wave whose units
disagree rather than silently binding one of them.

`propose` must therefore know this. Where units want different models it
**groups them into separate waves by model**, and when that grouping costs an
extra wave it says so explicitly, so the PE can decide whether the finer model
choice is worth the extra round.

Where per-unit model granularity genuinely matters more than wave latency,
subagent mode is the honest answer — there the model binds per unit. `propose`
should surface that trade rather than hide it.

## Failure modes

| Failure | Response |
| --- | --- |
| No `agentop`, no containable harness, or policy forbidding everything | `propose` fails loudly naming which constraint bit; `/operate` falls back to subagent mode with a line explaining why. Never silence, never an empty wave that reads as success |
| `capabilities.yaml` absent | First run probes and asks the PE to confirm; no proposal is emitted from unconfirmed data |
| `capabilities.yaml` stale (a harness disappeared or stopped authenticating) | Dispatch already rejects a non-containable harness before writing anything; `propose` additionally re-probes and flags any drift from the recorded state |
| `execution-policy.yaml` absent or malformed | Conservative defaults, exactly as `readPolicy` already does for `model-policy.yaml` |
| Estimated cost exceeds the wave ceiling | Gated: the coordinator stops and asks, naming the cheaper envelope it would fall back to |

## Testing

- **`capabilities` probing** — behind an injectable runner; no test executes a
  real harness binary. Detection, PE confirmation outranking a probe, and drift
  between recorded and re-probed state.
- **`execution-policy` loading** — absent, malformed, partial; conservative
  fallback in each case, mirroring the existing `model-policy` tests.
- **`propose`** — viability filtering (an unauthenticated harness never
  appears), the stated reason for a surprising exclusion, gate marking, cost
  estimation, and the per-wave model grouping including the "this costs an extra
  wave" signal.
- **Fallback** — with nothing viable, `propose` fails with the biting constraint
  named and `/operate` reaches subagent mode.

Assertions are exact. On the predecessor branch every `toContain` carrying a
guarantee proved too weak under mutation, and a test asserting a proposal
"contains gemini somewhere" would pass while the envelope was wrong.

**One end-to-end check against reality is mandatory.** The predecessor branch
shipped 890 green tests over a dispatch path that had never once run, because
every test injected a fake runner accepting any argv. Any command this spec
assembles must have its argv shape validated against the real binary at least
once — at `--help` level, starting nothing.

## Out of scope

- Changing where the approval gate lives, or its meaning.
- Per-unit models inside a single session-mode wave — `agentop` does not support
  it; grouping into waves is the answer.
- Making `codex` or `copilot` session-dispatchable; both remain workspace hosts
  only, per the predecessor spec's eligibility rule.
- Historical cost tracking or budget accounting across journeys. `propose`
  estimates the wave in front of it; it does not keep books.
