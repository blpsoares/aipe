# SDD — Trava de granularidade PATH (não repo) · j-20260826-xj

> Escopo: só `src/dispatch/*`. Estende o claim atômico (`j-20260826-1i`, PR #27)
> e a identidade-por-task (`j-20260826-uv`, PR #28) — **não** reescreve nenhum
> dos dois. O primitivo atômico (`link()` = `O_CREAT|O_EXCL`, `isLockActive`,
> stale reconciliation, `--force` com `authorizations`) e a identidade por task
> (chave do lock aceita `task`, lei separa papel que escreve via
> `roleWritesToRepo`) são fundação pronta.

## Problema

A trava é no **repo inteiro**: dois devs no mesmo repo serializam mesmo quando
tocam arquivos disjuntos. O PE tem demandas com ~10 sub-tarefas paralelizáveis no
MESMO repo, seguras em paralelo quando os **paths são disjuntos**. Falta a
**granularidade**: raciocinar por path dentro do repo, sem perder a serialização
onde ela é necessária (mesmo arquivo).

## Solução

### 1. Motor de sobreposição (`paths.ts`, puro)

`pathsOverlap(a,b)` decide se dois specs (globs/prefixos) podem casar um arquivo
**em comum** — intersecção não-vazia. Por segmento: `**` casa zero+ segmentos,
`*` casa 1 segmento, wildcard intra-segmento por DP (`wildcardIntersect`). Um spec
sem wildcard no último segmento é **prefixo** (cobre a subárvore: `src/foo` casa
`src/foo` e tudo abaixo). Set vazio ⇒ **WHOLE** (`**`), que sobrepõe tudo — é o
lock por-repo de hoje, preservado como default. Conservador só onde o parsing é
ambíguo; disjunto coexiste, arquivo comum serializa. `pathSetsOverlap` /
`overlappingPairs` estendem para conjuntos e reportam **quais** paths colidiram.

### 2. Claim path-aware (`lock.ts`)

`claimLock` ganha `paths?`. Ausente ⇒ **branch legada** intacta (single-file por
`lockKey(repo,pkg,task)`), usada por papel que-não-escreve (task-split) e todo
chamador pré-path. Presente (mesmo `[]`=WHOLE) ⇒ **branch path-aware**:

- Adquire um **mutex-guard por-unidade** (`.<repo[__pkg]>.guard`) via o MESMO
  `link()` atômico, com spin/backoff + stale reconciliation (pid morto ou TTL). É
  ele que serializa a seção crítica **scan → decide → write ENTRE PROCESSOS** —
  sem isso, dois claims sobrepostos em processos separados leriam a unidade vazia
  e ambos escreveriam (o buraco silencioso que esta jornada fecha).
- Faz scan das locks vivas da unidade (mesmo repo+package, **ignorando task**),
  só as que **escrevem** (`writes:true` — um revisor não colide sobre arquivo).
  Sobreposição com writer vivo estrangeiro ⇒ `collision` (com os pares de paths);
  `--force` exige `authorization` gravada (gate herdado).
- Identidade segue **por task**: o arquivo é `lockKey(repo,pkg,task).lock`, então
  duas sub-tarefas disjuntas (tasks distintas) ganham arquivos distintos e são
  liberadas por task; a sobreposição é julgada unit-wide.

### 3. Lei path-aware (`law.ts`)

`validateBatch` raciocina por path **quando algum membro do grupo declara paths**;
senão, adjudica exatamente como antes (nenhum veredito existente muda). No ramo
path-aware: writer×writer com paths sobrepostos ⇒ `path-collision <unit>: A ⋂ B
on <paths>` (nomeia o porquê); writer WHOLE/sem-paths sobrepõe tudo (serialização
mesmo-unidade preservada por default); writers que coexistem precisam de `task`
distinto. Não-writers seguem a regra identidade-por-task. Cap de 16 mantido.

### 4. Declaração honesta = detecção verificável (`detect.ts`, `reconcileLockPaths`)

Paths declarados **envelhecem** (evidência de campo: escopo 2→16; submódulo mexido
por `bun install`). O AIPe é físico: `dispatch reconcile` lê o que a branch **de
fato** mexeu (`git diff base...HEAD` + `git status --porcelain`, ambos endpoints
de rename) e reescreve os paths do lock vivo para essa verdade (sob o mesmo
guard), re-checando overlap no conjunto REAL. Reporta `drift` (o que a declaração
não cobria) e `DRIFT-COLLISION` (cresceu para dentro de outro claim vivo).

### 5. Exceção gerenciada (`resolution.ts`, `dispatch resolve-overlap`)

Sobreposição **não** é erro fatal. `planOverlapResolution` devolve o plano
determinístico e testável: **wait** (a segunda espera) → **rebase** (sobre o
holder) → **resolve** (o agente, com a orientation das duas, resolve à mão) →
**review-over-merge** (a revisão de qualidade pré-aprovação roda sobre o resultado
MERGEADO — a rede que pega merge textual ruim E quebra semântica). Decisão
registrada do PE; documentado em `skills/operate/SKILL.md` (caixa após o step d).

## Plano / TDD

1. `paths.ts` + `__tests__/paths.test.ts` — motor de overlap (exato p/ casos reais).
2. `lock.ts` branch path-aware + guard + `__tests__/lock-paths.test.ts` — disjunto
   coexiste, sobreposto colide, **corrida multi-processo** (sobreposto: 1 vence;
   disjunto: todos vencem). Legada intacta.
3. `law.ts` path-aware + `__tests__/law-paths.test.ts` — `path-collision` nomeando
   paths; sem-paths ⇒ `same-repo` (backward compat); cap 16.
4. `detect.ts` + `reconcileLockPaths` + `resolution.ts` +
   `__tests__/reconcile.test.ts` — detecção (runner injetável), reconciliação,
   drift/overlap, plano da exceção. CLI: `reconcile`, `resolve-overlap`.
5. `bun test` verde, `typecheck` limpo, `build:host` OK, CI verde.
