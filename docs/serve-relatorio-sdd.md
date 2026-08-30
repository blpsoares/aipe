# SDD — Relatório (`aipe report` + tela `/report`)

> Jornada `j-20260829-c8`. Preenche o **mecanismo** da métrica de entrega que o
> Histórico (`serve-console-redesign-sdd.md` §6.3) reservou como placeholder
> honesto ("ainda não medido", diferido em `j-20260827-kj`). Aqui esse número
> deixa de ser placeholder: ganha casa própria no aside, engine determinística
> testada e exportação.

## 1. A pergunta governante

**"Quanto minha equipe entregou — e o dado é honesto o bastante para eu relatar
a terceiros?"**

Um relatório que enche a tela de números sem pergunta é ruído. Cada métrica aqui
carrega, explícita, a pergunta que responde (§4). E cada número diz de onde vem:
medido do ledger, ou derivado — nunca aproximação com cara de precisão (§5).

## 2. Fonte do dado

Uma **única** fonte: os ledgers de jornada (`.aipe/journeys/*.yaml`), lidos por
`listJourneys()`. Cada `JourneyDispatch` carrega `repo`, `package`, `task`,
`specialist`, `status`, `pr`, e o envelope opcional (`harness`/`model`/`tier`/
`intensity`). Não há segunda derivação: a engine `computeReport()` é pura, sem
dep de node, e é consumida **igual** pela CLI (`aipe report`) e pela tela
(`/report`, que roda a mesma função sobre `snapshot.journeys`). Uma definição de
"entrega", um lugar. (Lição das duas derivações de liveness — não repetir.)

Volume real deste workspace no momento da entrega: **159 dispatches** em **61
jornadas com trabalho** (68 no total), **63 PRs distintos**, **21 dispatches sem
envelope**, e duplicatas de persona vivas (`Jesse`/`jesse`, `Mike`/`mike`). É o
volume e a bagunça que revelam os defeitos — a engine é dirigida contra ele.

## 3. Modelo de contagem (sem contagem dupla)

- **Unidade de entrega** = identidade `jornada · repo · package · task ·
  persona`. Várias linhas do ledger para a mesma unidade (progressão
  `delivered → verified → merged`, ou um fix-loop `delivered → failed →
  delivered`) contam **uma vez**. É isso que impede o número de inflar.
- **Persona normalizada** case-insensitive: `Jesse` e `jesse` são a **mesma**
  pessoa. A `dp` corrige a origem; enquanto isso, o relatório não conta duas
  vezes. O nome exibido é a variante com inicial maiúscula.
- **PR** distinto por URL: PRs empilhados (várias unidades no mesmo PR) contam o
  PR **uma vez**.

## 4. As métricas — cada uma com a pergunta que responde

| Métrica | Pergunta que responde | Como é medida |
|---|---|---|
| **Entregas** | "Quanto a equipe produziu?" | Unidades distintas que chegaram a `delivered`, `verified` ou `merged`. |
| **Aprovadas pela QA** | "Quanto passou na revisão de qualidade?" | Unidades distintas que chegaram a `verified` ou `merged`. **Rótulo:** aprovação = crivo da QA interna do AIPe, **não** review do GitHub. |
| **PRs mergeados** | "Quanto de fato entrou no código?" | PRs distintos com status `merged` (medido). `+N derivados` = PRs cujo branch já é ancestral de `origin/main` por `git merge-base` (**derivado**, rotulado). |
| **PRs abertos** | "Quanto está em voo agora?" | PRs distintos que existem e não estão mergeados. |

Teste de compreensão (aceite): um leitor sem vocabulário AIPe lê a coluna do
meio e entende. "Aprovadas pela QA" nunca é apresentada como aprovação de review
do GitHub — o rótulo diz o que é.

## 5. Honestidade sobre o dado (o requisito que separa útil de enganoso)

1. **Ausência ≠ zero.** Ao agrupar por envelope (`model`/`harness`/`tier`), um
   registro sem aquele campo cai num balde **próprio e visível** — `— sem
   envelope —` — nunca é dobrado no balde de um modelo real nem contado como
   zero. O bloco de honestidade reporta quantos são (21 hoje).
