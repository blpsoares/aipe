# Dossier 12 — Model policy (coordinator model selection + gates)

**Status:** Implemented on `claude/aipe-finalize-i6443p` (frente 5).
**Spec:** `2026-07-06-model-policy-design.md`. **Plan:**
`2026-07-06-model-policy.md`.

The coordinator now chooses a model per task by difficulty, and two spending
guardrails are enforced: **Fable (frontier) needs the PE's explicit
authorization**, and **exorbitant Opus (reasoning) volume is reported to the
PE**. The split follows AIPe's invariant — the *judgment* (which tier a task
needs) is coordinator `SKILL.md` prose; every *gate* is deterministic, tested
CLI that adjudicates and returns a verdict, exactly like the dispatch law.

## Decisions (PE-confirmed)

- **Tier → model (Claude Code):** `fast`=Haiku 4.5, `standard`=Sonnet 5,
  `reasoning`=Opus 4.8, `frontier`=Fable 5. `standard`=Sonnet (not Opus) so Opus
  is the deliberate `reasoning` escalation the volume gate watches.
- **Frontier authorization scope:** per **journey** (asked once per demand, not
  per dispatch).
- **"Exorbitant Opus" threshold:** a **dispatch count** (default 8 reasoning
  dispatches per journey) — deterministic and testable now; a token/cost proxy
  is deferred until a harness exposes usage headlessly.

## What shipped (TDD, English-only)

- **`src/model/`** — `types` (`ModelTier`, `ModelPolicy`), `policy`
  (`defaultPolicy` + `readPolicy` merging `.aipe/model-policy.yaml` over the
  defaults), `resolve` (`resolveModel` → model + `requiresAuth`; `gateFor` →
  `ok`/`needs-authorization` given the journey's grants), `check`
  (`checkVolume` → `ok`/`notify` past the threshold), and `cli`
  (`aipe model resolve|check|authorize`).
- **`HarnessAdapter.resolveModel(tier)`** — maps a tier to the concrete model id.
  Claude Code returns the four ids above; the generic adapter returns null
  (harness-decided), with the tier's gate/volume semantics still applying.
- **Journey ledger** — `JourneyDispatch` gained `tier`/`model`; `JourneyLedger`
  gained `authorizations`; `recordAuthorization` (idempotent per tier) +
  `grantedTiers`. `aipe journey record` accepts `--tier`/`--model`. Legacy
  ledgers parse unchanged (fields optional).
- **Dispatch** — `DispatchEntry` gained an optional `tier` (carried into the
  brief).
- **Dashboard** — the pipeline shows the `«tier:model»` a dispatch ran on.
- **`skills/operate/SKILL.md`** — a model step in the wave loop: assign a tier by
  complexity → `aipe model resolve` → on `needs-authorization` ask the PE and
  `aipe model authorize` → `aipe model check` and relay a `notify` → record
  `tier`+`model` in the journey and dispatch the subagent on the resolved model.
  The hiring brief carries `tier`+`model`.

## Verification

Repo-wide **233 pass / 1 known env-only fail**; `tsc` clean; `build:host` OK.
End-to-end through the compiled binary: `model resolve` gave Sonnet for
`standard`, Opus for `reasoning`; `frontier` reported `needs-authorization`
(exit 1) until `model authorize`, then `ok`; `model check` flipped to `notify`
(exit 1) at 9 reasoning dispatches (threshold 8).

## Left open (documented)

- Real token/$ metering — the volume gate is a dispatch-count proxy until a
  harness provides usage headlessly.
- Per-repo/module model overrides (tier is per task; a static override field can
  be added to `model-policy.yaml` later).
- Web console model surface (badges + Opus meter + awaiting-authorization state)
  ships with the console itself (still spec) — the data (tier/model in the
  ledger) is now in place for it.
