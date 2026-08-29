# SDD — "Atividade": o quadro como tela própria (`j-20260829-dp`)

> Estende o redesign da console (`j-20260827-s9`, PR #34 — mergeado em `cc3a5d5`).
> Aquele mapa colapsou 10 telas em 3 e pôs o quadro de 4 colunas como **seção
> recolhível dentro de "Agora"**. Esta jornada reabre essa decisão porque o
> quadro cresceu de "uma seção" para "a tela onde se trabalha", conserta a coluna
> que **mente sobre o estado**, e alinha a paleta da console à do site.
>
> Fonte: `.aipe/journeys/j-20260829-dp/orientation.md` (v1→v5, cinco rodadas do
> PE), consolidada pelo coordenador (Heisenberg) via `agentop session attach`.

## 1. A pergunta governante

O redesign respondeu *"o que precisa de mim, e o que a equipe faz agora"*. O uso
real, num workspace com **30+ jornadas e 112 dispatches**, expôs uma segunda
pergunta que a seção recolhível de "Agora" não sustenta: **"como está o trabalho
todo — e onde ele realmente está?"** Essa é a pergunta de "Atividade".

Os quatro defeitos originais são o mesmo problema de fundo: **a tela trata
histórico e trabalho vivo como a mesma coisa**, então o que precisa de atenção
afoga no que já acabou. O item (2) — "pronto para integrar" contendo coisa **já
integrada** — não é cosmético: é um indicador de atenção que **mente**, da mesma
classe do `waiting` falso, e "um indicador que mente gasta o recurso mais caro do
sistema, e depois de enganar duas vezes para de ser lido".

## 2. Decisão de IA: por que "Atividade" não é um corte redundante de "Agora"

A quarta tela foi autorizada pelo PE. O risco declarado é regredir ao defeito que
o redesign existiu para curar — **telas que são cortes redundantes do mesmo
dado**. A divisão, portanto, não é de moldura, é de **pergunta**:

| | **Agora** (`/`) | **Atividade** (`/activity`) |
|---|---|---|
| Pergunta | *O que exige uma ação minha, agora?* | *Como está todo o trabalho?* |
| Natureza | Caixa de entrada — curta, só o acionável | Quadro completo — ver e organizar |
| Conteúdo | Zona "Precisa de você" (decisões do PE) + "Acontecendo agora" (o que roda ao vivo) | As 5 colunas (+ Integrados), filtros, colunas montáveis, card completo |
| Sucesso | **Vazia** ("tudo em dia") | Densa e navegável sem rolar a página |
| Some quando | O item é resolvido no ledger | Nunca — é o mapa do trabalho |

**O que SAI de "Agora":** a seção recolhível "O quadro completo" (o `<Board>` de 4
colunas + observações) migra para "Atividade". "Agora" deixa de carregar o quadro
inteiro; fica com as duas zonas de urgência. Isso remove a sobreposição na raiz:
"Agora" nunca mais mostra a mesma lista de "Atividade" com outra moldura, porque
deixa de mostrar a lista completa — mostra só o subconjunto acionável, que é uma
**projeção diferente** (decisões do PE + o que roda agora), não um corte do mesmo
dado. O link "ver tudo" de "Acontecendo agora" aponta para "Atividade".

Nav primária passa a **Agora · Atividade · Equipe · Histórico** (Glossário e
Ajustes seguem no rodapé), pelo mesmo sistema de auto-descoberta de rotas
(`routes.generated.ts` a partir de `views/*.view.tsx`).

## 3. "Tipo um Jira" — ver e organizar, nunca agir

Decisão registrada do PE: a console `serve` é **read-only**. "Atividade" filtra,
agrupa, monta colunas, abre o detalhe de uma sessão e **copia o comando** para
agir noutro lugar. Nenhuma ação escreve no ledger nem mata sessão — isso é do
coordenador e dos specialists, com evidência obrigatória. Onde agir for o próximo
passo, mostra-se o **comando copiável**, estendendo o padrão da Floor acionável
(#26): cada pendência diz o quê, por quê, o que fazer e onde.

## 4. Item (2), o mais grave: a coluna que mente, e a coluna de Integrados

### 4.1 O que se encontrou

Hoje `columnOf` (`runtime/board.ts`) manda `merged`/`removed` para fora do quadro
(retorna `null`) e põe `verified` em `ready` ("pronto para integrar"). O defeito:
**um dispatch cujo PR já mergeou pode continuar em `verified` no ledger** porque a
transição `verified → merged` é registrada à mão pelo coordenador e nem sempre
acontece. Resultado: itens **já integrados** aparecem em "pronto para integrar".

Casos reais deste workspace (status `verified` no ledger, PR mergeado no GitHub):
documentados em §10 (evidência), com o "antes".

### 4.2 O conserto: a tela lê a verdade, não pinta por cima

O conserto **não é deduplicar/repintar na renderização** — isso esconderia o
defeito e deixaria `verify`/`status` contando errado. É **reconciliar a verdade
do merge**, e a spec proíbe re-derivar o cálculo do `status`, então a verdade tem
de ser computada **server-side** e viajar no payload, do mesmo jeito que
`liveness` já viaja:

- Uma nova anotação server-side `integrated: boolean` por dispatch (em
  `serve/payload.ts`, ao lado de `annotateLiveness`), positiva quando o trabalho
  **está em `main`** independentemente do status do ledger. Sinais, ambos
  necessários:
  1. status de ledger `merged` — a verdade declarada.
  2. **`merge-base --is-ancestor <branch> origin/main`** no clone — prova local,
     barata, sem rede: pega _fast-forward_ e _merge-commit_.
  3. **estado `MERGED` do PR** (via `gh`, `d.pr`) — pega o **squash-merge**, que
     o `--is-ancestor` **nunca** enxerga: o squash cria um commit novo e os
     commits originais da branch jamais viram ancestrais de `main`. Como o aipe
     mergeia por squash, sem este sinal *todo* verified squash-mergeado ficava
     preso em "pronto para integrar" (falso-negativo sistemático — re-gate B).
     **Lição do teste:** medir _queda de contagem_ (34→7) não é medir _verdade de
     merge_ — o teste que fecha o buraco afirma que um `verified` com PR `MERGED`
     mas branch não-ancestral **não** aparece em "pronto para integrar" (9→0).

  **A rede fica FORA do render (re-gate B2).** `buildServePayload` roda por
  cliente SSE a cada 3s + cada evento de fs; um `gh pr view` ali dispararia
  ~1 chamada/s/aba (~3600/h), estouraria a cota do GitHub, e sob rate-limit
  `gh → null → integrated=false` faria o mergeado **voltar** para "pronto" — a
  mentira do item 2, agora pior sob carga. Então: `annotateIntegrated` é
  **síncrono** e lê um **cache em memória**; um único **refresher server-owned**
  (`startPrMergeRefresher`, em `server.ts`) é o ÚNICO que toca `gh`, num timer
  lento (`unref`), com timeout, concorrência limitada, TTL, e `MERGED` **sticky**
  (nunca rebaixa sob falha). O build nunca faz rede; a console segue **read-only**
  (o refresher não escreve o ledger). Guarda: o build é síncrono (não aguarda
  rede) e o refresher prova sticky/TTL/no-downgrade.
- `integrated` é **aditivo e conservador**: na dúvida (repo ausente, branch
  desconhecida, git indisponível) → `false`, nunca um falso "integrado". A tela
  consome `integrated`; **não** roda git.

Uma **sexta coluna, "Integrados"**, recebe tudo que é `integrated` (ou
`merged`/`removed`). "Pronto para integrar" passa a conter **apenas** o que ainda
não está em `main`. A reconciliação de verdade do ledger (rodar `verified→merged`)
continua sendo do coordenador; a tela para de mentir enquanto isso.

## 5. Item (1): rolagem própria e contagem de elididos

Cada coluna tem **altura contida e rola dentro de si**; a página não estica. O
cabeçalho da coluna diz **quantos itens há**, e quando a virtualização/altura
elide, **quantos ficaram fora da vista** — porque "elisão silenciosa lê-se como
'isso é tudo' quando não é", regra já estabelecida no `aipe status`. Sem rolagem
horizontal em nenhuma tela (herdado do #34); `reduced-motion` respeitado.

## 6. Item (3): só o vivo por padrão

**Ativo** = tudo que não é terminal, mais o que aguarda o PE. Terminal =
`merged`, `removed`, e agora `integrated` (§4). Ao abrir, "Atividade" mostra só o
ativo; **Integrados e histórico ficam a um clique** (um toggle "mostrar
concluídos"). Nada vivo pode ser escondido junto com o histórico — esconder
trabalho ativo seria pior que a poluição que motivou o pedido (gate do Mike).

## 7. Item (4): o PE monta o próprio quadro

O mais aberto dos quatro — **prefere-se o simples que funciona ao genérico que
impressiona**. Não é um construtor de consultas; é um conjunto pequeno de **campos
reais combináveis**: `estado`, `repo`, `persona`, `jornada`, `aguarda-o-PE`,
`vivo/morto`. O PE:

- **Filtra** por qualquer combinação desses campos (E entre campos, OU dentro de
  um campo).
- **Agrupa em colunas** por um campo (o padrão de fábrica agrupa por *estado* nas
  6 colunas de §4).
- A configuração **persiste** em `localStorage` (padrão do repo para preferências
  — theme e i18n já o usam), com **"voltar ao padrão de fábrica"**. Padrão de
  fábrica = item (3): agrupado por estado, só ativos.

## 8. O card: 7 campos, a exceção em destaque

O PE pediu, textual: **status, título da tarefa, repositório, responsável,
harness, modelo, effort**. (O 8º campo cogitado, *ambiente/environment*, foi
**descartado** desta jornada pelo coordenador: não existe no ledger e a semântica
é ambígua — vira jornada própria se o PE definir.)

- **Primário** (sempre legível): responsável (avatar+nome), status (cor `--st-*`),
  título da tarefa, repo. Responde o teste de compreensão: quem é, o que faz, em
  que estado, se precisa de você.
- **Título da tarefa:** não se inventa um campo que ninguém preenche. Deriva-se,
  em ordem: `task` legível → primeira frase do `reason` → `—`. Um título opcional
  que fica vazio na prática é pior que não ter.
- **Envelope (harness, modelo, effort): secundário e por-exceção.** Dado real:
  de 11 dispatches em voo, **todos** eram `claude-code` + `claude-opus-4-8` +
  `reasoning`; só o effort de um destoava. Um card que grita o comum e esconde o
  diferente informa menos. Regra: o envelope aparece **discreto** e só **realça**
  (chip colorido) o campo que **foge do padrão do quadro** (a moda dos dispatches
  visíveis). O comum fica recuado; a exceção salta.
- **Legado sem envelope renderiza limpo:** ausência não é erro — o campo
  simplesmente não aparece, sem placeholder de defeito.
- **Hierarquia com 8 itens:** o primário (4) manda; o envelope (3) é uma linha
  recuada; o título é a linha forte. Cabe. Se em teste de compreensão não couber,
  o corte proposto é o envelope-comum (mantendo só a exceção) — mas a medição
  (§10) mostra que cabe.

## 9. Paleta: adotar a do site, e impedir a divergência de voltar

O site (`packages/aipe-site/src/index.css`, repo `openvibes-embark`) tem 41
tokens com acento **roxo** (`--brand: 98 66 224`) e — o achado que importa —
**tokens semânticos por estado**: `--st-dispatched … --st-removed`, nos dois
temas. A console tinha 36 tokens, acento **verde** (`--accent: #059669`), e
pintava estado com genéricos (`--sky/--amber/--slate/--rose`) escolhidos caso a
caso. A divergência nasce exatamente daí.

**Decisão (aprovada pelo coordenador):**

- **(a) Tokens de estado do site, verbatim.** `--st-*` viram a fonte única de cor
  de estado na console. `statusMeta` e `orgColor` deixam de mapear estado para
  genérico à mão; passam a devolver `--st-<estado>`. **Um token por estado torna
  impossível dois lugares pintarem o mesmo estado de cores diferentes** — é o
  mecanismo anti-divergência *dentro* da console.
- **(b) Superfícies/texto/acento alinhados por aliases.** `tokens.css` adota os
  triplos RGB do site (`--surface-1/2/3`, `--text/muted/faint`, `--brand`,
  `--line/-soft`) como **fonte canônica única**, e os nomes antigos da console
  viram **aliases** (`--panel → rgb(var(--surface-1))`, `--ink → var(--text)`,
  `--accent → var(--brand))` …). Evita reescrever `base.css` inteiro de uma vez
  (risco desnecessário nesta entrega).
  - **Os aliases são dívida técnica, por construção.** Marcados como transitórios
    no arquivo, com a condição de remoção explícita: *migrar os ~300 usos de
    `base.css`/componentes para os nomes canônicos, então apagar o bloco de
    aliases*. Sem isso, em três meses ninguém sabe se `--panel` ainda é usado de
    verdade ou é só o alias.
- **(c) Dois temas com paridade** (o mecanismo `:root` + `@media dark` +
  `[data-theme]` da console é mantido; só os **valores** trocam).
- **(d) Sem regressão de contraste** em hover/foco/seleção — a troca verde→roxo
  mexe em todos eles; medido em §10.

**Limite (cross-repo, fora desta jornada):** a sincronia console↔site é
genuinamente cross-repo — a console compila para binário standalone (CSS
embutido), então não há import em runtime, e o site é de outro repo/persona. O
conserto de raiz é **um pacote de tokens publicado**, consumido pelos dois. Isso
é **matéria do coordenador**; sinalizado aqui, não implementado.

## 10. Item (5): a duplicata `jane`/`Jane` — defeito de DADO, na gravação

O PE viu dois cards para a mesma pessoa/branch/jornada. Causa catalogada: **a
chave de upsert do ledger inclui o nome do specialist e é case-sensitive**. O
coordenador registra `Jane` com `--package`; o specialist se auto-registra como
`jane` (o slug da skill), muitas vezes **sem** `--package` e com o repo prefixado
pela org (`blpsoares/agentistics`). Viram duas unidades — mesmo trabalho, contado
duas vezes.

**Conserto na NORMALIZAÇÃO AO GRAVAR** (`journey record`), não na tela:

- **Specialist** resolvido contra `personas.yaml` (case-insensitive) → nome
  canônico.
- **Repo** normalizado (`blpsoares/agentistics` → `agentistics`).
- Assim `jane`+`blpsoares/agentistics` e `Jane`+`agentistics` na mesma task
  colapsam para **um** registro.

**Duas travas inegociáveis (coordenador):**

1. **Imutabilidade de unidade `merged` não relaxa.** Há duplicatas presas atrás de
   um `merged`; a migração as alcança **sem furar** a garantia (já houve caso em
   que o ledger recusou, corretamente, fechar uma à mão). Provado de pé.
2. **Os ledgers existentes carregam intactos** — 112 dispatches, ~30 jornadas,
   vários legados/incompletos. Provado com carga antes/depois.

**Migração/reconciliação** (`aipe journey dedupe [--dry-run]`) que alcança as
duplicatas já gravadas neste workspace, inclusive as travadas atrás de `merged`,
sem reescrever unidades imutáveis. Achado ao implementar: a chave só de
`(repo, specialist)` **não colapsa** os casos reais, porque o registro
auto-feito frequentemente **omite `--package`** (e às vezes `--task`) — a chave de
upsert então diverge no `package`. O **branch é o eixo confiável**: idêntico nas
duas grafias (o print do PE frisou "a mesma branch"). Então a migração colapsa por
`(repo-normalizado, specialist-normalizado, branch)` e recupera o `package`/`task`
mais completo para a unidade sobrevivente; a normalização ao gravar (repo +
specialist) cobre o caso catalogado do dia-a-dia. Neste workspace: **50 duplicatas
colapsadas em 28 jornadas, 14 normalizadas, 0 residuais, 46 ledgers carregando
intactos, unidades `merged` preservadas byte-a-byte**.

## 11. Item (6): `aipe status --json` expõe o envelope

Bloqueio real: os campos `harness`, `model`, `tier`, `intensity` existem no
`JourneyDispatch`, mas **`aipe status --json` não os expõe** — o coordenador teve
de ler os YAMLs à mão. Como a tela consome o cálculo do `status` e a spec proíbe
re-derivar, sem isto o card não conseguiria mostrá-los.

- **(a)** `--json` passa a expor `harness`, `model`, `tier`, `intensity`; e uma
  **varredura** por outros campos retidos do mesmo jeito (§10 lista o que achou).
- **(b)** O card exibe harness/modelo/effort **a partir do payload**, sem
  re-derivar.

## 12. Plano de build (TDD, na ordem de dependência)

1. **Paleta** (fundação — primeiro, senão é retrabalho). `tokens.css` canônico +
   aliases; `statusMeta`/`orgColor` → `--st-*`. Teste-guarda: todo estado do
   ledger tem `--st-*` nos dois temas; nenhuma função de estado devolve genérico.
2. **`status --json` + varredura** (`src/status`). RED→GREEN expondo o envelope.
3. **Verdade do merge** (`serve/payload.ts` `integrated` + `board.ts` coluna
   Integrados; "pronto p/ integrar" só o não-integrado). Prova com caso real.
4. **Rolagem + elisão** (`Board`/CSS) e **só-vivo por padrão** (toggle).
5. **Tela "Atividade"** (`views/activity.view.tsx`, rota própria) + **filtros /
   colunas montáveis / persistência** + **card de 7 campos** com exceção em
   destaque. "Agora" perde a seção do quadro.
6. **`jane/Jane`** (`src/journey`): normalização ao gravar + migração; provar as
   duas travas.

## 13. Evidência planejada (aceite)

- (1) coluna longa rola interna; página não estica; contagem de elididos aparece.
- (2) **nenhum item mergeado em "pronto para integrar"** — caso real deste
  workspace, com o antes; coluna Integrados populada pela verdade do `merge-base`.
- (3) ao abrir, só o vivo; histórico/integrados a um clique; nada vivo escondido.
- (4) montar um quadro, recarregar, permanecer; voltar ao padrão de fábrica.
- (5) RED→GREEN: `jane`/`blpsoares/agentistics` + `Jane`/`agentistics` na mesma
  task → **um** registro; migração alcança as duplicatas existentes, inclusive as
  travadas atrás de `merged`; imutabilidade de `merged` provada de pé; `aipe
  status` sem persona repetida; **112 dispatches carregam intactos**.
- (6) `--json` com `harness/model/tier/intensity` + varredura; card exibindo, sem
  re-derivar; hierarquia provada (primário legível com 8 itens); legado limpo.
- (7) console usando `--st-*`; aliases marcados transitórios; dois temas com
  paridade; contraste hover/foco/seleção sem regressão; antes/depois nos dois
  temas.
- Teste de compreensão nas **quatro** telas; sem rolagem horizontal; ambos os
  temas; `reduced-motion`.
- `bun test`, `typecheck`, `build:host`, CI verdes; `git diff --numstat
  origin/main` sem linha binária.
