# Model policy — design spec

**Date:** 2026-07-06
**Status:** Design proposal — awaiting PE confirmation before implementation.
**Depends on:** `2026-07-05-phase-b-operation-design.md` (dispatch law, journey
ledger, hiring brief), `2026-07-06-harness-adapters-design.md` (adapter seam).

---

## 1. Purpose

Today AIPe is model-agnostic by omission: the coordinator runs on whatever model
the PE picked for the session, and dispatched specialist subagents inherit the
harness default — the `aipe` CLI never expresses a model choice. This spec makes
model selection a **first-class, governed decision**:

- The **coordinator chooses the model per task**, by the task's difficulty /
  complexity — a cheap fast model for a trivial edit, a reasoning model for a
  hard cross-cutting change.
- **Frontier models (e.g. Fable) require explicit PE authorization** before any
  dispatch uses them.
- **Exorbitant reasoning-model (Opus) volume is communicated to the PE** — the
  coordinator can spend Opus freely up to a threshold, past which it must tell
  the PE.

The split follows AIPe's invariant: the **judgment** (which tier a task needs)
lives in the coordinator's `SKILL.md` prose; every **gate** (is this model
allowed? has the Opus budget been crossed?) is **deterministic, tested CLI** that
adjudicates and returns a verdict — exactly like `aipe dispatch validate`. The
CLI never talks to the PE; it returns a verdict the coordinator acts on.

---

## 2. Abstract tiers (portable) → concrete models (per adapter)

The policy is written in **abstract tiers**, so it is harness-independent; each
`HarnessAdapter` maps a tier to the concrete model id that harness understands.

| Tier | Meaning | Claude Code model (example) | Gated? |
|------|---------|------------------------------|--------|
| `fast` | trivial / mechanical (rename, small fix, boilerplate) | `claude-haiku-4-5` | no |
| `standard` | ordinary feature work | `claude-sonnet-5` | no |
| `reasoning` | hard / cross-cutting / subtle | `claude-opus-4-8` | **volume-notified** |
| `frontier` | exceptional difficulty, highest cost | `claude-fable-5` | **authorization-required** |

`HarnessAdapter` gains:

```ts
resolveModel(tier: ModelTier): { id: string; label: string } | null
```

A harness that only exposes one model returns the same id for every tier (the
policy still governs *authorization/volume* semantically). Unknown tier → null →
the coordinator falls back to the session default.

---

## 3. The policy file (data, deterministic)

`.aipe/model-policy.yaml` — published (part of the brain), optional (baked-in
defaults make it work absent):

```yaml
default: standard          # tier when the coordinator doesn't specify
gates:
  frontier: authorization  # frontier requires explicit PE authorization
notify:
  reasoning:               # "exorbitant Opus" threshold, per journey
    maxDispatches: 8       # > this many reasoning dispatches in one journey → notify
```

All fields defaulted in code, so the file is an override, not a requirement.
`authorization` gates block until granted; `notify` gates never block — they
raise a signal the coordinator relays.

---

## 4. Adjudication (the CLI)

A new `aipe model` subcommand (pure logic in `src/model/`), plus the model
carried through dispatch + journey:

### 4.1 `aipe model resolve --tier <tier>`
Resolves the tier to `{ tier, model, gate }` for the recorded harness's adapter.
`gate` ∈ `ok | needs-authorization`. Used by the coordinator to know the model
and whether it must ask first.

### 4.2 `aipe model check --journey <id>` (the volume gate)
Reads the journey ledger, counts dispatches by tier, and returns per the policy:
`{ reasoningDispatches, threshold, status: "ok" | "notify" }`. `notify` means the
coordinator must tell the PE "this journey has now used Opus N times (over the
threshold of M)". Deterministic accounting, no model call.

