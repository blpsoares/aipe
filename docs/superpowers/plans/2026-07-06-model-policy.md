# Model policy — implementation plan

> Implements `docs/superpowers/specs/2026-07-06-model-policy-design.md`.
> PE-confirmed decisions: `standard`=Sonnet (Opus reserved for `reasoning`);
> frontier authorization scope = **per journey**; Opus threshold = **dispatch
> count** (default 8). TDD, TypeScript strict.

## Tier→model (Claude Code adapter)
`fast`=`claude-haiku-4-5-20251001`, `standard`=`claude-sonnet-5`,
`reasoning`=`claude-opus-4-8`, `frontier`=`claude-fable-5`. Generic adapter →
null (harness-decided); the tier's gate/volume semantics still apply.

## Tasks
- [ ] T1 `src/model/types.ts` — `ModelTier`, `TIERS`, `ModelPolicy`, gate types.
- [ ] T2 `HarnessAdapter.resolveModel(tier)` on the interface + both adapters;
  tests.
- [ ] T3 `src/model/policy.ts` — `defaultPolicy()` + `readPolicy()` (merge over
  `.aipe/model-policy.yaml`); tests (absent → defaults; override merges).
- [ ] T4 `src/model/resolve.ts` — `resolveModel(policy, adapter, tier)` →
  `{ tier, model, label, requiresAuth }`; `gateFor(policy, tier, grantedTiers)`
  → `ok | needs-authorization`; tests.
- [ ] T5 journey: `JourneyDispatch` += optional `tier`/`model`; `JourneyLedger`
  += optional `authorizations`; `recordAuthorization`; reader/writer preserve
  them (legacy ledgers parse). Tests.
- [ ] T6 `src/model/check.ts` — `checkVolume(policy, ledger)` counts `reasoning`
  dispatches vs threshold → `ok | notify`; tests.
- [ ] T7 `src/model/cli.ts` — `aipe model resolve|check|authorize`; pure
  `renderResolve/renderCheck`; tests. Wire into `src/cli.ts`.
- [ ] T8 `DispatchEntry` += optional `tier` (carried into the brief); minimal.
- [ ] T9 dashboard render: show per-dispatch model + a per-journey Opus-volume
  note; test.
- [ ] T10 `skills/operate/SKILL.md`: model-selection step (assign tier by
  complexity → resolve → on needs-authorization ask PE + `model authorize` →ok;
  on notify tell PE → record tier/model in the journey).
- [ ] T11 verify (test+tsc+build:host), dossier 12, README/roadmap, commit+push.
