# Spec — Gate de despacho MUST + precedência-envelope + gate de QA

Journey: j-20260708-n8 / stream governance

## Problema

O enforcement do AIPe hoje é descritivo ("o coordenador não edita repo",
"despache specialists"). Descrição não segura: sob pressão ("é simples", "é
urgente", "eu já sei o fix") o coordenador racionaliza e edita o repo direto,
furando o modelo de PRs por specialist. Além disso não há garantia de que o QA
do repo rode antes de algo ser dado como "pronto".

## Objetivo (dois eixos + gate de QA)

### A. Gate de despacho inegociável (MUST)
Toda demanda do PE ao coordenador DEVE percorrer: decompor -> despachar
specialist em worktree -> specialist abre PR. Linguagem MUST + uma **tabela de
não-exceções** com as racionalizações proibidas:
- "é simples / é trivial"
- "é urgente"
- "é interativo"
- "é sensível a segurança"
- "é só um arquivo / uma linha"
- "eu já investiguei e sei o fix"

Única saída legítima: o PE pedir **explicitamente** execução inline
(user-instruction explícita do humano > skills; menção casual NÃO conta).

Ações PERMITIDAS ao coordenador: **decompor**, **despachar**,
**investigar em modo read-only**, **escalar**. EDITAR um repo NUNCA é ação do
coordenador.

### B. Precedência-envelope
AIPe governa **roteamento** (quem faz / como flui) e **sobrepõe**. As
process-skills (systematic-debugging, TDD, brainstorming) NÃO são desligadas —
elas rodam **DENTRO do specialist despachado**, nunca no coordenador. O
coordenador não "debuga" nem "faz TDD" no repo; ele roteia para quem faz.

### D1. Gate de QA
Após cada entrega de dev (PR do dev-fullstack), o **QA do mesmo repo** é
despachado como gate antes de qualquer coisa ser reportada como "pronto" ao PE.
Só depois do veredito do QA a unidade conta como entregue.

## Onde entra (arquivos do escopo)

- `src/session-hook/awareness.ts` — identidade injetada no coordenador: gate de
  despacho MUST + tabela de não-exceções + ações permitidas + cláusula envelope.
- `skills/operate/SKILL.md` — mesma gate MUST + tabela + envelope + o passo do
  gate de QA no fluxo.
- demais `SKILL.md` (context-brain, make-workspace, relationship,
  hire-specialists, toolbox, aipe-add-repo) — firmar passos comportamentais hoje
  descritivos para MUST-language + referência ao gate.
- `src/harness/*` — suporte ao gate de QA onde couber (rótulo/descrição da
  persona QA reflete que ela é o gate de entrega).

## Aceitação (validar de verdade)

1. Gate de despacho com MUST-language + tabela de não-exceções aparece em
   `awareness.ts` E em `operate/SKILL.md`.
2. Cláusula envelope explícita nos dois.
3. Só opt-out explícito do PE dispensa despacho (casual não conta).
4. Passo do gate de QA documentado em `operate/SKILL.md`.
5. Testes de awareness/session-start atualizados e verdes; `bun test` passando.

## Plano

1. Spec (este arquivo) + commit.
2. TDD: estender `awareness.test.ts` e `session-start.test.ts` com asserts do
   gate/tabela/envelope/ações-permitidas; ver falhar.
3. Implementar `awareness.ts` (constantes GATE/envelope injetadas em todos os
   estados de coordenador operante).
4. Reescrever `operate/SKILL.md` (gate MUST + tabela + envelope + gate de QA).
5. Firmar os demais SKILL.md.
6. Suporte de harness ao gate de QA (rótulo persona QA).
7. `bun test` + build smoke; commit; push; PR.
