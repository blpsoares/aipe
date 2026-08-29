# SDD — Upgrade autônomo: executar, não recomendar (j-20260828-eh)

> `aipe upgrade` deve fazer **tudo** que a nova versão exige — mover pastas,
> migrar `personas.yaml`, reidratar skills, reparar ponteiros — sem deixar
> lição de casa para o PE, e **sem exigir que ele espere trabalho em voo
> terminar**. A jornada **orquestra** `rehydrate` e `migrate-layout` (não os
> reescreve por dentro) e corrige o que impede a orquestração.

## Ponto de partida (o que já existe e por que NÃO se remove a trava boa)

- `src/update/apply.ts` já reidrata todo workspace conhecido e reinicia todo
  `aipe serve`. Mas **detecta** layout legado e só **imprime** "rode
  `migrate-layout`" (`apply.ts:29`). A recusa é deliberada e legítima: migrar
  move os checkouts do próprio PE, roda sem supervisão após self-upgrade, e o
  `run` descartava stdout/stderr — um `mv` silencioso ali seria irrecuperável.
- `src/migrate-layout/run.ts` já move atômico (rollback em falha) e **já chama
  `git worktree repair`** após o move (`run.ts:53-54, 208-210`). A capacidade de
  mover **sem** esperar o worktree terminar já está no repo; o que existe por
  cima é uma **recusa preventiva** (bloqueio em `worktrees.length > 1`).
- `src/worktree/git.ts:ensureExcluded` já sabe escrever em `.git/info/exclude`
  (local, não rastreado) — é o mecanismo para não sujar repo.
- PR #27 (`docs/atomic-claim-completion-sdd.md`) introduziu **reconciliação de
  stale**: um lock só conta como ativo se há dispatch vivo correspondente; órfão
  é sobrescrivível. O `migrate-layout` precisa da **mesma disciplina**.

A demanda **não** é "remova os medos" — é **resolver o que os justifica**:
auditoria (registrar cada movimento), reversibilidade (a atomicidade já existe),
reparo (o `worktree repair` já existe), e escopo/consentimento.

## Delta desta jornada

### C1 — `rehydrate` nunca suja repo (defeitos 3, 7)
`rehydrate` despeja `<repo>/.claude/skills|agents`. Como `.claude/` não está no
`.gitignore` de ninguém, todo repo do workspace fica sujo — e repo sujo bloqueia
`migrate-layout` **e** `worktree prune`. O `upgrade` roda `rehydrate` e, no mesmo
comando, cria a condição que faz a migração recusar.

**Correção (na raiz, item 4):** ao reidratar, garantir `.claude/` em
`.git/info/exclude` de **cada repo do workspace** (via `ensureExcluded`). Local,
não rastreado, idempotente, compartilhado por todos os worktrees do repo — então
worktree de sessão viva também para de sujar. Não toca `.gitignore` versionado.

### C2 — `prune`: `verified` é terminal para papel que não escreve (defeito 8)
`pruneWorktrees` trata só `merged`/`removed` como terminal, então worktree de QA
em `verified` fica preso: `verified` é o **fim** do trabalho do QA (lê diff, roda
suíte, dá veredito — **não escreve código**), e QA **nunca** vira `merged` (quem
merge é o dev). Resultado real: 7 worktrees de QA acumulados, cada um bloqueando
a migração.

**Correção:** `verified` conta como terminal **apenas** quando o papel do
specialist é `qa` (papel que não escreve), lido de `.aipe/personas.yaml`. A
guarda de árvore-suja/não-pushado em `removeWorktree` **continua** valendo — um
worktree de QA limpo é removido; um worktree de **dev** com trabalho não pushado
**continua recusado** (não se troca um extremo pelo outro; essa recusa salvou
trabalho real).

### C3 — `migrate-layout` move + repara em vez de recusar (item 2, aceite v1)
O bloqueio `worktrees.length > 1` deixa de existir. Os worktrees vivem
**dentro** do repo (`repo/.worktrees/*`), então o `rename` os leva junto; o
`git worktree repair` já chamado após o move reconecta os ponteiros (o worktree
volta a ser utilizável no novo caminho — provado por `git status` dentro dele).
A guarda de **dispatch vivo no ledger** permanece (ver C4).

