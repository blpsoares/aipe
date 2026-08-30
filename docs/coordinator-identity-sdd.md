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

### (fix v3) Caminho de remoção do registro — `hooks/`, `claude-code.ts`, `coordinator-awareness.ts`
O gate de QA achou um buraco **bloqueante** na v2: o registro do coordenador era
**imortal**. `pickPid()` sempre retornava 0 (nenhuma env — `AIPE_SESSION_PID`/
`AGENTOP_SESSION_PID` — é carimbada; o próprio código já documenta que **o agentop
não carimba `AGENTOP_SESSION_ID` no ambiente**), e `releaseCoordinator` não estava
ligado a hook nenhum. Sem sinal de morte real (pid 0 = vivo) **nem release
explícito**, toda entrada de coordenador vivia para sempre — e o aviso passava a
listar sessões **mortas** como ativas, mandando dar `attach` em fantasmas que se
acumulavam a cada troca.

O fix fecha isso por dois lados, sem tocar no agentop:

- **Release explícito no fechamento limpo.** Um hook `SessionEnd` (`aipe
  session-context --release`) chama `releaseCoordinatorAwareness`, que recomputa a
  **mesma** identidade do claim e apaga o arquivo desta sessão. Vale nos dois
  caminhos de instalação: o plugin (`hooks/hooks.json` + `hooks/session-end`) e o
  project-scoped (`ensureSessionStartHook` grava o par SessionStart+SessionEnd em
  `.claude/settings.json`, idempotente). Fechou o Claude Code do jeito normal
  (`/clear`, saída, resume) → sem fantasma. Best-effort e guardado: o teardown
  nunca quebra por falha de release.
- **Aviso honesto sobre o resíduo.** No `COLLISION`, cada `other` é anotado por
  liveness: `pid>0` = `verified alive`; `pid 0` = `liveness UNVERIFIABLE`. Quando
  há algum não-verificável, o aviso acrescenta que o AIPe **não consegue verificar**
  que aquele dono ainda está vivo — se o `attach` falhar, a sessão já fechou e pode
  ser retomada com segurança. O aviso deixa de afirmar "ativo" sobre quem talvez
  tenha caído.

**Resíduo honesto (escalado):** um crash duro / `SIGKILL` **não** dispara
`SessionEnd`, então a entrada pid-0 daquele coordenador ainda fica até o próximo
fechamento limpo do dono. Podar isso automaticamente exige um **sinal de vida
verificável** — um pid de sessão que só o `agentop` pode carimbar (mesmo limite já
registrado para `AGENTOP_SESSION_ID`). É cross-repo: **escalado, não improvisado**.

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

Carimbar um **pid de sessão verificável** no ambiente (`AGENTOP_SESSION_PID`).
Sem ele, `pickPid()` fica em 0 e a poda automática de um coordenador que **caiu
sem fechar** (crash/SIGKILL, sem `SessionEnd`) é impossível — o release explícito
cobre o fechamento limpo, mas o resíduo do crash duro precisa do agentop. Mesma
fronteira já registrada para `AGENTOP_SESSION_ID`.

## Aceite (provado)

- 2ª sessão de coordenação **detectada** com quem/desde-quando/`attach` — provado
  e2e mesmo com `pid 0`.
- Dono morto comprovado **não** bloqueia (reconciliação de órfão preservada); dono
  não-verificável (pid 0) **colide**, não é apagado — provado e2e (`RECONCILED`
  alto de lock morto; `COLLISION` de lock pid-0 vivo).
- "Terminou e não processado" visível no `aipe status` — provado e2e com agentop
  vivo (`finished-unprocessed`).
- **Registro não é mais imortal:** fechamento limpo libera a identidade via
  `SessionEnd` (`--release`) — provado e2e (sem fantasma após release) e por
  unidade; o aviso é honesto sobre o dono pid-0 não-verificável (`cannot verify`),
  e o resíduo do crash duro está documentado/escalado (precisa do pid do agentop).
- `bun test`, `tsc` limpo, `build:host` + smoke OK, sem linha binária.
