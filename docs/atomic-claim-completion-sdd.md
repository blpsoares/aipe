# SDD — Completar o claim atômico por repo (j-20260826-1i)

> Fundação do paralelismo: exclusão mútua **física** por repo, para que N sessões
> de coordenador não despachem no mesmo repo ao mesmo tempo. Path-level locking
> (dois specialists no mesmo repo em arquivos disjuntos) é jornada posterior e
> depende desta. Escopo: **só** o lock por repo + os dois bugs de worktree vizinhos.

## Ponto de partida (o que já estava em `main`)

A maior parte do núcleo **já aterrissou** no PR #5 (`7fb891e`, 08/jul) + review
`b3ce1d5`, verde no baseline (1343 testes). Esta jornada **não reimplementa** isso:

- `src/dispatch/lock.ts` — `claimLock`/`releaseLock`/`isLockActive`/`isPidAlive`/
  `readLock`, atômico via `link(tmp, lock)` (semântica `O_CREAT|O_EXCL`: o arquivo,
  uma vez visível, já está completo). Reconciliação de stale: órfão (sem dispatch
  `dispatched`) ou pid morto ⇒ sobrescrivível.
- CLI `dispatch claim` / `dispatch release`; `journey reconcile`.
- **Bug B (bare-clone)** já corrigido: `setWorktreeNonBare` (core.bare=false
  worktree-local) + `worktreePathByBranch` resolve o caminho real (fim do path
  doubling, cf. `abd71df`). Testes A2/A3 verdes.
- **Bug A (parcial):** `prune` **sem** `--force` já pulava dispatch ativo.

## Delta desta jornada (o que faltava para bater o aceite)

### 1. Bug A ainda vivo — `prune --force` apagava dispatch ATIVO
`pruneWorktrees` gateava o skip de ativo em `!force`, então `--force` furava a
guarda de estado **junto** com a de árvore-suja — apagava worktree de dispatch
vivo. Pior: havia um teste (`"--force removes ACTIVE dispatches too"`) que
**fixava** o comportamento errado (um teste que trava o bug é pior que nenhum).

**Correção:** separar os dois guardrails. A guarda de **dispatch-vivo** é
**incondicional** (`if (dispatch && isActiveDispatch(status)) → skipped`); `--force`
governa **só** a guarda de árvore-suja, dentro de `removeWorktree`, e só alcança
worktrees **terminais** (`merged`/`removed`) ou órfãos. O teste virou o **caso
negativo**: re-dispatch + `--force` ⇒ `skipped`, sobrevive em disco. RED→GREEN
provado (código bugado: `removed`; corrigido: `skipped`).

### 2. Gate de autorização no `--force` do claim
O `--force` sobrescrevia um lock **ativo** sem checar nada — override virava
atalho do agente. O aceite exige `--force` **E** aprovação do PE registrada em
`authorizations`.

**Design:** `JourneyAuthorization` ganha `forceClaim?: string` (a unit key:
`repo` ou `repo/package`); `tier` vira opcional (uma entrada de override não tem
tier). `claimLock`, ao forçar sobre um lock ativo, exige que o **journey que
reivindica** tenha uma authorization com `forceClaim === unit` (ou `"*"`), senão
retorna `{ ok:false, reason:"unauthorized-force" }` e **não toca** no lock.
Reconciliar um lock **stale** (órfão/pid morto) **não** precisa de grant — é
recuperação ordinária, não override. CLI: `dispatch authorize-force <repo>
--journey <id> [--package p] --by PE` grava o grant; `claim` sem grant sai **3**
com a instrução de como registrar. RED→GREEN provado.

`recordAuthorization` deduplica agora por `(tier, forceClaim)` — dois force-claims
de units distintas não colapsam. `grantedTiers` ignora entradas sem tier.

### 3. Prova de corrida FECHADA (não argumentada)
Um "claim duas vezes" não prova atomicidade — um interleaving de sorte passa.
Dois testes tornam a sorte implausível:
- **in-process:** 5 claimants concorrentes sobre um repo, **exatamente 1 vence**,
  repetido **60 rodadas** (workspace novo a cada rodada).
- **multi-process:** **6 processos** de CLI separados (`bun cli.ts claim …`)
  disputam **o mesmo arquivo de lock**, exatamente 1 `CLAIMED` (exit 0) e os
  demais `COLLISION` (exit 2), **3 rodadas**. É a atomicidade do `link()` no nível
  do SO, não só do event loop.

### 4. O lock nunca viaja com o workspace publicado
`.aipe/` é publicado; o lock precisa ser **per-machine** como `toolchain.yaml` e
`.rehydrate.lock`. `scaffold.ts` passa a re-ignorar `/.aipe/locks/` no `.gitignore`
allowlist do workspace. Teste: `git add -A` num workspace montado **não** estagia
`.aipe/locks/*` (nem `toolchain.yaml`/`.rehydrate.lock`), mas estagia o brain.

### 5. Fio no fluxo do `operate`
`operate/SKILL.md` passo 4b: **claim antes de despachar** (o `dispatch validate`
só adjudica o próprio batch em memória; não vê outra sessão). Trata
`CLAIMED`/`RECONCILED`/`COLLISION`/`UNAUTHORIZED-FORCE`. **Release** nos marcos
terminais: `delivered` e `escalated` (passo 4d) e `merged`/`removed` (passo 6,
idempotente). Nota do `prune` reescrita: pula ativo mesmo com `--force`.

### 6. Doc
`src/worktree/SPEC-safety.md` A1 corrigido (não descrever mais "sai com --force").
Este SDD.

## Decisões que valem registrar
- **Release confiável > lock recuperável perdido.** Se preciso escolher, prefira
  um lock stale recuperável a um registro de ledger perdido — por isso a
  reconciliação de stale (órfão/pid morto) é o sinal primário e o release é só o
  atalho feliz; um coordenador que crashou não trava o repo pra sempre.
- **Override é decisão humana no registro**, não do agente: `--force` sozinho não
  basta; o grant do PE fica no ledger.
- **`--force` nunca remove worktree de dispatch vivo** — separado do guard de
  árvore-suja de propósito.

## Validação
`bun test` verde, `bunx tsc --noEmit` silencioso, `bun run build:host` ok. CI
verde **antes** de declarar delivered, com `gh pr checks` anexado. Fora de escopo:
D2-A/D2-B (path-granularity), `journey reconcile` como polling automático.
