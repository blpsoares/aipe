# SDD — Identidade registrada do coordenador (j-20260829-5q)

> O coordenador não tinha identidade em lugar nenhum — nem no ledger, nem no
> `state.yaml`. Existia só como prosa injetada no `SessionStart`. Três
> consequências saíam daí, e uma quarta (o defeito irmão do path-lock) veio na v2.
> **Princípio único que rege toda a jornada: um dono que não se consegue verificar
> é tratado como VIVO — na dúvida, avisar/colidir, nunca reconciliar em silêncio.**

## Ponto de partida (o que já existia)

- `src/dispatch/lock.ts` — claim atômico por unidade + path-lock, com
  `isLockActive` decidindo liveness por (1) pid morto, (2) ledger `dispatched`,
  (3) freshness. **O buraco:** todo lock do coordenador nasce com `pid: 0`
  (`cli.ts` default), e o passo (1) só prova morte para `pid > 0` — então um lock
  pid-0 envelhecido, sem `dispatched`, caía no `return false` final e era
  reconciliado como órfão. Isso apagou lock VIVO de outra task **duas vezes num
  dia** (pacote-oss, PR #37).
- `src/session-hook/` — `aipe session-context` injeta a "awareness" do coordenador
  no `SessionStart`. Já monta um bloco de estado (item 8) de forma guardada.
- `src/status/` — a derivação única do `aipe status`, com a seção "waiting on the
  PE" e a liveness honesta (`dead-silent` só com live-list confiável).

## Delta desta jornada

### (1)+(3) Identidade registrada + detecção de N coordenadores — `src/runtime/coordinator.ts`
Registro por sessão em `.aipe/runtime/coordinators/` (um arquivo por sessão,
espelhando `serve-registry.ts`). Reaproveita a **ideia** do claim (dono + sinal de
liveness + reconciliação de órfão), **não** a semântica inteira: política
**AVISAR, NÃO BLOQUEAR** (mesmo rumo do path-claim). `livenessOf`: `pid>0` decide;
`pid 0` é `unverifiable` → tratado VIVO. `liveCoordinators` só poda um órfão
**comprovadamente morto** (pid real ausente); um dono não-verificável é mantido e
surfacado, nunca dropado em silêncio. `claimCoordinator` devolve `others` (a 2ª
sessão detectada), `reconnected` (adoção de identidade órfã) e `persisted`.

### (Continuidade, item da spec) — `src/session-hook/coordinator-awareness.ts`
No `SessionStart` de um coordenador já onboarded, reivindica a identidade e injeta
uma linha **acionável**: quem mais está ativo, desde quando, e o que fazer
(`attach`). Totalmente guardado — degrada para vazio, nunca derruba a abertura da
sessão. **Limite do agentop** (watches endereçados por nome de sessão) documentado
na prosa de reconexão: se re-endereçar os watches exigir mudança no agentop,
**escale** — é cross-repo, não improvise.

### (2) A fila que se perde na troca — `src/status/{types,assemble}.ts`
Novo `WaitingKind: "finished-unprocessed"` **derivado**, não inventado: uma
unidade em modo sessão ainda `dispatched` no ledger cuja sessão **saiu de forma
confiável** (`dispatchPhase === "dead-silent"` com `sessionId`). Cai na seção que
já mostra o que aguarda o PE, então flui automático para o `aipe status` e para o
bloco de estado do `SessionStart`. Nunca chuta "saiu" de um ponto cego: live-list
ilegível → `unknown`, não `finished`.

### (5) Um lock precisa saber se o dono está vivo — `src/dispatch/{lock,cli}.ts`
- `isLockActive` ganha o sinal (4): **`pid <= 0` (não-verificável) → VIVO.** O
  passo (1) — pid real morto → órfão — fica intacto, então a reconciliação de
  quem **comprovadamente** morreu continua. O custo é deliberado e endossado pelo
  coordenador: um dono pid-0 que de fato caiu é recuperado por `dispatch release`
  ou `--force` autorizado, não por sobrescrita silenciosa. Quem passa `--pid` real
  mantém recuperação automática de crash via sinal (1).
- **Silêncio impossível:** `claimResult.reconciledLocks` carrega TODO lock
  removido; `cli.ts` anuncia cada remoção em uma linha `WARN` própria (quem, desde
  quando, sobre quais paths, e o que fazer) em vez da antiga linha-única de rotina.

## Trava crítica

Nada disso pode quebrar o `SessionStart`. Toda a leitura de identidade é
best-effort e guardada (`try/catch` → vazio); a liveness do `status` já degrada
para `unknown`/`none`. Workspace a meio-onboarding ou ledger corrompido **degrada**,
não derruba.

## Fronteira (out of scope, escalado)

Mudar como o `agentop` endereça destinatários de notificação (watches por nome de
sessão). O AIPe **registra o nome que usou** e a sessão nova **reivindica** essa
identidade; fechar o loop de re-endereçamento dos watches é matéria do `agentop`
(cross-repo).

## Aceite (provado)

- 2ª sessão de coordenação **detectada** com quem/desde-quando/`attach` — provado
  e2e mesmo com `pid 0`.
- Dono morto comprovado **não** bloqueia (reconciliação de órfão preservada); dono
  não-verificável (pid 0) **colide**, não é apagado — provado e2e (`RECONCILED`
  alto de lock morto; `COLLISION` de lock pid-0 vivo).
- "Terminou e não processado" visível no `aipe status` — provado e2e com agentop
  vivo (`finished-unprocessed`).
- `bun test` 1533/0, `tsc` limpo, `build:host` + smoke OK, sem linha binária.