2. **Sem contagem dupla** por duplicata de persona (§3) nem por linhas repetidas
   da mesma unidade.
3. **Derivado é rotulado.** "PRs mergeados" separa o medido (ledger) do derivado
   (`git merge-base`). "Período" é derivado do id da jornada (`j-AAAAMMDD-xx`);
   jornada sem data parseável cai em `— sem data —`.
4. **Combinação vazia diz "nada aqui"**, não quebra.

## 6. Filtros e agrupamentos (combináveis)

- **Filtros** (todos combináveis entre si e com agrupamento): `--repo`,
  `--persona` (casado case-insensitive), `--status`, `--since`/`--until` (por
  data da jornada, inclusivo).
- **Agrupamento** `--group-by`: `repo`, `persona`, `status`, `period`, `model`,
  `harness`, `tier`. Aceita múltiplas dimensões combinadas (chave composta) —
  `--group-by repo --group-by period` dá entregas por repo por dia.
- A tela oferece o mesmo: um segmento de "agrupar por" (reusa `.langseg`) e
  chips de filtro; cada grupo é uma linha de tiles.

## 7. Exportável

- `aipe report --json` — o `ReportResult` inteiro (métricas, grupos, bloco de
  honestidade). Estável para script.
- `aipe report --csv` — linhas planas dos grupos (uma por grupo, colunas =
  coordenadas do grupo + as 4 métricas). Poupa copiar da tela para relatar a
  terceiros.
- Sem flag: tabela legível no terminal, com rodapé de honestidade.

## 8. Herança visual

Reusa o sistema da `dp` (redesign da console): `.view-h`/`.sub` no topo,
`.metric-tiles`/`.metric-tile`/`.mt-n`/`.mt-k` nos números, `.langseg` no
agrupar-por, `.card`/`.eyebrow` nas seções, `.pill-pending`/`.chip` nos rótulos
de honestidade. Ambos os temas; sem scroll horizontal (tiles em grid auto-fit,
tabela de grupos em container com `overflow-x:auto`).

## 9. Plano de build (TDD)

1. `src/report/compute.ts` (puro) + `__tests__/compute.test.ts` — modelo de
   contagem, filtros, agrupamento, honestidade, vazio. **RED → GREEN.**
2. `src/report/format.ts` — tabela/CSV/json a partir do `ReportResult`.
3. `src/report/cli.ts` + `__tests__/cli.test.ts` — flags, exportação, exit codes.
4. `src/serve/app/views/relatorio.view.tsx` + teste de view — casa no aside,
   pergunta por métrica, agrupar-por, bloco de honestidade, estado vazio.
5. i18n (en/pt), estilos (reuso + mínimo), registro em `src/cli.ts`, e correção
   do placeholder do Histórico (deixa de dizer "não medido" e aponta o Relatório).

## 10. Evidência de aceite (colhida)

`bun test` (suíte), `bun run typecheck`, `bun run build:host` + smoke, e o
binário compilado dirigido contra **este** workspace (159 dispatches):
`./dist/aipe-linux-x64 report --workspace /home/mithrandir/aipe-blpsoares`
(tabela, `--json`, `--csv`, `--group-by`, combinação vazia). Saída colada no PR.

## 11. Adicionado em v2 — o que o PE cobrou em 30/08

A v1 desta spec descrevia o relatório mas não uma **página própria** nem
**gráficos**. O PE cobrou: *"uma page de dashboard pra eu conseguir filtrar as
entregas, ver gráficos de atividade, por data, entrega, especialista etc."*. Os
acréscimos:

### 11.1 — Os quatro cortes, na própria página

- **Página própria** (`/report`), rota dedicada na nav primária (order 3), com
  contexto único: relatório e análise. **Nenhum componente de operação** (quadro,
  sessões, dispatch) é arrastado para dentro dela.
- **Filtros combináveis na página**: por **especialista**, por **entrega**
  (status), por **data** (`De`/`Até`) — os três funcionando **juntos**, não
  excludentes. As opções de cada filtro são enumeradas pela **mesma** engine
  (`computeReport` agrupando), nunca re-derivadas à mão.
