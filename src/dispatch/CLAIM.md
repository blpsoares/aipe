# SDD — Claim atômico por repo + stale reconciliation + journey reconcile

> Nota de escopo: o stream só pode tocar `src/dispatch/*` e `src/journey/*`. Por
> isso o spec vive aqui (dentro do escopo) em vez de `docs/`, e os comandos são
> **subcomandos** de `dispatch`/`journey` (`aipe dispatch claim/release`,
> `aipe journey reconcile`) — registrar comandos top-level exigiria editar
> `src/cli.ts`, que está fora do escopo. `dispatch` e `journey` já estão
> registrados no CLI, então os subcomandos ficam acessíveis sem tocar nada fora.

## Problema

A "same-repo law" hoje é só convenção adjudicada por `dispatch validate` sobre um
único batch. Com N sessões de coordenador em paralelo (mesmo repo em disco), há
race clássico de ler-decidir-escrever nos journeys: dois coordenadores podem
provisionar worktrees para o mesmo repo ao mesmo tempo. Precisamos de exclusão
mútua **física** por repo, resiliente a processos mortos.

## Solução

### `aipe dispatch claim <repo> --journey <id> --specialist <nome> [--branch b] [--package p] [--force] [--workspace dir]`

Cria `.aipe/locks/<key>.lock` de forma **atômica**. `key` = repo (ou `repo__package`
sanitizado quando `--package` é dado; a same-repo law já é package-keyed).

Atomicidade: escreve o conteúdo num tmp único e faz `link(tmp, lock)` — `link` é
atômico e falha `EEXIST` se o lock já existe, garantindo que o arquivo, uma vez
visível, já tem conteúdo completo (sem janela de arquivo vazio como `open('wx')`).

Conteúdo (YAML): `repo, package?, journey, specialist, branch?, pid, timestamp`.

Colisão: se já existe lock **ATIVO** de outro dono → AVISA (não bloqueia duro),
imprime `COLLISION ...` e sai **não-zero** (2). `--force` sobrescreve mesmo ativo.

### Stale reconciliation

Um lock só é **ATIVO** se as duas condições valem:
1. `pid` vivo (`process.kill(pid, 0)`; `EPERM` conta como vivo, `ESRCH` = morto).
2. Existe dispatch **`dispatched`** correspondente (mesmo repo/package, e journey se
   informado) em algum journey.

Órfão (sem dispatch `dispatched`) ou pid morto → **sobrescrevível**: o claim
reconcilia (toma o lock) e sai 0, reportando `RECONCILED prev=...`.

Take-over também é atômico: `unlink` do lock stale + `link` do tmp num loop curto;
se outro processo recriar um lock ATIVO no meio, o perdedor volta a ver colisão.

### `aipe dispatch release <repo> [--journey <id>] [--package p] [--force] [--workspace dir]`

Libera o lock nos marcos delivered/escalated/merged. Idempotente (liberar lock
inexistente = OK). Sem `--force`, só libera se o lock pertence ao `--journey` dado;
lock de outro journey → `SKIP foreign` não-zero (a menos de `--force`).

### `aipe journey reconcile [--journey <id>] [--workspace dir]` (bônus)

Para cada dispatch `delivered` com `pr`, chama `gh pr view <url> --json state`; se
`MERGED`, marca o dispatch como `merged` no ledger. Lógica pura
(`reconcileJourney(ws, id, prStateFn)`) com fetcher injetável — testes usam fake,
CLI usa `gh` via `Bun.spawn`.

## Plano / TDD

1. `src/dispatch/lock.ts`: `claimLock`, `releaseLock`, `isLockActive`, `isPidAlive`,
   `readLock`, `lockKey`, `lockPath`. Testes: atomicidade (2 claims concorrentes →
   1 vence, 1 falha), release, stale (sem dispatched → sobrescrevível), pid morto.
2. `src/journey/reconcile.ts`: `reconcileJourney` + `ghPrState`. Teste com fetcher fake.
3. Fios de CLI em `dispatch/cli.ts` (claim/release) e `journey/cli.ts` (reconcile).
4. `bun test` verde; `bun run typecheck`.
