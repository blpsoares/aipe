# Spec — o ciclo de QA com dentes

## Problem

O critério de pronto nunca teve dentes. Medido em 2026-08-31: três features,
seis gates aprovados, **três reprovações do PE em cima do que já tinha passado**.

A causa não são as pessoas — foram QAs diferentes, em repos diferentes. É que
nada obrigava um veredicto a existir, a ser independente, a responder os
critérios um a um, ou a se repetir depois que o código mudou embaixo dele. O
aceite era prosa livre, então o QA inventava **proxy**: provou que a stream
conectava, provou que um resumo no cabeçalho mudou — enquanto o que o PE pediu
(conseguir **digitar** no terminal) nunca foi teste de ninguém.

Caso concreto: um dev e uma QA leram `disableStdin: true`, chamaram de "design
pré-existente, não regressão", e entregaram. Nenhum documento aprovado dizia
que digitar era o objetivo.

## Objective

Toda tarefa terminada por um especialista é testada por um QA independente,
contra os critérios da Task Spec que o PE aprovou antes de existir código — e é
retestada depois de qualquer conserto. Verdade por RECUSA, não por diligência
de ninguém.

## Acceptance

- **A1** — Action: registrar `--status verified` numa unidade onde nada foi
  entregue · Effect: recusa `verify-needs-delivery`; nenhuma linha é escrita.

- **A2** — Action: o mesmo especialista que registrou `delivered` registra
  `verified`, com `--evidence-by qa` · Effect: recusa `verify-needs-qa` dizendo
  que a verificação é checagem INDEPENDENTE. O rótulo não compra a passagem.

- **A3** — Action: QA registra `verified` com resumo único, sem responder os
  critérios, numa unidade com Task Spec aprovada de dois critérios · Effect:
  recusa `verification-incomplete` nomeando `!NO-EVIDENCE A1 · !NO-EVIDENCE A2`.

- **A4** — Action: QA responde só um dos dois critérios · Effect: recusa
  nomeando **apenas** o que falta (`!NO-EVIDENCE A2`), nunca o que foi coberto.

- **A5** — Action: QA responde os dois critérios com comando e observação ·
  Effect: `OK verified` — e nenhum `--evidence-summary` genérico é exigido por
  cima, porque a evidência por critério É a evidência.

- **A6** — Action: registrar `merged` numa unidade que ninguém verificou ·
  Effect: recusa `merge-needs-qa` dizendo que toda tarefa terminada é testada
  antes de aterrissar.

- **A7** — Action: o ciclo de conserto — QA reprova, dev é redespachado com
  razão, entrega o conserto, e alguém tenta mesclar · Effect: recusa; a
  aprovação da rodada anterior não sobrevive ao retrabalho. Só depois do
  reteste o merge é aceito.

- **A8** — Action: `journey reconcile` aprende do forge que a PR mesclou sem
  passagem do QA · Effect: o ledger registra `merged` (o forge é a autoridade
  sobre o que aconteceu) **e** carimba a lacuna; `journey verify` reprova com
  finding crítico `merged-without-qa`.

- **A9** — Action: despachar unidade roteada ao fluxo completo cujo Task Spec
  não existe, não está aprovado, sumiu, ou mudou depois da aprovação · Effect:
  recusa antes de escrever qualquer prompt e antes de abrir qualquer sessão.

- **A10** — Action: escrever um critério de aceite que nomeia mecanismo ("use o
  token X") · Effect: o validador recusa dizendo o que falta (uma Action e/ou
  um Effect). É no efeito que o critério de mecanismo desmonta.

## Tests the QA runs

- **A1** — `journey record --status verified --evidence-by qa` num ledger novo;
  afirmar `REJECT verify-needs-delivery` e ledger com zero linhas.
- **A2** — gravar `delivered` como Jesse, depois `verified` como Jesse com
  `--evidence-by qa`; afirmar `REJECT verify-needs-qa` e a palavra `INDEPENDENT`.
- **A3** — Task Spec aprovada com A1/A2; `verified` com `--evidence-summary`
  único; afirmar os dois `!NO-EVIDENCE`.
- **A4** — o mesmo cobrindo só A1; afirmar que a mensagem contém `!NO-EVIDENCE A2`
  e **não** contém `!NO-EVIDENCE A1`.
- **A5** — cobrir os dois com `--verify-item/--verify-cmd/--verify-summary`, sem
  `--evidence-summary`; afirmar `OK verified`.
- **A6** — `delivered` e então `merged`; afirmar `REJECT merge-needs-qa`.
- **A7** — pela CLI real: failed → dispatched(--reason) → delivered → merged
  (recusado) → verified → merged (aceito). Afirmar a recusa no meio.
- **A8** — `reconcileJourney` com um fetcher que devolve MERGED e nenhum
  `verifiedRound`; afirmar `status === "merged"`, `qaGap === true`, e um finding
  crítico `merged-without-qa` do `verifyJourney`.
- **A9** — `dispatchCommand` nos quatro estados (ausente, não aprovada, arquivo
  sumido, editada depois); afirmar código 1 e **zero** arquivos de prompt.
- **A10** — `validateTaskSpec` sobre um item sem Action/Effect; afirmar
  `mechanismOnly` nomeando o que falta.

**Prova por mutação, exigida:** remover cada regra tem de derrubar os testes
dela. Regra cujo teste passa com a regra removida não tem dentes.

## Constraints

- **Obrigue o ARTEFATO, nunca o mecanismo.** Nada no prompt do especialista pode
  citar slash command de um harness só — `codex` e `copilot` nunca os veem.
- O ledger é allowlist na escrita **e** na leitura: campo novo tem de entrar nas
  duas pontas ou some em silêncio com o write reportando sucesso.
- `round`/`verifiedRound` são bookkeeping do ledger. Nenhuma flag pode defini-los,
  ou uma passagem velha poderia ser redeclarada como atual.
- Tudo é por UNIDADE, não por linha: o dev entrega na linha dele, o QA registra
  em linha separada.

## Anti-regression

- `disableStdin` bloqueava digitar e passou por seis gates → A3/A4: critério não
  exercido é `!NO-EVIDENCE`, não passa.
- Spec emendada depois do despacho não alcançava quem já trabalhava (#98) → A9:
  o prompt carrega o CAMINHO, e spec editada depois da aprovação recusa.
- `--size` aceito e ignorado → a rota do SDD é derivada do ledger e o portão de
  entrega morde sem flag nenhuma (#118).
- Reconcile escrevia `merged` sem passar pelo portão → A8.

## Out of scope

- A persona spec writer e o contexto isolado (R1/R2 do desenho aprovado).
- Fazer o AIPe impedir um merge no GitHub. O forge é de quem tem o botão; o que
  se pode é registrar a verdade e reprovar na auditoria.