- **Gráfico de atividade ao longo do tempo**: barras de dispatches por dia, com a
  parte preenchida = entregas. **Honesto por construção**: cada barra é uma
  contagem medida independente, as barras não se conectam (nada entre elas é
  interpolado) e um dia sem atividade simplesmente não tem barra — o "eixo que
  mente" que a v2 proíbe não existe aqui.

### 11.2 — Mergeado ≠ publicado (consome `src/release`, não re-deriva)

O relatório **consome** `resolveReleaseStates`/`realReleaseResolver` (jornada
`j-20260830-zd`) — a MESMA fonte que `aipe status` usa — para dizer, por repo, se
o trabalho está **publicado**, **mergeado-não-publicado**, ou **não estabelecido**
(git ilegível). "Se contar entregas, diga entregue onde": a contagem de entregas é
do ledger; a posição de publicação vem do release, lado a lado.

- **CLI** (`aipe report`): resolve uma vez, síncrono, e imprime a seção
  "Publicação por repo".
- **Serve**: um refresher server-side (`startReleaseRefresher`) enche um cache em
  memória por **git local** fora do caminho de render; `buildServePayload` lê o
  cache **síncrono**. Mesma disciplina do cache de PR-merge — a lição da `dp` (`gh`
  no render fez ~3600 chamadas/hora/aba). Um repo ainda não resolvido é
  **`checking`** ("verificando"), nunca um falso "publicado" nem zero — o mesmo
  selo de honestidade de cache-frio do tri-estado de integração.

### 11.3 — O dedup de persona é correção RETROATIVA, não regra permanente

`Jesse`/`jesse` e `Mike`/`mike` existem no ledger porque, **antes** do fix da PR
**#62** (publicado no **v1.12.1**, 30/08), `recordDispatch` casava `specialist`
por **string exata** — gravar `mike` depois de `Mike` criava um dispatch
**duplicado** em vez de atualizar. O fix corrigiu a origem. Logo:

- O dedup case-insensitive deste relatório é uma **defesa contra dado histórico
  sujo** de antes do fix, **não** um sinal de que o ledger tem duplicata por
  design. Confirmado em 30/08 que os pares **ainda existem** no ledger (dado
  histórico) — por isso o relatório precisa lidar com eles.
- Consequência única e consistente: a contagem de entregas dedup na chave
  normalizada, **e** o agrupamento por persona colapsa na forma canônica (`Jesse`),
  batendo com a nota de honestidade — nunca uma linha `Jesse` de 38 ao lado de uma
  `jesse` de 1.

### 11.4 — Os "sem envelope" são 13% do dado, mostrados como ausência

~22 de ~160 dispatches (registros legados) não têm `tier`/`model`/`harness`. O
relatório os **conta** (não os omite) e os mostra como **"não estabelecido"** —
num balde próprio ao agrupar por envelope (`— sem modelo —`, etc.), nunca dobrado
num modelo real e nunca como zero. Esconder 13% dos dispatches por não saber
classificá-los seria pior que mostrá-los como desconhecidos.

### 11.5 — Aceite adicional (v2), como foi provado

- Rota própria na nav; testes `routes.generated`/`BottomNav`/palette atualizados
  para 4 telas primárias.
- Filtros data+especialista+entrega juntos: teste de view combinando persona+status
  (a combinação vazia mostra "nada aqui", não zero fabricado).
- Gráfico: teste de view conta uma barra por dia com atividade, rotulada.
- Publicação: teste de view prova `checking` como "verificando" e `merged` distinto
  de `published`; teste de payload prova cache frio → `checking` e refresher que
  não rebaixa sob falha.
- Dirigido no binário compilado contra este workspace: `--group-by period` (a
  atividade por dia), `--group-by persona` (colapso de duplicata), filtro de data
  combinado, `--csv`, e a seção de publicação (openvibes-embark: 155 commits além
  da v1.5.0 = mergeado-não-publicado; aipe: publicado v1.12.1; agentistics: não
  estabelecido). Saída colada no PR.
- Verificado **na página renderizada**, largura de janela real (declarada), ambos
  os temas, sem scroll horizontal.
