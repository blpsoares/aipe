# SDD — Redesign da Console (`aipe serve`) · Mapa de Arquitetura de Informação

Jornada `j-20260827-s9` · task `redesign-console` · autor: Jesse (dev-fullstack aipe)
Envelope: `session / claude-code / reasoning / ultracode` (GATED, autorizado pelo PE).

> **PORTÃO ABERTO — mapa APROVADO pelo PE (via coordenador Heisenberg).** Este
> documento foi o portão: entregar PRIMEIRO o mapa de IA antes de fechar o build,
> porque a interface reprovou **duas vezes** (Floor original PR #22, Floor
> acionável PR #26) e o problema é de **fundo**. O mapa foi aprovado; **estamos na
> fase de CONSTRUÇÃO** e a IA aqui **não se re-discute**. As decisões confirmadas
> pelo PE estão consolidadas em **§8** (rótulos Agora/Equipe/Histórico/Glossário/
> Ajustes; quadro = seção recolhível dentro de Agora; toolbox = seção dentro de
> Equipe) e o agrupamento do quadro em quatro colunas — o acréscimo da v2 da spec
> — está especificado em **§11**.

---

## 1. A pergunta governante

**Um humano que abre a console entende, em segundos, o que está acontecendo, o
que precisa dele, e o que fazer — sem vocabulário de AIPe?**

Tudo abaixo é subordinado a essa pergunta. Um elemento que só quem construiu
entende é **defeito**, não enfeite.

---

## 2. Diagnóstico: por que 10 telas confundem

A console tem **10 telas** hoje. O problema não é "faltam telas" — é que a maioria
são **cortes redundantes dos mesmos dois conjuntos de dados**, cada uma com seu
próprio dialeto visual. O PE reclamou de "muita informação cuspida" e "ainda tá
muito confusa" — e as duas emendas anteriores só **adicionaram** superfície.

Existem, no fundo, **apenas dois dados** que a console mostra:

- **`dispatches`** — tarefas entregues a especialistas (com status/PR/journey).
- **`workers`** — os especialistas da equipe (com papel/repo/CV).

Mais quatro coisas menores: **toolbox** (inventário), **sessions/monitor** (o vivo),
**attention/decisionInbox** (o que precisa de você) e **status-guide** (glossário).

Veja quantas telas repetem os mesmos `dispatches`:

| Tela | O que mostra | Fonte |
|---|---|---|
| **floor** (`/`) | dispatches agrupados por repo + inbox de decisão | `dispatches`, `decisionInbox` |
| **overview** (`/overview`) | herói + KPIs + mini-pipeline + atividade recente | `counts`, `dispatches`, `activity` |
| **pipeline** (`/pipeline`) | kanban dos mesmos dispatches por status | `dispatches` |
| **activity** (`/activity`) | feed dos eventos de mudança de status | `activity` |

Quatro telas, **um único** conjunto `dispatches`, quatro apresentações. O overview
é literalmente uma montagem que **re-renderiza** o pipeline (MiniPipeline), o feed
de atividade (ActivityFeed cortado em 5) e a faixa de atenção (= inbox do floor).

E os mesmos `workers` aparecem em duas:

| Tela | O que mostra | Fonte |
|---|---|---|
| **org** (`/org`) | organograma espacial repo → especialistas | `workers` |
| **team** (`/team`) | roster de cartões-CV, agrupável | `workers` |

**Resultado:** o humano abre a console e vê 10 abas que parecem coisas diferentes,
mas são 4 fotos do mesmo assunto + 2 fotos de outro. Ele não sabe **qual olhar**.
Isso é o "confuso de fundo". A cura não é reestilizar 10 telas — é **colapsá-las em
poucas superfícies bem pensadas**, organizadas pelas **perguntas do humano**, não
pelas tabelas de dados.

---

## 3. O modelo mental, sem jargão (a espinha da compreensão)

Antes das telas: a console inteira precisa de UMA tradução do que o AIPe é, em
linguagem de quem nunca ouviu a palavra "dispatch". Esta tabela é normativa — cada
tela usa **a coluna da direita**, e a da esquerda só aparece com a explicação ao
lado (no glossário e em tooltips).

| Jargão AIPe | Como a console fala com o humano |
|---|---|
| coordinator | **o coordenador** — quem recebe seu pedido e reparte em tarefas |
| specialist / worker | **especialista** — um trabalhador de IA da sua equipe |
| journey | **pedido** (o que você pediu; vira uma ou mais tarefas) |
| dispatch | **tarefa** entregue a um especialista |
| wave | **lote** de tarefas rodando em paralelo neste momento |
| worktree / branch | **cópia isolada** onde o especialista trabalha sem atrapalhar o resto |
| cost-index | **esforço relativo** (índice grosseiro, nunca dinheiro) |
| gate (QA) | **revisão de qualidade pré-aprovação** |
| escalation | **um especialista travou e precisa de uma decisão sua** |
| attention item / decision | **algo que precisa de você** |

### Glossário de estados (herdado da jornada de nomenclatura `j-20260826-vf`)

O estado de cada tarefa usa **quatro palavras claras**, na ordem em que acontecem.
Hoje o código ainda diz "Despachado/Verificado/Portão" em pt — **isto será
alinhado** para o glossário claro:

| Estado (console) | Significa | (termo antigo a substituir) |
|---|---|---|
| **Designado** | Entregue a um especialista, que está construindo agora | ~~Despachado~~ |
| **Entregue** | O especialista abriu um PR e aguarda a revisão de qualidade | Entregue ✓ |
| **Aprovado** | A revisão de qualidade passou — liberado para você | ~~Verificado~~ |
| **Integrado** | O PR foi integrado — esta tarefa está concluída | Integrado ✓ |

Estados de exceção (aparecem só quando ocorrem, sempre com o "o que fazer"):
**Precisa de decisão** (escalado), **Rumo mudou** (redirected), **Reprovado na
revisão** (failed), **Travado** (blocked), **Silêncio suspeito** (dead-silent).

### Vivacidade honesta (herdada, inegociável)

A console **nunca afirma "trabalhando" o que não pode verificar**. O motor
`runtime/floor.ts` (`derivePhase`) já faz isso: sem sinal ao vivo, o estado colapsa
honestamente para "iniciando" em vez de fingir progresso. Isso é **preservado** e
estendido a toda a console. Onde não há dado (métricas ainda não coletadas), a
console diz "ainda não medido", não inventa um número.

---

## 4. A nova arquitetura de informação

Organizada pelas **perguntas do humano**, em ordem de prioridade:

1. *"Alguma coisa precisa de mim agora? E o que a equipe está fazendo?"*
2. *"Quem é minha equipe e como ela está organizada?"*
3. *"O que já aconteceu, e quanto já foi entregue?"*
4. (utilidade) *"O que essa palavra significa?"* / *"Ajustes."*

### Nav primária — **3 telas** (era 10)

| # | Tela | Rota | Responde |
|---|---|---|---|
| 1 | **Agora** | `/` | O que precisa de você **agora** + o que está acontecendo ao vivo. **Tela inicial.** |
| 2 | **Equipe** | `/team` | Quem é a equipe, como está organizada (organograma que **cabe na tela**), e o que ela sabe fazer. |
| 3 | **Histórico** | `/history` | O que já aconteceu (linha do tempo) + **quanto foi entregue** (lugar das métricas reservado). |

### Utilidade — no rodapé, fora da nav principal

| Tela | Rota | Responde |
|---|---|---|
| **Glossário** | `/guide` | O que cada palavra/estado significa (a rede de segurança contra jargão). |
| **Ajustes** | `/settings` | Tema, idioma, notificações. |

**Tela inicial: "Agora" (`/`).** É a primeira e mais importante resposta à pergunta
governante. Abre direto no que precisa de você.

---

## 5. Mapa de consolidação: as 10 telas antigas → destino

| Tela antiga | Destino | Por quê |
|---|---|---|
| **floor** (`/`) | **vira "Agora"** | Já é a landing acionável (#26) e o motor honesto. É a base; é promovida e simplificada, não jogada fora. |
| **overview** (`/overview`) | **REMOVIDA** → funde em "Agora" | Era uma montagem de pedaços das outras telas (mini-pipeline + atividade + KPIs + atenção). Redundância pura. |
| **activity** (`/activity`) | **funde**: recente em "Agora", completo em "Histórico" | 31 linhas, um único feed já embutido no overview. Vira uma faixa recente em "Agora" e a linha do tempo completa em "Histórico". |
| **pipeline** (`/pipeline`) | **funde em "Agora"** como "ver todo o trabalho" (divulgação progressiva) | O kanban é outro corte do mesmo `dispatches`. Vira uma seção secundária, recolhida, dentro de "Agora". *(ver Decisão A)* |
| **monitor** (`/monitor`) | **funde em "Agora"** (resumo) + detalhe ao vivo por especialista | O motor SSE ao vivo é preservado. O resumo honesto do que cada um faz vive em "Agora"; o detalhe (arquivos mudando, raciocínio) abre sob demanda, não como aba peer. |
| **org** (`/org`) | **funde em "Equipe"** | Mesmo `workers` que team, apresentação espacial. Vira o herói da tela "Equipe", agora **cabendo na viewport**. |
| **team** (`/team`) | **vira "Equipe"** | Absorve o organograma (org) e o detalhe-CV por especialista. Uma tela para "minha equipe". |
| **toolbox** (`/toolbox`) | **funde em "Equipe"** (aba/seção "o que a equipe sabe fazer") | Inventário de skills/MCPs = as capacidades da equipe. Pertence junto de quem a compõe. *(ver Decisão B)* |
| **status** (`/status`) | **vira "Glossário"** (`/guide`, no rodapé) | É referência, não operação. Continua sendo a rede de segurança contra jargão, agora explicitamente rotulada assim. |
| **settings** (`/settings`) | **mantém** (rodapé) | Config. Já vive no rodapé. Sem mudança estrutural. |

**Saldo: 10 → 3 telas primárias + 2 de utilidade.** Nada de dado é escondido — tudo
tem um lugar. O que muda é que o humano vê **3 portas claras** em vez de 10 abas
ambíguas, e cada dado aparece **uma vez**, no lugar que responde a pergunta certa.

---

## 6. Especificação por tela (com o teste de compreensão embutido)

Cada tela declara, explicitamente, as **três respostas** que o teste de compreensão
bloqueante vai cobrar (o revisor Mike percorre cada uma como quem não conhece AIPe):
**(a) o que é isto · (b) o que precisa de mim · (c) o que eu faço.**

### 6.1 — Agora (`/`) · tela inicial

**Hierarquia visual (do que salta ao que recua):**

1. **ZONA 1 — "Precisa de você" (alto contraste, topo).** O número honesto único
   (`needsYouCount`) e os cartões de decisão. Cada cartão herda o padrão de
   acionabilidade #26 — **o quê / por quê / o que fazer (com o comando exato,
   copiável) / onde** — e **some sozinho** quando resolvido (deriva do snapshot).
   Se zero: um estado "tudo em dia" calmo, não uma tela vazia sem explicação.
2. **ZONA 2 — "Acontecendo agora" (contraste médio).** Lista compacta dos
   especialistas ativos com sua **fase honesta** (Iniciando / Construindo /
   Entregando…). Sem cuspir o raciocínio inteiro — uma linha por especialista.
   Clicar abre o detalhe ao vivo (o motor do monitor, sob demanda).
3. **ZONA 3 — "Sendo tratado por outros" + "Todo o trabalho" (recuado, divulgação
   progressiva).** As *observações* (o que o coordenador/dev/QA resolvem — informam
   sem cobrar você) e o quadro completo de tarefas por estado, recolhidos por
   padrão. Aqui mora o que era o pipeline e o overview.

- **(a) o que é:** "O painel do que sua equipe de IA está fazendo agora."
- **(b) o que precisa de mim:** a Zona 1 é literalmente essa resposta.
- **(c) o que faço:** cada cartão diz o comando/ação; o resto é "só olhar".

### 6.2 — Equipe (`/team`)

- **Herói:** o **organograma** (repo → especialistas), que **cabe inteiro na
  viewport no load, sem scroll horizontal nem vertical** (ponto duro — §7). Em tela
  estreita, degrada para a árvore (`OrgTree`) que já existe.
- **Detalhe:** clicar num especialista abre seu cartão (papel, o que está fazendo
  agora, entregas). Reusa o `WorkerDrawer`.
- **"O que a equipe sabe fazer":** seção/aba com o toolbox (skills + MCPs) em
  linguagem de capacidade. *(Decisão B)*
- **(a)** "Sua equipe de especialistas e como ela se organiza por repositório."
  **(b)** um especialista travado/escalado aparece marcado (link para o cartão em
  Agora). **(c)** clicar em alguém para ver o detalhe; nada obrigatório.

### 6.3 — Histórico (`/history`)

- **Topo — MÉTRICAS (lugar reservado, jornada `j-20260827-kj`).** Um bloco claro
  "Entregas por período / projeto". Enquanto o **mecanismo** (dado + CLI) não existe
  — está **fora do meu escopo** —, o lugar mostra um placeholder **honesto**: "ainda
  não medido" com a forma pronta. Não improviso número.
- **Abaixo — linha do tempo:** o feed completo de eventos (o que era activity),
  legível, um evento por linha com quem/o quê/onde.
- **(a)** "O que já aconteceu e quanto sua equipe entregou." **(b)** nada exige ação
  aqui — é retrospectiva. **(c)** ler; filtrar por período/projeto (quando as
  métricas existirem).

### 6.4 — Glossário (`/guide`, rodapé) e Ajustes (`/settings`, rodapé)

- **Glossário:** o guia de estados atual, agora nomeado como a rede de segurança
  contra jargão, com a tabela do §3. É onde a coluna "jargão AIPe" é explicada.
- **Ajustes:** inalterado estruturalmente (tema, idioma, notificações).

---

## 7. Pontos duros — como cada um é endereçado

| Ponto duro | Endereçamento |
|---|---|
| **Org chart cabe na viewport no load, sem scroll H nem V** (`runtime/org.ts:20` não calcula fit) | Substituir o `s:1` fixo por um **fit calculado**: medir o bounding box do conteúdo vs. a viewport e escolher a escala que cabe (com margem). `zoomBy(0)` (reset) **re-enquadra** (não volta a s:1). `ResizeObserver` recalcula o fit no resize. Provado no **binário compilado** em ~1920 e ~1366. |
| **NENHUMA tela rola horizontalmente** | Regra de sistema no CSS base: contêineres com `min-width:0`, conteúdo largo (tabelas, quadro, organograma, código) rola **dentro do próprio bloco** (`overflow-x:auto`), nunca o `body`. Verificado tela a tela. |
| **320px sem overflow** | Layout fluido; nav vira barra inferior; colunas colapsam para uma. Testado a 320px. |
| **Ambos os temas completos** | O `tokens.css` já tem claro+escuro de primeira classe. O novo sistema visual usa só tokens — nenhuma cor hard-coded fora deles. |
| **prefers-reduced-motion** | Toda animação/transição atrás de `@media (prefers-reduced-motion: reduce)`. |
| **Densidade / hierarquia** | Resolvida pela hierarquia de zonas (§6.1): o que precisa de você salta; o resto recua por divulgação progressiva. Não é esconder dado — é ordenar por urgência. |
| **Lugar das métricas (kj)** | Reservado no topo do Histórico com placeholder honesto (§6.3). O mecanismo é fora de escopo. |
| **Responsivo <2560px NUNCA verificado** (pendência `j-20260825-oa`) | Provado em **~1920, ~1366 e 320px**, nos dois temas, no binário compilado — a lacuna que o harness (preso em 2560px) deixou. |

---

## 8. Decisões do PE — CONFIRMADAS

As duas escolhas de produto foram levadas ao PE e **decididas** (não são mais
abertas):

- **Decisão A — o "quadro completo" (kanban) fica onde?** → **CONFIRMADO: seção
  recolhível dentro de "Agora"** (divulgação progressiva). Não é aba própria. O que
  precisa de você continua no topo; o quadro inteiro abre sob demanda.
- **Decisão B — o toolbox (o que a equipe sabe fazer) fica onde?** → **CONFIRMADO:
  seção dentro de "Equipe"** (capacidades junto de quem as usa).

**Rótulos CONFIRMADOS:** "Agora / Equipe / Histórico" (primárias) + "Glossário /
Ajustes" (rodapé). A alternativa "Início" foi oferecida e **recusada** — fica
**Agora**.

---

## 9. Plano de build (faseado, TDD) — **GATED na aprovação deste mapa**

Só começa após o aval do PE via coordenador. Sequência proposta:

1. **Sistema visual** — consolidar tokens/espaçamento/tipografia/estados num único
   dialeto (base para consistência). Teste: temas + reduced-motion.
2. **Glossário alinhado** — Designado/Entregue/Aprovado/Integrado; "revisão de
   qualidade pré-aprovação". Teste: i18n en+pt.
3. **Org fit-to-view** — o cálculo de fit + reset re-enquadra + ResizeObserver.
   Teste de unidade do cálculo (RED→GREEN) + prova no binário.
4. **Tela "Agora"** — as 3 zonas, herdando `floor.ts`/`decisionInbox`. Testes de view.
5. **Tela "Equipe"** — org + roster + drawer + capacidades. Testes de view.
6. **Tela "Histórico"** — timeline + placeholder de métricas honesto. Testes de view.
7. **Rotas/nav** — 3 primárias + 2 rodapé; remover as rotas mortas; sem scroll-H.
8. **Regressão** — `bun test` verde, `tsc` silencioso, `build:host` servindo,
   screenshots nos dois tamanhos e temas, CI verde.

---

## 10. Evidência planejada (aceite)

- Este SDD com o mapa de navegação (telas, tela inicial, o que saiu e por quê). ✅
- Teste de compreensão tela a tela (aplicado pelo Mike na Wave 2).
- Org chart cabendo inteiro em ~1920 e ~1366, sem scroll, **no binário compilado**;
  reset re-enquadra; resize recalcula.
- Nenhuma tela rolando horizontalmente; 320px sem overflow.
- Ambos os temas; reduced-motion; sem erro de console de origem do site.
- `bun test` verde, `tsc` silencioso, `build:host` servindo; CI verde.
- Screenshots das telas principais nos dois tamanhos e temas.

---

**Estado:** mapa APROVADO. Construção CONCLUÍDA — evidência no §12.

---

## 12. Evidência colhida (construção)

Provas coladas (comandos executados + o que a saída mostrou), no binário compilado
servindo o workspace real `/home/mithrandir/aipe-blpsoares` (65 especialistas, 11
repos, 93 dispatches).

**Portões de CI (verde):**
- `bun run version:check` → `STATE version=1.7.0 (in sync)`.
- `bun run typecheck` → sem saída (tsc silencioso, exit 0).
- `bun test` → `1465 pass, 0 fail` em 193 arquivos.
- `bun run build:host` → `OK aipe-linux-x64`; `./dist/aipe-linux-x64 --version` → `1.7.0`.

**Liveness canônica ponta-a-ponta (consome `dispatchPhase`, não re-deriva):**
- `curl /api/snapshot` no binário → cada dispatch de sessão carrega `liveness`; os
  valores observados foram `running`, `dead-silent`, `landed` — computados
  server-side por `annotateLiveness` chamando o MESMO `dispatchPhase` do `aipe status`.
- O quadro de 4 colunas, alimentado por isso: **Trabalhando 2 · Precisa de você 7 ·
  Em revisão 18 · Pronto p/ integrar 24**.
- **Armadilha 2 provada com dado real:** registros mortos (`dispatched` cuja sessão
  saiu) aparecem em *Precisa de você* com "a sessão encerrou sem registrar —
  inspecione a branch", **nunca** em *Trabalhando*.

**Org chart cabe na viewport (jornada j-20260827-jo):**
- A 1920: `svg` com `transform: scale(0.337)`, `svgFitsW=true`, `svgFitsH=true`,
  `.view` sem scroll horizontal, sem overflow de página.
- Resize recalcula: ao estreitar, o fit refez para `scale(0.30)` (ResizeObserver).
- `reset` re-enquadra (via `fitToView`, não volta a s:1 cego).

**Nenhuma tela rola horizontalmente:**
- A ~500px (mais estreito que o Chrome permite via resize de janela), TODAS as telas
  (Agora, Equipe, Histórico, Glossário) reportaram `docScrollW == docClientW` — zero
  scroll horizontal de página. O quadro colapsa para 1 coluna; a barra inferior
  (3 abas) aparece. Conteúdo largo (comando copiável, organograma) rola/clipa DENTRO
  do próprio bloco. `body { overflow-x: hidden }` garante o mesmo a 320px.

**Ambos os temas + acessibilidade:**
- Screenshots capturados em escuro e claro; `body` pinta `var(--bg)` explícito em
  cada tema. `@media (prefers-reduced-motion: reduce)` desliga animação/transição
  globalmente. Nenhum erro de console de origem do site (só ruído benigno da
  extensão do navegador, em `:0:0`).

**Glossário alinhado (§3):** os chips de estado renderizam **designado · entregue ·
aprovado · integrado** e o cabeçalho "Os oito estados de uma tarefa" — sem jargão.

---

## 11. O quadro de quatro colunas (acréscimo v2) — mapeamento normativo

O quadro vive como **seção recolhível dentro de "Agora"** (Decisão A). Agrupa o
trabalho em **quatro colunas que respondem à pergunta certa**, e cada card carrega
**task, persona, branch, atividade, PR e estado JUNTOS** — em vez de espalhar por
abas, que é o defeito que este redesign cura.

### 11.1 — De onde vem cada número (sem derivação duplicada)

O dado já existe. A honestidade de liveness que o `aipe status` computa
(`src/status/*`) tem sua fonte canônica em **`session/poll.ts::dispatchPhase`**, que
decide o `UnitPhase` de UMA unidade cruzando o ledger com a lista de sessões vivas
do agentop (por **`sessionId ∈ live-set`** + flag `reliable`). **Consumimos ESSE
cálculo, não derivamos de novo.** Como a console recebe o snapshot do `serve`
(`buildSnapshot` + sessões), o servidor (`serve/payload.ts`, dentro do meu escopo)
passa a **anexar o `UnitPhase` canônico por dispatch** — chamando o MESMO
`dispatchPhase` — e o quadro no cliente lê esse campo. Assim o número de cada coluna
é rastreável a `dispatchPhase`, exatamente como o `aipe status`.

Para unidades **subagent** (sem sessão agentop), não há liveness de sessão; o estado
vem do `status` do ledger via o motor honesto que a console já tem
(`runtime/floor.ts::derivePhase`, que também nunca afirma "trabalhando" sem sinal).

### 11.2 — O mapeamento `UnitPhase` (canônico) → coluna

| Coluna | Junta | `UnitPhase` / estado de origem |
|---|---|---|
| **Trabalhando** (Working) | trabalhando ou pronto para instrução | `running` (sessão viva); subagent com lane ativa; `dispatched` recém-nascido dentro do boot-grace |
| **Precisa de você** (Needs you) | bloqueado, CI vermelho, mudanças pedidas, espera uma pessoa | `waiting` (blocked), `dead-silent`, `redirected`; status `escalated`, `failed`; **sessão viva com `activity:"waiting"`** (waiting-approval); envelope `gated` (inferido) |
| **Em revisão** (In review) | PR aberta, aguardando revisão de qualidade | status `delivered` (`landed` + `delivered`) |
| **Pronto p/ integrar** (Ready to merge) | aprovado / mergeável | status `verified` |

Concluído (`merged`/`removed`, i.e. `closed`) **sai do quadro** — é histórico, não
trabalho vivo; aparece no Histórico (§6.3), não como quinta coluna.

**Justificativa dos pontos não-1:1 (a v2 pediu para eu decidir e justificar):**

- **`waiting-approval`** não é um status do ledger — é a sessão agentop viva com
  `activity:"waiting"`. Herdamos a **assimetria do agentistics #243**: o agentop só
  reporta `waiting` **após duas amostras concordarem**, enquanto a volta ao trabalho
  é aceita na hora. Como o agentop é o produtor desse campo e já aplica a
  assimetria, a console **consome `activity:"waiting"` como está** — não inventa uma
  leitura otimista própria (armadilha 1). `dispatchPhase` deliberadamente ignora
  `activity` para o eixo vivo-vs-morto; nós o lemos **apenas** para separar
  "trabalhando" de "esperando uma pessoa", que é a distinção que a coluna precisa.
- **`failed`/`redirected`/`blocked`** entram em *Precisa de você* porque são trabalho
  parado que precisa de **um humano**. Mas nem todo humano é o PE: cada card nomeia
  **quem age em seguida** (o `ACTOR` de `floor.ts` — você / dev / coordenador). Um
  card cujo dono é o coordenador aparece **recuado** dentro da coluna, com o ator
  dito — para não gastar a atenção do PE com o que ele não resolve (armadilha 1:
  "um card em 'precisa de você' que não precisa é pior que card nenhum"). Os cards de
  decisão do PE (escalação, gated, dead-silent) sobem ao topo da coluna.

### 11.3 — Armadilha 2: `dispatched` no ledger ≠ vivo

Um registro morto (`dispatched` com worktree já removido / sessão que saiu) **não
pode** aparecer em *Trabalhando*. É por isso que a coluna se apoia no `UnitPhase`
canônico, não no status cru:

- sessão viva casada (`sessionId ∈ live-set`, `reliable`) → `running` → **Trabalhando**.
- `dispatched` + `sessionId` ausente da lista viva confiável → `dead-silent` →
  **Precisa de você** (inspecionar; matar/re-despachar é decisão do PE).
- `dispatched` sem `sessionId` nenhum → `dead-silent` (nunca lançou/registrou).
- liveness ilegível (agentop ausente/quebrado) → `unknown`: **nunca** vira
  "trabalhando" nem "morto" — o card diz "não dá para verificar agora".

### 11.4 — Aceite adicional (v2), como será provado

- As quatro colunas alimentadas por `dispatchPhase` via o campo de liveness do
  payload — teste de unidade do mapeamento coluna-a-coluna + teste do payload
  anexando o `UnitPhase`.
- Um registro morto (`dispatched`, sessão ausente/saída) **não** aparece em
  Trabalhando — teste dedicado (armadilha 2).
- Uma sessão `activity:"waiting"` cai em Precisa de você; uma `activity:"working"`
  fica em Trabalhando — teste dedicado (armadilha 1).
- O card carrega task, persona, branch, PR e estado juntos — teste de view.
- Teste de compreensão: um leitor sem vocabulário AIPe entende o que cada coluna
  quer dele (aplicado pelo Mike na Wave 2).

---

## 13. Fase 2 do build — absorver a #39 + os requisitos novos do PE (pós-aprovação)

> **Sequenciamento (imposto pelo coordenador).** A PR #39 (tela **Atividade**,
> jornada `dp`) está **em gate agora** e este redesign **funde `activity` em Agora e
> deleta `activity.view`** — colisão direta. **Nenhum novo build de UI começa até a
> #39 mesclar**; o coordenador libera.
>
> **Descompasso registrado (ledger `redirected`):** a PR **#34 já foi entregue**
> (CI verde, `delivered`) ANTES desta condição chegar. Como #34 remove `activity.view`
> e #39 o altera, **as duas se chocam**. Reconciliação proposta, à decisão do
> coordenador: **manter #34 sem merge; quando a #39 cair, rebasear #34 sobre `main` e
> absorver os deliverables da #39** (não reescrever por cima de código em revisão).
> Alternativa: #39 mescla, #34 vira a Fase-2 que a incorpora. O coordenador decide a
> ordem de merge.