### C4 — dispatch morto não bloqueia (defeito 9)
`collectBlockers` bloqueia por dispatch `dispatched`/`redirected`. Um dispatch
legado, sem `task`, de jornada concluída dias atrás, **cujo worktree não existe
mais no disco**, fica preso em `dispatched` para sempre (a imutabilidade por
unidade `merged` — que **não se relaxa** — o torna inalcançável por `record`).

**Correção (a disciplina do PR #27):** um dispatch cujo caminho `worktree` **não
existe no disco** não é trabalho em voo — é registro morto, e **não bloqueia**.
Um dispatch com worktree vivo **continua** bloqueando. RED→GREEN nos dois
sentidos. Isso resolve **sem** furar a imutabilidade nem editar o ledger à mão.

### C5 — reparo do `worktree` no ledger após mover (item 2)
Após migrar, os dispatches **não-terminais** cujo `worktree` apontava para o
caminho antigo são reescritos para o novo (prefixo `repo` → `repos/repo`).
Dispatches `merged`/`removed` são deixados intactos — não precisam de caminho
vivo e a imutabilidade os protege.

### C6 — saída de subprocesso capturada (defeito 2)
O `run` de `apply.ts` descartava stdout/stderr → `rehydrate X: exited 1` opaco.
Passa a capturar; uma falha diz **por quê** (a última linha de erro do
subprocesso entra na mensagem de falha).

### C7 — `upgrade` executa a migração, com escopo seguro (defeitos 1, 5, 6)
`applyUpgrade` passa a **executar** a migração, não recomendá-la:
1. reidrata todo workspace conhecido (seguro/idempotente, agora sem sujar);
2. migra o **workspace atual** (o ancestral de `cwd` que é workspace) via
   `migrate-layout --apply` conduzido **através do binário novo**, capturando a
   saída;
3. reinicia os consoles (como hoje).

**Escopo & consentimento:** migrar **todo** workspace da máquina sem supervisão é
o medo documentado. Default **não interativo = só o workspace atual** (seguro).
`--migrate-all` (ou consentimento quando há TTY) alcança os demais. Workspaces
legados restantes são **nomeados** no relatório com o comando exato — a exceção
que se justifica, não o normal.

**Relatório final (item 6):** diz **o que foi feito** (N repos movidos, personas
migradas, worktrees reparados), não o que falta. Sessões `agentop` vivas cujo
`cwd` caiu sob um repo movido são a **exceção nomeada**: o `cwd` de um processo
vivo não pode ser realocado por outro processo — o git segue utilizável no novo
caminho, mas o próximo comando naquele shell precisa de `cd <novo caminho>`.

### C8 — mensagens que terminam na ação (defeito 10)
- Fora de um workspace, a mensagem deixa de dizer "Run /context-brain first"
  (que criaria um workspace dentro do `$HOME`): passa a dizer *não há workspace
  AIPe aqui; entre na pasta ou passe `--workspace <dir>`*.
- Cada blocker de `migrate-layout` termina na ação que destrava (o comando, e —
  quando destrutivo — o que se perde).

## Invariantes preservadas (provadas por teste)
- Imutabilidade de unidade `merged`: intocável (C4/C5 nunca reescrevem `merged`).
- `removeWorktree` continua recusando dev com trabalho não pushado (C2).
- Atomicidade/rollback de `migrate-layout` e idempotência (rodar 2× é seguro).
- `git diff --numstat origin/main` sem linha binária.

## Aceite (mapeado)
- v1: [A] fixture legado + worktree registrado → migra/repara/utilizável (C3);
  [B] upgrade completo sem "rode X" (C7); [C] falha no meio → utilizável
  (atomicidade); [D] idempotente; [E] `git status` limpo em worktree vivo (C1);
  [F] rehydrate que falha diz por quê (C6).
- v2: [I] cenário real (`.claude` sujo + QA `verified` + dispatch morto) migra
  (C1+C3+C4); [J] `git status` limpo em todos os repos pós-upgrade (C1);
  [K] prune libera QA `verified`, recusa dev não pushado (C2); [L] worktree
  ausente não bloqueia / vivo bloqueia (C4); [M] mensagem fora de workspace +
  blockers acionáveis (C8); [N] imutabilidade `merged` de pé.
