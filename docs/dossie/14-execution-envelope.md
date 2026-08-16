# Dossier 14 — Execution-envelope recommendation (`aipe capabilities` · `aipe execution`)

**Status:** Built.
**Spec:** [`2026-08-15-execution-envelope-recommendation-design.md`](../superpowers/specs/2026-08-15-execution-envelope-recommendation-design.md).
**Builds on:** session-mode dispatch (dossier 15).

## What this is for

Session-mode dispatch (dossier 15) gave the coordinator four axes to vary per
unit of work: `mode` (subagent vs. detached session), `intensity` (normal vs.
`ultracode`), `harness` (which CLI runs the specialist) and `tier`/`model`.
All four already flowed into the PE's approval of the Orientation Spec — but
the coordinator arrived at that gate with an **empty** envelope: it had no way
to know which harnesses this machine actually has, what a combination costs,
or which choices the PE considers worth a signature. The result was that the
cheapest correct choice rarely got made — a one-line rename ran on the same
envelope as a cross-repo refactor, because nobody had the information to say
otherwise.

This subsystem makes the coordinator arrive at the gate with a **filled,
priced, justified** envelope instead. It is not a new gate — the PE still
approves the Orientation Spec, and only what arrives at it changed — and it is
not an autonomous spender: `aipe execution propose` **enumerates and prices;
it never chooses.** The choice, and the reasoning behind it, are the
coordinator's (and ultimately the PE's).

## `.aipe/capabilities.yaml` — what this machine can actually run

`aipe start` probes this automatically as the last step of creating a
workspace — the whole point of this subsystem is that the coordinator
arrives at the approval gate with a **filled** envelope, so nothing about
getting there should be a manual prerequisite. The probe itself shells out to
each known harness binary's `--version` and records what it found; `aipe
capabilities probe` re-runs the same detection by hand (useful right after
installing a new harness binary). **A probe result is a claim with a date,
not a fact** — a binary on `PATH` is not an authenticated binary, and a
harness that was usable last month may not be after a CLI update. `aipe
capabilities confirm` is the only thing that outranks a probe: it is the PE's
word, recorded as such, so a later probe cannot silently overwrite a
correction.

If a workspace somehow has no record at all — an older workspace predating
this auto-probe, or the file was deleted — `aipe execution propose` self-heals
the same way `aipe start` does: it probes right there, says so in its output,
and proceeds. It only refuses outright if that probe itself fails or finds no
usable harness; an EXISTING record, confirmed or not, is never re-probed by
`propose` (that would risk silently discarding a `confirm`, and would make an
unconfirmed record less stable than it should be — only `aipe capabilities
confirm` ever promotes one).

```yaml
harnesses:
  - id: claude-code       # AIPe adapter id — NOT the binary name (see below)
    bin: claude            # the binary agentop would actually start
    present: true
    version: "2.1.4"       # or null when unversioned/unreadable
    source: probe           # "probe" | "pe-confirmed"
    checkedAt: "2026-08-16T12:00:00.000Z"   # ISO date
  - id: gemini
    bin: gemini
    present: false
    version: null
    source: probe
    checkedAt: "2026-08-16T12:00:00.000Z"