### 4.3 Authorization grant
A frontier dispatch is only lawful once the PE has granted it. The grant is
recorded in the journey ledger as an explicit entry
(`authorizations: [{ tier: frontier, grantedBy: PE, scope: "journey" | "dispatch" }]`)
so `aipe model resolve`/`dispatch validate` can verify it was given. The
coordinator writes the grant via `aipe journey record` **only after** the PE says
yes in the live session — the CLI enforces that a frontier dispatch without a
matching grant is `needs-authorization` (a REJECT-equivalent), it does not invent
consent.

### 4.4 Dispatch law integration
`aipe dispatch validate` (existing) is extended: a batch entry may carry a
`tier`. Validation now also returns, per entry, the resolved `model` and a
`modelGate` (`ok` / `needs-authorization`). A batch with any un-granted frontier
entry is rejected the same way an unlawful same-repo batch is — one uniform
"the CLI said no, coordinator obeys" path.

---

## 5. Carrying the model through

- **Hiring brief** (ephemeral, assembled at dispatch) gains a `model` field — the
  resolved concrete id the subagent is spawned with. The coordinator passes it to
  the harness's Agent/Task call.
- **Journey ledger** records `tier` + `model` per dispatch (durable audit) — this
  is what feeds §4.2 accounting and the web display, and it is where cost/volume
  history lives.

---

## 6. Coordinator behavior (SKILL prose — the judgment)

`skills/operate/SKILL.md` gains a model-selection step in the per-wave loop:

1. For each task, assign a **complexity tier** by difficulty (trivial→`fast`,
   ordinary→`standard`, hard→`reasoning`, exceptional→`frontier`). This is the
   coordinator's judgment call, explained in prose with examples.
2. Run `aipe model resolve` / the extended `dispatch validate` to get the model +
   gate.
3. **On `needs-authorization` (frontier/Fable):** STOP and ask the PE explicitly
   ("Task X is exceptionally hard; I'd like to use Fable [most expensive] — may
   I?"). Only on an explicit yes, record the grant and proceed.
4. **On `notify` (Opus volume):** before continuing, tell the PE ("this journey
   has used Opus N times, past the M threshold — continue?") and proceed unless
   they object.
5. Dispatch each specialist with the resolved model in its brief; record
   `tier`+`model` in the journey.

The gates are the coordinator's guardrails; the *decision to spend* the PE's
money stays visible to the PE.

---

## 7. Snapshot / dashboard / web console

- `WorkerView` + the journey dispatch view gain `tier` + `model`.
- The TUI dashboard shows a small model/tier tag per worker and per pipeline
  dispatch.
- The web console (still spec) shows: a **tier/model badge** on each specialist
  card, a per-journey **model-mix + Opus-volume meter** (with the threshold), and
  an **"awaiting authorization"** state for a frontier dispatch the PE hasn't
  approved. All of it reads from the journey ledger — no new live source.

---

## 8. Open decisions for the PE (before implementing)

1. **Tier→model mapping.** The table in §2 (`fast`=Haiku, `standard`=Sonnet,
   `reasoning`=Opus, `frontier`=Fable) — confirm or adjust. In particular: should
   `standard` default to Sonnet or Opus? (Recommendation: Sonnet, so `reasoning`
   = the deliberate Opus escalation the volume gate watches.)
2. **Frontier authorization scope.** Per **dispatch** (ask every time) or per
   **journey** (ask once, reuse for that demand)? (Recommendation: per journey —
   less nagging, still explicit; the PE can always revoke.)
3. **"Exorbitant Opus" threshold.** A **count** of reasoning dispatches per
   journey (simple, e.g. 8) vs. a **token/cost proxy** (accurate, needs usage
   data the CLI doesn't have headlessly). (Recommendation: start with a dispatch
   **count** threshold — deterministic and testable now; add a cost proxy later
   if the harness exposes usage.)

## 9. Out of scope (v1 of this layer)

- Real token/$ metering (the CLI has no usage feed headlessly) — the volume gate
  is a dispatch-count proxy until a harness provides usage.
- Per-repo/per-module model overrides (the tier is per task; a static override
  field can be added to the policy file later).
- Automatic tier inference from the task text — tier assignment stays the
  coordinator's judgment, not a CLI heuristic.
