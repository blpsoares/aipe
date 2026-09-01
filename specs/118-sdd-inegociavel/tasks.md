# Tasks — #118 (ordem TDD; RED → GREEN por item)

## T2 — Rota SDD (routing)
- [ ] `routing.test.ts`: `skillApplies` casa/rejeita por size+skipFor+taskType.
- [ ] `routing.test.ts`: `routeSdd` → `spec-kit` p/ large; `sdd-lite` p/ small;
      `null` quando nenhum SDD instalado; `reason` nomeia o limiar.
- [ ] Implementar `skillApplies` + `routeSdd` em `routing.ts`.
- [ ] `skillMatch` imprime `ROUTE sdd=<kit>` e inclui no `--json` (teste na cli).

## T3 — Gate de recusa (ledger)
- [ ] `ledger-sdd-gate.test.ts`: `delivered` + `sddKit=spec-kit` + resolver
      dizendo {spec:false} → REJECT `sdd-artifacts-required` nomeando o que falta.
- [ ] idem {plan:false} → REJECT; {spec:true,plan:true} → OK.
- [ ] `sddKit` de outra unidade não roteada / `sdd-lite` → NÃO barra.
- [ ] loop de conserto: `dispatched`/`blocked`/`failed`/`verified` não barra (A4).
- [ ] sticky: `dispatched --sdd spec-kit` depois `delivered` (sem --sdd) ainda
      enxerga spec-kit.
- [ ] sem resolver injetado → inerte (round-trip legado).
- [ ] Implementar: `sddKit?` no tipo, `STICKY += sddKit`, gate + code.
- [ ] `resolveSddArtifactsGit` em `sdd.ts` (+ teste com repo git temporário).
- [ ] CLI `--sdd` + injeta resolver real.

## T1 — Auto-instalação
- [ ] `preset` materializa spec-kit em todos os repos (teste com repos em disco).
- [ ] `rehydrate` garante spec-kit (teste).
- [ ] Prosa: hire-specialists + operate.

## Verificação (prova, colada)
- [ ] `bun test` (suíte) + `typecheck` + `version:check` verdes.
- [ ] A1: `skill preset` → `skill list` mostra spec-kit + `ls` dos arquivos.
- [ ] A2: as três saídas de `skill match --size {small,medium,large}` com ROUTE.
- [ ] A3 (mutação): `journey record --status delivered` REJECT sem artefatos,
      OK após commitar spec+plan — ponta a ponta com repo git real.