confirmed: false            # has the PE ever run `aipe capabilities confirm`?
```

Every field is required — `readCapabilities` (`src/capabilities/store.ts`)
validates each `harnesses[]` entry and **drops** (never crashes on) a
malformed one, reporting the drop count so a corrupted record is visible
rather than silently under-reporting what the machine has. There is no
"default" capabilities record: nothing is assumed present until probed.

The four harnesses ever probed (`src/capabilities/probe.ts`,
`PROBED_HARNESSES`): `claude-code`→`claude`, `gemini`→`gemini`,
`codex`→`codex`, `copilot`→`copilot`. `id` is the AIPe adapter id (what the
journey ledger's `harness` field and the Orientation Spec use); `bin` is the
literal binary — the two are deliberately different namespaces, since
conflating them once let a unit approved for one harness silently start a
session on another.

**Drift.** `aipe capabilities show` re-probes and flags any harness whose
*presence* changed since the record was written (a version bump is not
drift; a harness appearing or disappearing is) — in either direction, so a
newly-installed harness surfaces exactly like a vanished one.

## `.aipe/execution-policy.yaml` — the limits the PE does not negotiate

Deliberately the sibling of `.aipe/model-policy.yaml` (dossier 12): same
shape, same conservative fallback when absent or malformed, read by
`readExecutionPolicy` (`src/execution/policy.ts`). Absent/malformed →
defaults; a top-level array or otherwise wrong-shaped YAML also falls back to
defaults rather than partially applying.

| Field | Type | Default | Notes |
|---|---|---|---|
| `maxSessionsPerWave` | number | `4` (`SESSION_MAX_CONCURRENT`, `src/dispatch/types.ts`) | **Clamped, never raised**: a policy value above the dispatch law's own session ceiling is silently capped back down to it. |
| `gateAboveSessions` | number | `2` | Sessions beyond this count in one wave need the PE's authorization. **Clamped**: if configured `>= maxSessionsPerWave`, it is forced down to `maxSessionsPerWave - 1` (floor 0) — a gate at or above the wave ceiling could never fire, which would read as a limit while permitting every wave through. |
| `gatedIntensities` | `("normal"\|"ultracode")[]` | `["ultracode"]` | Any envelope with an intensity in this list is marked `GATED`. |
| `gatedTiers` | `ModelTier[]` (`"fast"\|"standard"\|"reasoning"\|"frontier"`) | `["frontier"]` | Mirrors `model-policy.yaml`'s existing `authorizationTiers` — deliberately the same vocabulary, not a second one. |
| `maxCostIndexPerWave` | number | `24` | A wave whose summed cost-index exceeds this is `GATED`. |

```yaml
# .aipe/execution-policy.yaml — every field optional; omitted fields fall back
maxSessionsPerWave: 4
gateAboveSessions: 2
gatedIntensities: [ultracode]
gatedTiers: [frontier]
maxCostIndexPerWave: 24
```

Only positive, finite numbers are accepted for the numeric fields and only
recognized tier/intensity values survive the array filters; anything else is
ignored in favor of the default for that field alone (a malformed
`gatedTiers` does not invalidate `maxCostIndexPerWave`).

## Cost index — a coarse relative unit, never money

**AIPe cannot know your token price, plan, or rate limits.** `cost-index`
exists to make *relative* choices legible — that `ultracode` across four
session units is an order of magnitude above one subagent — never to predict
a bill. Every CLI surface that prints it also prints a note saying so.

The cheapest possible envelope (`subagent`, `fast` tier, `normal` intensity)
is defined as **1**; every other combination is a whole multiple of it
(`src/execution/cost.ts`):

| Axis | Values → multiplier |
|---|---|
| `mode` | `subagent`=1, `session`=2 (a detached session carries its own full context window — it reads and re-reads more) |
| `tier` | `fast`=1, `standard`=2, `reasoning`=4, `frontier`=6 |
| `intensity` | `normal`=1, `ultracode`=8 (it does not scale the unit — it multiplies the number of agents inside it) |

`cost-index = mode × tier × intensity`. Anchored at the cheapest envelope
(not a mid-tier one) so every tier lands on a distinct integer.

## The flow: probe (automatic) → confirm → propose → approve → record → plan

1. **`aipe start`** — probes harness binaries as the last step of creating
   the workspace and writes `.aipe/capabilities.yaml` with `confirmed: false`.
   Nothing manual is required to reach step 3 below. Probing never fails
   `start`: if it throws or finds nothing, `start` says so and still
   completes — a workspace without a capabilities record is fine (step 3
   handles it), a `start` that dies half-way is not. `aipe capabilities
   probe` re-runs the same detection by hand, e.g. right after installing a
   new harness binary.
2. **`aipe capabilities confirm`** — the PE's word, flips every entry's
   `source` to `pe-confirmed`. `aipe execution propose` still runs without
   this step, but prints an `UNCONFIRMED` note on every line.
3. **`aipe execution propose --journey <id>`** — for each unit already in the
   journey's ledger, crosses `capabilities.yaml` × `execution-policy.yaml` ×
   the dispatch law's own eligibility authority (`isContainable`,
   `hasAdapter` — never a second opinion) and prints every **viable**
   envelope with its cost-index and `GATED` marking, plus an explicit reason
   for anything excluded (an unauthenticated harness, a non-containable one).
   If somehow no record exists at all (step 1 never ran, or the file was
   deleted), `propose` **self-heals**: it probes right there, prepends a NOTE
   saying it did, and proceeds on the result — the same unconfirmed-by-default
   record `aipe start` would have produced. An EXISTING record, confirmed or
   not, is never re-probed here. It **still fails outright** — naming the
   constraint — if that self-heal probe itself throws, or finds no usable
   harness at all (every one of `claude`/`gemini`/`codex`/`copilot` absent);
   in the all-absent case nothing is written, so the next `propose` call
   retries rather than being stuck with a permanent empty record.
4. **The coordinator chooses**, states why, states what it discarded, and
   presents it as part of the Orientation Spec. **The PE approves** (`aipe
   journey spec --approve`) — above the gated line explicitly; below it, the
   coordinator's choice stands.
5. **`aipe journey record --mode --intensity --harness --tier --model`** —
   the chosen envelope is written onto each unit's dispatch record.
6. **`aipe execution plan --journey <id>`** — reads the *recorded* (not
   proposed) envelopes for every `dispatched` unit, groups them into waves
   (session-mode units by `model`, since `agentop` binds `--model` per batch
   and a wave whose units disagree cannot be started as one call — see
   dossier 15), and reports each wave's cost-index and gate. This is the
   **only** path by which the wave-level policy limits
   (`gateAboveSessions`, `maxCostIndexPerWave`) reach a human. Unlike
   `propose`, `plan` never self-heals a missing record — it only ever reads
   what `propose`/`aipe capabilities probe` already recorded, so a missing
   record here is still a firm refusal.

A unit whose envelope is incomplete (any of `mode`/`harness`/`tier`/
`intensity` missing, or — for session mode specifically — no `model`
recorded) is treated as "not chosen yet" and excluded from the plan with a
note, never smuggled in as a guess. Only units still in `dispatched` status
are planned; `merged`/`verified`/`delivered`/`failed`/`escalated`/
`redirected`/`removed` units are excluded — replanning them would re-price
and re-gate work that will never run again.

## Left open (documented)

- Historical cost tracking or budget accounting across journeys — `propose`
  and `plan` price the wave in front of them; neither keeps books.
- Per-unit models inside one session-mode wave — `agentop` does not support
  it; grouping into separate waves by model is the answer `plan` already
  gives.
- Real token/$ metering, same open item as `model-policy.yaml` (dossier 12) —
  the cost-index stays a relative proxy until a harness exposes usage
  headlessly.