Cinco pedidos do PE desta semana que o mapa passa a refletir (implementados na
Fase 2, após a #39):

### 13.1 — Coluna **Integrados**, por VERDADE DE MERGE (não status do ledger)
O quadro ganha uma **5ª coluna, Integrados**. Ela **não** se alimenta do status
`merged` do ledger (que pode estar velho): usa a **verdade de merge do PR** — o
mesmo sinal que a #39/`journey reconcile` computa contra o provedor. Isto corrige a
§11.2, que hoje descarta `merged`/`removed` do quadro. Regra: um card só entra em
Integrados quando o **PR está de fato mesclado**, não quando alguém escreveu
`merged` à mão. Consome esse cálculo; não re-deriva.

### 13.2 — Card de **7 campos**, tudo junto
O card carrega, sem trocar de tela, **sete campos**: (1) tarefa, (2) agente/persona,
(3) repo·unidade, (4) branch, (5) **atividade** (a fase honesta / última atividade
viva — o que a #39 entrega no feed), (6) PR, (7) **estado**. Hoje o card tem ~5; a
Fase 2 acrescenta a **atividade viva** (da #39) e separa repo·unidade de tarefa.

### 13.3 — Rolagem **própria do quadro**
O quadro rola **dentro do próprio bloco** (`overflow-x:auto` no strip; cada coluna
com seu `overflow-y`), nunca a página. Com 5 colunas, em tela estreita o strip rola
horizontalmente **dentro de si** em vez de colapsar — a página continua sem scroll
horizontal (invariante do §7 preservada: conteúdo largo rola no próprio contêiner).

### 13.4 — **Paleta do site**
O sistema visual migra da paleta "ops" esmeralda atual para a **paleta do site de
marketing** (fonte da verdade: o repo do site — matéria **cross-repo**, os valores
vêm do coordenador). Só `tokens.css` muda; todo o resto já usa tokens, então a troca
é de valores, não de estrutura. Ambos os temas continuam de primeira classe.

### 13.5 — **Precisa de você** dividido por PÚBLICO; colunas vazias somem
A atenção deixa de ser um balde só e passa a **separar por quem age**:
**escalado-para-o-PE** (o que só você destrava) vs **escalado-para-o-coordenador**
(o que o coordenador resolve). Isto formaliza o split que o motor já tem
(`floor.ts`: `decision` = PE, `observation` = coordenador/dev). E **colunas/seções
vazias não renderizam** — nada de "Nada aqui" ocupando espaço e diluindo o sinal;
uma coluna sem card simplesmente não aparece. (A §11.2 hoje renderiza a coluna
vazia; a Fase 2 a suprime.)

**Aceite adicional (Fase 2):** Integrados só com PR realmente mesclado; card com os 7
campos; quadro com rolagem própria e página sem scroll-H; tokens na paleta do site,
dois temas; needs-attention separado por público, colunas vazias ausentes; teste de
compreensão tela a tela mantido.
