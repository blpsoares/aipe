# Plan — o ciclo de QA com dentes

## Abordagem

Cada regra vira uma RECUSA no ledger, no mesmo lugar e com a mesma forma dos
portões que já funcionam (evidência, CI). O padrão que já provou funcionar aqui:
o portão recusa, injeta seus resolvedores, e fica inerte para quem não os passa
— nunca fabrica um passe nem uma reprovação a partir do nada.

## Onde cada coisa mora

| Peça | Arquivo | Por quê ali |
|---|---|---|
| Validador da Task Spec | `src/journey/task-spec.ts` | puro: template + parser + validação, sem I/O |
| Registro por unidade | `JourneyLedger.taskSpecs` | a unidade sobrevive às suas linhas; redespacho, conserto e QA trabalham contra a MESMA spec |
| Comando | `journey task-spec` | espelha `journey spec`: scaffold → check → approve → show |
| Portões do QA | `recordDispatchGuarded` §1c | onde os outros portões já vivem; um só lugar decide |
| Recusa no despacho | `dispatchCommand` passo 1 | antes de escrever prompt ou abrir sessão |
| Lacuna do reconcile | `reconcile.ts` + `verify.ts` | o forge é a autoridade sobre o merge; a auditoria é onde a lacuna aparece |

## Decisões que custam explicar

**Escopo por unidade, não por linha.** O dev entrega na linha dele; o QA registra
em linha separada (persona e task próprias). Checagem por linha perguntaria à
linha do QA se ela mesma entregou algo — o que ela nunca faz. Rodada alcançada e
rodada aprovada são MAX sobre as linhas da unidade.

**Silêncio não compra o piso.** Sem tamanho declarado, a rota cai no fluxo
COMPLETO. Não declarado não é estabelecido como trivial; tratar como trivial foi
o que mesclou 7 de 7 PRs sem spec. O caso trivial passa a ser o que se declara.

**Identidade, não rótulo.** `--evidence-by qa` é assumido por padrão nesse status,
então sozinho não certifica nada. A regra com dentes é: quem entregou não assina
a verificação.

**O caminho viaja, o texto não.** O prompt congela no despacho; arquivo lido na
hora do trabalho não envelhece. Conserta a #98 de graça.

**Agrupar por ordem de varredura, não por zip.** Três arrays paralelos deslocariam
todos os pares se uma flag faltasse no meio — evidência mal atribuída lê como
coberta, e isso é pior que evidência ausente.

## Sequência

1. Validador puro + testes (A10).
2. Registro no ledger + comando + round-trip. **Cuidado medido:** a escrita E a
   leitura do ledger são allowlists; campo novo some nas duas pontas com o write
   reportando sucesso.
3. Recusa no despacho (A9).
4. Portões do QA (A1–A6) e a mecânica de rodada (A7).
5. Carimbo da lacuna no reconcile + finding na auditoria (A8).
6. Documentar no `operate` e no `review-delivery`, senão o QA não sabe registrar
   item por item e nada disso acontece na prática.

## Risco assumido

Fixtures que pulavam o ciclo (dispatched → verified direto) passam a falhar. São
atalhos de setup, não asserções: cada um foi levado ao fluxo real (o dev entrega,
o QA verifica em linha própria) **sem enfraquecer nenhuma asserção**. Um fixture
consertado baixando a régua seria o mesmo defeito que esta spec existe para
remover.
