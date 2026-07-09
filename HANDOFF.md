# AIPe — Handoff / Roadmap da reforma do serve + trilhas 2 e 3

> **Para o Claude Code (sessão mobile, continuação):** leia este arquivo inteiro
> antes de tocar em qualquer coisa. Ele é o estado-da-verdade do que está feito,
> do que falta, e de como continuar. As "DECISÕES ABERTAS" no fim precisam do PE
> — quando ele não estiver disponível, use o **default recomendado** de cada uma e
> siga (não trave esperando resposta).

**Data do handoff:** 2026-07-08
**Branch de trabalho até aqui:** `feat/serve-framework-migration` (mergeado em `main` neste handoff)
**PR da fundação:** https://github.com/blpsoares/aipe/pull/11

---

## 0. TL;DR do estado

- **T1.0 (modularização do serve) — 100% FEITO e mergeado.** O monólito
  `src/serve/app.html` (1377 linhas vanilla) virou uma app **Preact + signals +
  preact-iso** modular sob `src/serve/app/`, com feature parity total, auto-descoberta
  de views por convenção, e o **Terminal removido**. `bun test` = **508 pass / 0 fail**,
  `tsc` limpo, binário standalone builda e serve as 8 views. Verificado em checkout limpo.
- **Dos 14 itens do brief:** **#1, #2, #3 já estão resolvidos** pela reescrita (a
  triagem confirmou por código + testes). **#8 (Terminal) removido.** Restam:
  **#4, #5, #6, #7, #9, #10** (serve) + **Trilha 2** (#11, #12, #13, remover sdd-lite)
  + **Trilha 3** (#14 privacidade do workspace).
- Este handoff traz, por item: **status, arquivos exatos, abordagem, esforço e riscos**
  (vindos de uma triagem automatizada contra o código novo).

---

## 1. Como trabalhar neste repo (setup + verificação)

```bash
# Estar no main atualizado
git pull --ff-only
bun install

# Testes e typecheck (o gate)
bun test                         # deve dar 508 pass / 0 fail (baseline atual)
bunx tsc --noEmit -p tsconfig.json

# Dev do serve (rápido, hot-ish reload — F5 pega mudança de view)
bun src/serve/cli.ts serve --port 7799
# depois: curl -s localhost:7799/ | grep -c 'id="app"'  → 1

# Build do binário standalone (roda genRoutes + buildClient + --compile)
bun run scripts/build.ts host
```

**Estrutura do serve novo** (tudo em `src/serve/app/`):
- `main.tsx` — bootstrap (`<App>` + preact-iso Router + chrome + overlays; chama `bootstrap()` que conecta SSE + notify).
- `runtime/` — `store.ts` (signals + derivações puras do snapshot), `sse.ts` (fetch inicial + `/api/stream`), `notify.ts` (som + Notification API + activity-diff), `i18n.ts` (STR en/pt + `t()` reativo), `monitor-store.ts` (lanes do `/api/monitor`), `router.ts` (hash router próprio; `KNOWN_PATHS` valida os paths — ver Minor), `org.ts`, `selectors.ts`, `dom.ts`, `stages.ts`, `ui.ts`.
- `views/*.view.tsx` — 8 views, cada uma exporta `route = { path, nav:{label,icon,order,badge?}, component }`. **Adicionar um arquivo `*.view.tsx` = adicionar uma view/nav-item** (auto-descoberta via `genRoutes` → `routes.generated.ts`).
- `components/` — átomos (Avatar, Chip, Button, ConnBadge, ActivityFeed, CompChips, UnitFacts) + chrome (Sidebar, BottomNav, Topbar, LangSwitch, ThemeToggle) + overlays (CommandPalette, WorkerDrawer) + org (OrgChart, OrgTree, OrgLegend) + MonLane.
- `styles/tokens.css` + `styles/base.css` — design tokens + classes compartilhadas (portadas verbatim do app.html).
- `routes.generated.ts` — **versionado** (gerado por `genRoutes`; é importado estaticamente, então precisa existir no checkout p/ o `tsc`/`test` passarem — NÃO regride isso pro .gitignore). `app.generated.html` continua gitignorado (import dinâmico tolerado).

**Padrão de trabalho (honre):**
- **TDD** por feature: teste primeiro (RED), implementa (GREEN), commit. Testes de view usam `@testing-library/preact` + happy-dom; a 1ª linha do arquivo de teste é `import "./setup"`.
- **Paridade first-class:** onde a migração muda comportamento de propósito, **documente** (não conserte silenciosamente). Desvios já aceitos: JSX escapa tudo; input do org preserva case; `2` hardcoded no subtítulo do Pipeline; botões "Filter"/"All"/"+Dispatch" sem handler (paridade — o #4 abaixo endereça isso).
- **Server é read-only por design** (`handler.ts` = "pure GET handler"; só `GET /`, `GET /api/snapshot`, SSE `/api/stream` e `/api/monitor`). Qualquer feature que exija **escrita** (POST) é uma mudança de invariante de segurança — trate como decisão do PE.
- **Commits em português**, Conventional Commits. Rodapé de commit conforme o repo.
- **1 PR focado por feature/trilha** quando fizer sentido; se estiver sozinho continuando tudo, agrupe por trilha em branches próprios (`feat/serve-ui-fixes`, `feat/rules-process`, `feat/workspace-privacy`).

---

## 2. TRILHA 1 — itens do serve

### ✅ JÁ RESOLVIDOS pela reescrita (só falta seu olho no browser)
- **#1 Overview em branco** — a `OverviewView` (`views/overview.view.tsx`) renderiza hero/KPIs/mini-pipeline/feed; 9 testes passam. **Nada a fazer** além de confirmar visualmente.
- **#2 Sidebar bugada** — `Sidebar.tsx`/`BottomNav.tsx`/`base.css` portados fiel e coerentemente (collapse, mobileopen, tabbar). **Nada a fazer** além de confirmar visualmente em `<860px`.
- **#3 Notificações desktop** — pipeline completo e testado: toggles → `NOTIF.ev` → `wireActivityNotifications` → `notify()` → **`new Notification()` real** (`runtime/notify.ts:84-95`), com fluxo de permissão (botão Grant + auto-request ao ligar "desktop") e botão de teste (`settings.view.tsx`). Ligado no `main.tsx:85` via `bootstrap`. **Nada a fazer** além de confirmar visualmente (aceitar a permissão do browser e testar).

> **Ação sugerida para a sessão mobile:** subir o serve e dar um passe visual em #1/#2/#3 (e no org/monitor). Se algo destoar, aí sim vira tarefa. Caso não consiga browser, considere-os fechados pelos testes.

### 🔧 PENDENTES — front-only (sem tocar server)

#### #5 — Ordenação intencional no organograma (esforço: SMALL)
- **Hoje:** `orgWorkersFor` (`runtime/org.ts:38-42`) só filtra por repo, **não ordena**; specialists saem na ordem crua do snapshot.
- **Fazer:** em `runtime/org.ts`, adicionar um mapa de prioridade de role e ordenar dentro de `orgWorkersFor` (ponto único usado por `OrgChart.tsx:178` e `OrgTree.tsx:34`, propaga pros dois):
  ```ts
  const ROLE_ORDER: Record<string, number> = { "dev-fullstack": 0, "dev-backend": 0, "dev-frontend": 0, qa: 1 };
  const roleRank = (r?: string) => ROLE_ORDER[r ?? ""] ?? 2;
  // return ws.slice().sort((a,b) => roleRank(a.role) - roleRank(b.role) || a.name.localeCompare(b.name));
  ```
- **Antes de fixar o mapa:** dar um grep nos valores reais de `role` que o snapshot emite (`src/dashboard/snapshot.ts` / gerador do snapshot) pra cobrir os roles certos.
- **Teste:** cobrir a ordem esperada (unit em `runtime/org.ts` via um `*.test.ts`). Risco: baixo, 100% client.

#### #6 — Monorepos não listam packages (esforço: SMALL)
- **Hoje:** `OrgChart.tsx:206-231` e `OrgTree.tsx:36` agrupam **só os workers contratados** por `w.package`; a lista completa de packages do repo (`repos[].packages`, derivada em `store.ts:98-111` a partir de `s.packages`) **nunca é iterada**. Um repo só ganha o marcador `mono` (troca label/estilo). Isso é limitação pré-existente preservada 1:1 (não regressão).
- **Fazer:** no loop de `rows` do `OrgChart.tsx` (~206-231), após agrupar por `w.package`, **também emitir um PkgCluster para packages de `info.packages` sem workers** (com um placeholder "sem specialist"). Espelhar em `OrgTree.tsx`. Opcional: seção "Packages" no drawer/`UnitFacts` para repos monorepo, listando `package.name/stack/kind/group`.
- **Dado já disponível** no snapshot (`RawSnapshot.packages`, `store.ts:68`) — **sem mudança no server.** Risco: layout — packages vazios aumentam a altura das colunas (constantes `yS0/pkgH/grpGap`); conferir pan/zoom e `totalW/totalH` visualmente.

#### #4 — Team: agrupamentos + decisão do "+Dispatch" (esforço: MEDIUM)
- **Hoje:** `team.view.tsx:44-67` é grid plano (`cvgrid`), sem agrupamento; botões "All"/"+Dispatch" **sem handler** (o teste atual documenta isso como paridade — precisará ser reescrito).
- **Fazer (parte front, segura):** adicionar toggle/tabs de agrupamento — **"Por projeto"** (`w.repo`/`w.package`), **"Por atividade"** (`w.status`: active/idle/escalated), **"Por especialidade"**. Reaproveitar `WorkerCard`. Reescrever o teste que afirma "non-functional parity" (deixa de ser verdade).
  - **DECISÃO ABERTA (especialidade):** não há campo canônico. `w.role` é grosseiro (dev/qa); `cvOf(w.name).competences` é uma **lista**, não categoria única. **Default recomendado:** agrupar por `w.role` (simples, determinístico) e deixar competences como detalhe do card. Se o PE quiser algo mais rico, usar a 1ª competência como "especialidade primária".
- **DECISÃO ABERTA ("+Dispatch"):** o server é **read-only** — não existe rota de escrita nem, dentro de `src/serve`, capacidade de disparar specialist. **Default recomendado:** **remover** o botão morto (ou trocar por CTA que abre o drawer de um worker idle), documentando. Implementar disparo real exigiria endpoint novo (`POST /api/dispatch`) + integração com o orquestrador fora de `src/serve` — escopo grande; só fazer se o PE pedir explicitamente.

### 🔶 PARCIAIS — parte front-only, parte precisa do server

#### #7 — Live monitor (esforço: (a) SMALL client-only / (b) LARGE cross-stack)
- **(a) "sem agente ativo, mostrar última atividade em vez de vazio"** — CLIENT-ONLY, small:
  - Hoje lane vazia mostra `—` (`MonLane.tsx:66`) e `mon_nofiles` (`:75`); `MonAgentMeta` (`monitor-store.ts:16-20`) não guarda "last seen".
  - Fazer: adicionar `lastActivity?: {text:string; at:number}` a `MonAgentMeta`, atualizar em `monPush` a cada evento (qualquer kind), e trocar o placeholder por esse resumo quando stream/files vazios. Sem tocar server.
- **(b) Streaming de código ao vivo (estilo Lovable)** — CROSS-STACK, LARGE, e **precisa do server**:
  - Hoje `src/serve/monitor.ts` (`parseTranscriptLine:35-75`) só extrai `file_path`/`command` — **nunca lê `input.content` (Write) nem `old_string/new_string` (Edit/MultiEdit)**. O `MonitorEvent` não tem campo de código.
  - Fazer: **server** (`monitor.ts`) — estender `parseTranscriptLine` para capturar o conteúdo/diff de Write/Edit/MultiEdit (truncado a N chars), novo campo no `MonitorEvent` (ex.: `content?`/`diff?` + `truncated?`); **client** — espelhar em `MonStreamEvent` (`monitor-store.ts`) e renderizar um bloco de código (`<pre>`/highlight, com "show more") em `MonLane.tsx`; CSS pra não estourar a lane.
  - **REALIDADE IMPORTANTE (calibrar expectativa):** o JSONL grava o **tool_use inteiro de uma vez** quando a chamada termina — **não** há stream char-a-char. O máximo realista é "**aparece assim que o Write/Edit é persistido**", não digitação ao vivo. Vale confirmar com o PE que isso atende ("ao vivo" = "assim que persiste").
  - Riscos: `monitor.ts` é **código de produção** (não UI); manter compat com JSONLs antigos; payload SSE grande (arquivos grandes) no watch contínuo do `/api/monitor` → truncar.

#### #9 — Activity rica: quem / o quê / onde / qual task (esforço: MEDIUM client + parte de domínio)
- **Hoje:** a linha mostra só `w` + `m` + timestamp (`ActivityFeed.tsx:14-27`). `evMsg` (`store.ts:146-154`) só inclui o WHERE (`fqidOf`) no status "dispatched"; os demais status não mostram repo/package. O `Dispatch` do client (`store.ts:9-17`) **não tipa `branch`/`worktree`**, embora eles **já venham no payload** (`JourneyDispatch` em `src/journey/types.ts:14-26` tem branch/worktree; o snapshot espalha o dispatch completo em `src/dashboard/snapshot.ts:257-258`).
- **Fazer (WHO/WHAT/WHERE — CLIENT-ONLY, medium):**
  1. Tipar `branch?`/`worktree?` no `interface Dispatch` (`store.ts`) — o `deriveDispatches` já preserva via spread, só falta o tipo.
  2. Expandir `ActivityEvent` (`store.ts:54-59`) para carregar campos **estruturados** (`repo, pkg, branch, worktree, journey, pr`) em vez de só a string `m` pronta.
  3. Mover a formatação pra `ActivityFeed.tsx` e renderizar em colunas/chips (quem | o quê | onde | journey) em **todos** os status, não só "dispatched".
  4. Atualizar `activity.view.test.tsx` + `fixtures.ts`.
- **"QUAL A TASK" — feature de DOMÍNIO, não de UI (DECISÃO ABERTA):** o brief/demanda **nunca é persistido** — comentário explícito em `src/journey/types.ts:1-3` ("the brief is never persisted"), aparentemente decisão deliberada. Exibir a task exigiria: persistir um `taskSummary` no `JourneyDispatch`/`JourneySpec`, popular no fluxo de dispatch, e expor no snapshot. **Default recomendado:** entregar WHO/WHAT/WHERE agora (client-only) e **deixar "task" como item separado** pendente de decisão do PE (mexe em schema de ledger YAML + fluxo de escrita + contraria uma decisão de design existente).

### 🆕 NOVA FEATURE — precisa do server

#### #10 — Toolbox: adicionar skills/MCPs (esforço: LARGE; o brief PERMITE manter listando)
- **Hoje:** `toolbox.view.tsx` é 100% read-only; `handler.ts`/`server.ts` só têm GET/SSE. A escrita real existe **só via CLI** (`src/toolbox/cli.ts` `runSkill`/`runMcp` + `src/toolbox/registry.ts`).
- **Para implementar "add":** (1) endpoint(s) POST no server (`POST /api/toolbox/skills`, `POST /api/toolbox/mcps`) reusando `runSkill`/`runMcp`/registry (extrair a lógica de escrita p/ uma função pura reusável por CLI e HTTP); (2) **revisão de segurança** (POST quebra o "pure GET handler"; escrita no FS via HTTP, mesmo em loopback); (3) UI de add (form/modal) em `toolbox.view.tsx` + loading/erro; (4) confirmar que o `fs.watch(.aipe)` (`server.ts:97`) cobre os arquivos escritos (skills/MCPs podem cair em `.claude/`, `.mcp.json` **fora** do `.aipe/` → snapshot não atualizaria sozinho; precisaria de watch extra ou `maybePush(true)` pós-escrita); (5) testes.
- **DECISÃO ABERTA / Default recomendado:** o item **explicitamente permite** manter só listando. Dado o custo + a invariante read-only + segurança, **recomendo NÃO implementar o add nesta rodada** e fechar como escopo futuro (documentar). Só implementar se o PE priorizar.

---

## 3. TRILHA 2 — regras & processo (NÃO iniciada)

Escopo fora do serve (skills, session-hook, dashboard). Sugiro branch `feat/rules-process`.

- **#11 — PR-após-QA + estado "in testing" + sync de merged.**
  - (a) **Codificar a regra:** o PR só abre **depois** da verificação/QA passar. Ajustar `skills/operate/SKILL.md` e `src/session-hook/awareness.ts` (hoje o dev abre o PR e o QA só chancela o "done" — **inverter**). Ao mexer em `awareness.ts`, rodar os testes de `src/session-hook`/awareness/session-start.
  - (b) Adicionar estado **"in testing"** no Pipeline/snapshot (QA em andamento).
  - (c) Pipeline refletir **merged:** fiar o `journey reconcile` (já existe, `src/journey/reconcile.ts`) + surfar `WorkerStatus "merged"` em `src/dashboard/snapshot.ts` (hoje é ledger-driven, não sincroniza GitHub, não há status "merged"). **Nota:** o client já tem o STAGE "merged" no Pipeline; o gap é o **server/snapshot** produzir esse status.

- **#12 — Adotar a metodologia de autoria de regras do superpowers como CORE do AIPe, em TODAS as skills** (`skills/*/SKILL.md`).
  - **A ideia NÃO é só `MUST`/`THEN`.** É extrair o **arsenal inteiro** que o superpowers usa para fazer o LLM seguir instrução **à risca** e transformar isso numa **convenção/meta-skill do AIPe** — porque essa "DNA de regras" define **qualidade de entrega e aderência do LLM à instrução** (é core do produto, não cosmético). Hoje o rigor está desigual entre as skills (ex.: `operate` ~17 MUST vs `context-brain`/`aipe-add-repo` 1); o objetivo é **todas** as skills escritas com o mesmo padrão rígido.
  - **O arsenal a extrair do superpowers e padronizar (não apenas os keywords — o método inteiro):**
    - **Gates rígidos** que travam a ação até a condição ser satisfeita: `<EXTREMELY-IMPORTANT>`, `<HARD-GATE>`, `<SUBAGENT-STOP>` e similares.
    - **Modais imperativos** com o *porquê* junto: `MUST` / `NEVER` / `ALWAYS` / `DO NOT`.
    - **Tabelas de racionalização / "Red Flags"** no formato `Pensamento → Realidade` ("esses pensamentos significam PARE — você está racionalizando").
    - **Fluxogramas de decisão** (dot/digraph) — o LLM segue o grafo, não prosa ambígua.
    - **Checklists que viram todos** (1 item = 1 tarefa rastreável) e **granularidade de 1-ação-por-passo**.
    - **Anti-Patterns nomeados** + **"Common Mistakes" (Problema → Correção)**.
    - **Priorização/precedência explícita** das instruções e **calibração de severidade** (Crítico vs Menor).
    - **"When to use / when NOT"** (árvore de decisão), **self-review gates**, **exemplos trabalhados**, e o **"Announce: 'Using [skill] to [purpose]'"**.
  - **Trabalho concreto (3 partes):**
    1. **Estudar/destilar** os padrões do superpowers (`~/.claude/plugins/cache/superpowers*/skills/*`) num **guia de autoria de regras do AIPe** — de preferência uma **meta-skill** (ex.: `skills/authoring-rules/SKILL.md`) que descreva o arsenal + quando usar cada device. Esse guia vira a fonte-da-verdade do "como se escreve regra no AIPe".
    2. **Reescrever/reforçar cada `skills/*/SKILL.md`** aplicando esse padrão de forma consistente (gates, red-flags, fluxos, checklists-todo, precedência) — não só polvilhar `MUST`.
    3. **Validar** (`bun test` das skills/session-hook onde houver; ao mexer em `operate`/awareness, rodar os testes de `src/session-hook`), e garantir que o **#13 (sync de skills instaladas)** propague essas versões reforçadas para os workspaces.
  - **Precedência-envelope:** o AIPe governa roteamento; process-skills (TDD/debugging/brainstorming) rodam no dev. Ao reforçar `operate`/`awareness` você mexe no cérebro do framework — cuidado e teste `src/session-hook`.

- **#13 — Mecanismo de sync de skills instaladas.** Skills instaladas num workspace ficam stale vs o repo (ex.: `operate` instalado tinha 5 MUST vs 20 no repo). Implementar um comando/fluxo (ex.: dentro de `aipe update`/rehydrate — ver `src/update/`, `src/rehydrate/`) que **re-sincroniza as skills instaladas** a partir do repo, pro coordenador nunca rodar com skill velha.

- **#10-sdd-lite — REMOVER (decisão já tomada nesta sessão).** `sdd-lite` ainda existe em `src/toolbox/registry.ts` como piso default. Agora que SDD-completo é a norma, **remover** do registry/toolbox/docs e ajustar os testes que assertam `sdd-lite`. (O registry tem 3 kits: `sdd-lite`, `spec-kit`, `pdd` — remover só o `sdd-lite`.)

---

## 4. TRILHA 3 — privacidade do workspace (#14) (NÃO iniciada)

Sugiro branch `feat/workspace-privacy`. Estado atual já correto: o `.gitignore` do workspace ignora repos internos + worktrees; persona-skills não são commitadas nos repos; o registro pré-salvo existe em `.aipe/`. **O que falta implementar no onboarding** (`src/make-workspace/` + `src/context-brain/`): ao criar um workspace, **garantir**:
- gitignore dos repos/worktrees;
- **criação do remote como PRIVATE**, publicando só `.aipe/ .claude/ .gitignore/ README` (hoje o workspace **não** cria remote private automaticamente — esse é o gap principal);
- persona-skills não commitadas nos repos;
- registro pré-salvo para reinstalar via rehydrate no re-clone.

Validar contra os testes de `src/make-workspace` (e o design em `docs/superpowers/specs/2026-07-01-make-workspace-design.md`, `2026-07-05-workspace-portability-design.md`).

---

## 5. Follow-up Minors da migração (T1.0) — PR de limpeza pós-merge (nenhum é bloqueador)
- `runtime/router.ts` `KNOWN_PATHS` é duplicata hand-synced dos paths de `routes.generated` — adicionar um teste de drift (`KNOWN_PATHS` === paths de `routes.generated`).
- `server.ts` `isCompiled()` duplicado com `cli.ts` — extrair helper compartilhado.
- `pipeline.view.tsx` — falta o separador `·` antes do link "PR ↗" no `.meta` do card (nit visual).
- `LangSwitch.tsx:9` hardcoda `id="langSeg"` → id duplicado quando Settings ativo (nada consulta `#langSeg`; todos usam `.langseg`). Remover o `id` vestigial.
- `team.view.tsx` — `Chip status={w.status || ""}` tem `|| ""` defensivo que não existia no monólito (inócuo).
- `notify.ts` — gate `!enabled` duplicado em `wireActivityNotifications` (inócuo no caminho real).
- `dom.ts` — `dkey`/`fqidOf` coalescem repo ausente pra `""` (vs `"undefined"` do monólito; self-consistent).
- `server.ts` `isLoopback()` virou export morto após remover o Terminal; `.term` CSS morto em `base.css` — limpar.

---

## 6. DECISÕES ABERTAS (pro PE) — com default recomendado p/ não travar
1. **#4 "+Dispatch":** remover o botão morto (**default: remover**) vs construir `POST /api/dispatch` (server read-only → escopo grande).
2. **#4 agrupamento "por especialidade":** fonte de dado — **default: `w.role`**; alternativa: 1ª competência do CV.
3. **#7(b) streaming de código:** aceitar "aparece assim que persiste" (limitação do JSONL, **default: sim**) — não dá char-a-char.
4. **#9 "qual task":** persistir o brief contraria `journey/types.ts` ("never persisted"). **Default: entregar WHO/WHAT/WHERE agora e deixar "task" pendente de decisão.**
5. **#10 toolbox add:** o brief permite manter listando. **Default: manter read-only** (não implementar POST agora).

---

## 7. Ordem sugerida de ataque (do mais barato/seguro ao mais caro)
1. Confirmar #1/#2/#3 no browser (ou aceitar pelos testes). [trivial]
2. **#5** ordenação org (small, client). [rápido]
3. **#6** packages em monorepo (small, client). [rápido]
4. **#9(WHO/WHAT/WHERE)** activity rica client-only (medium). [médio]
5. **#7(a)** monitor "última atividade" client-only (small). [rápido]
6. **#4** team agrupamentos (medium) + decidir "+Dispatch". [médio]
7. **Trilha 2:** #10-sdd-lite remover (rápido) → #13 sync skills → **#12 (core: destilar a metodologia de autoria de regras do superpowers numa meta-skill do AIPe e aplicar em TODAS as skills — arsenal inteiro, não só MUST)** → #11 PR-após-QA/in-testing/merged. [médio-grande, mexe em server/skills; #12 é core de qualidade/instrução]
8. **Trilha 3:** #14 privacidade do workspace (make-workspace remote PRIVATE). [médio, mexe em onboarding]
9. **#7(b)** streaming de código cross-stack (large, server). [grande — deixar por último]
10. **#10** toolbox add — só se o PE priorizar. [grande, server + segurança]
11. Fechar com o PR de limpeza dos Minors da seção 5.

Cada item: **TDD → build/test verdes → dirigir no serve real → commit/PR.**

---

## 8. Referências
- Spec T1.0: `docs/superpowers/specs/2026-07-08-serve-framework-design.md`
- Plano T1.0 (20 tasks): `docs/superpowers/plans/2026-07-08-serve-framework-migration.md`
- Ledger de execução: `.git/sdd/progress.md` (não versionado; histórico do que foi feito task a task)
- PR da fundação: https://github.com/blpsoares/aipe/pull/11
- Brief original / método: PRs focados, SDD completo, verificação no app real antes de abrir PR.
