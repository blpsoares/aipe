# Serve reforma — migração para framework (Preact) — design spec

**Date:** 2026-07-08
**Status:** Approved (PE) — foundation PR da Trilha 1 (T1.0).
**Scope:** o **cliente** do `aipe serve` apenas — reescreve o monólito
`src/serve/app.html` (1377 linhas, HTML+CSS+JS vanilla) como uma aplicação
Preact modular. **Não** toca em `src/serve/server.ts`, nas rotas SSE, nem nos
testes de server/monitor/handler (contrato preservado). Novas deps são de
**cliente** (bundladas no asset) + devDeps de teste; nenhuma dep runtime nova no
servidor (o `yaml` continua sendo a única).

Este é o PR-fundação da reforma do serve: ele **não conserta bugs de UI**
(#1–#10) — migra com **feature parity** para que cada bug seja consertado depois
"na view limpa", em seu próprio PR focado. Única mudança de comportamento
autorizada aqui: **a view Terminal é removida** (decisão do PE — não espelha a
sessão real do CLI).

---

## 1. Problem

O serve é um monólito: `src/serve/app.html` concentra `<style>` (linhas 8–431),
markup e todo o `<script>` (508–1377) num arquivo só. As views vivem num
**registro central** `const views = { overview(){…}, org(){…}, … }`; a navegação
é manual (`CUR` + `go(view)` + botões `data-view` **duplicados** entre sidebar
desktop e bottom-nav mobile); o estado (`DATA`, `dispatches`, `PREV`) é mutado à
mão com re-render manual. Consequências:

- **Não dá pra consertar uma view sem ler o arquivo inteiro** — todos os bugs
  #1–#10 são "filhos do monólito".
- **Registro central + nav duplicada** = adicionar/mudar uma view toca 3 lugares.
- **Estado imperativo** — fácil dessincronizar UI e snapshot.
- **Sem router de verdade** — a view ativa não é a URL; deep-link/F5 dependem de
  hacks (já remendados, mas frágeis).

## 2. Goals / Non-goals

**Goals:**
- Um framework real: **Preact + `@preact/signals` + `preact-iso`** (router), TSX.
- **Módulo por view** + **auto-descoberta por convenção** (elimina o registro
  central e a nav duplicada).
- **Feature parity total** com o `app.html` atual (menos Terminal).
- **Mesma portabilidade**: um binário standalone (`bun build --compile`).
- Cobertura de testes por view (paridade) + runtime puro testado.

**Non-goals (ficam para PRs posteriores):**
- Consertar #1 (overview em branco), #2 (sidebar), #4 (dispatch/team), #5
  (ordenação org), #6 (packages em monorepo), #7 (monitor + streaming de código),
  #9 (activity rica), #3 (notificações desktop), #10 (toolbox add). A T1.0 os
  **destrava**, não os resolve.
- Mudar server/SSE/handler.

## 3. Stack decision

| Escolha | Por quê |
|---|---|
| **Preact + @preact/signals** | ~5kb, JSX, reatividade fina que casa com estado vindo de SSE (snapshot/monitor → signals → UI re-renderiza sozinha). |
| **preact-iso** (router) | Router leve com suporte a rotas; a URL vira a fonte-de-verdade da view ativa (substitui `CUR`/`go()`). |
| **Bundle `Bun.build({target:"browser"})`** | O cliente é código de browser; um passo de build gera o bundle e ele é embutido como asset — Bun `--compile` mantém o binário standalone idêntico em portabilidade. |

Portabilidade não é mais argumento contra framework: o `--compile` bundla o
grafo do **servidor**; o **cliente** é bundlado à parte e embutido como texto,
exatamente como o `app.html` é hoje — só troca "1 HTML gigante" por "1 bundle de
framework".

## 4. Architecture

```
src/serve/app/
  main.tsx              # bootstrap + <Router> (preact-iso) + layout chrome
  runtime/
    store.ts            # signals: snapshot, dispatches, monitor, derived (workers/packages/counts)
    sse.ts              # conecta /api/stream + /api/monitor → store
    i18n.ts             # STR en/pt + t() reativo (signal de LANG)
    notify.ts           # som + Notification API + activity-diff
    dom.tsx             # helpers/átomos: Avatar, Chip, esc(), hue(), initials()
  routes.generated.ts   # GERADO no build por glob de views/*.view.tsx
  views/
    overview.view.tsx  org.view.tsx  pipeline.view.tsx  team.view.tsx
    toolbox.view.tsx   activity.view.tsx  monitor.view.tsx  settings.view.tsx
  components/
    Sidebar.tsx  BottomNav.tsx  Topbar.tsx  CommandPalette.tsx  OrgChart.tsx
  styles/
    tokens.css          # design tokens (cores/sombras/espaço) extraídos do <style>
    base.css            # layout/chrome/componentes compartilhados
    (cada view co-loca <name>.css)
```

**Contrato de view (convenção):** cada `*.view.tsx` exporta
```ts
export const route = {
  path: string,                 // "/", "/org", "/pipeline", …
  nav: { label: string, icon: string, order: number, badge?: "activity" },
  component: FunctionComponent,
};
```
Um passo de codegen no build faz `new Bun.Glob("views/*.view.tsx")`, importa cada
módulo e emite `routes.generated.ts` com o array de rotas ordenado por
`nav.order`. **Adicionar um arquivo `*.view.tsx` = adicionar uma view/nav-item**,
sem tocar em registro central nem duplicar nav (Sidebar e BottomNav consomem o
mesmo array gerado, filtrando por `nav`).

## 5. Data flow

```
GET /api/stream  ──▶ sse.ts ──▶ snapshot signal ──▶ derived: dispatches, workers, packages, counts
GET /api/monitor ──▶ sse.ts ──▶ monitor signal (lanes por especialista)
                                    │
                                    └─▶ notify.ts observa diff de dispatches → beep + Notification API
```
- Componentes leem `snapshot.value` / `monitor.value` direto e re-renderizam por
  reatividade — some o `setSnap()` + render manual + `CUR`.
- `preact-iso` mapeia rota→componente; URL = view ativa (melhora deep-link/F5).
- Endpoints e formato de payload **inalterados** — `server.ts` não muda.

## 6. Build integration (`scripts/build.ts` + `server.ts`)

1. **Codegen:** gera `routes.generated.ts` (glob das views).
2. **`buildClient()`:** `Bun.build({ entrypoints:["src/serve/app/main.tsx"],
   target:"browser", minify:true })` → injeta JS+CSS num shell HTML mínimo →
   escreve `src/serve/app.generated.html`.
3. **`server.ts`** importa `app.generated.html` como text asset (igual hoje) →
   `--compile` embute → **mesmo binário standalone**.
4. **Dev** (`bun src/serve/cli.ts serve`): `getAppHtml()` roda `buildClient()`
   on-the-fly com cache invalidado por mtime das fontes — edita view, F5, vê. Sem
   passo manual.
5. `app.generated.html` entra no `.gitignore` (artefato de build). O antigo
   `src/serve/app.html` é **removido** ao fim da migração.

## 7. Testing (bun test + happy-dom)

- **Views/componentes:** `@testing-library/preact` sobre happy-dom — cada view
  renderizada com um snapshot fixture, assertando os elementos-chave (1 teste por
  view = guard de "nada sumiu").
- **Runtime puro:** `store.ts` (derivações snapshot→workers/packages/counts),
  `i18n.ts` (`t()` fallback en), `notify.ts` (activity-diff) — unit, sem DOM.
- **Auto-discovery:** teste que o glob→`routes.generated.ts` lista exatamente as
  8 views (terminal ausente) e nenhuma órfã.
- **Server/monitor/handler:** intactos.

## 8. Migration & risks

- **Cliente reescrito de uma vez** (é um arquivo só), mas **view-a-view com
  paridade** — cada view atual vira um `*.view.tsx` equivalente 1:1.
- **Risco alto — OrgChart:** o SVG com pan/zoom/fullscreen/filtro/a11y (entregue
  recentemente) é a parte mais densa. Mitigação: `<OrgChart>` encapsula a geração
  de SVG atual quase 1:1 (mesma matemática de layout, movida para dentro de um
  componente com refs para os handlers de Pointer Events), sem regredir a
  interação.
- **Risco — i18n:** as tabelas `STR.en`/`STR.pt` migram verbatim para `i18n.ts`;
  teste de fallback garante paridade de chaves.
- **Risco — paridade visual:** tokens e CSS base extraídos do `<style>` atual
  verbatim; diff visual conferido dirigindo o serve real antes do PR.

## 9. Verification (antes de abrir o PR)

- `bun test` + `bunx tsc --noEmit` verdes.
- `bun run scripts/build.ts host` gera binário; `aipe serve` sobe.
- Dirigir no app real: cada uma das 8 views abre, i18n troca en/pt, tema troca,
  command palette ⌘K, org-chart pan/zoom/fullscreen/filtro, mobile bottom-nav,
  SSE live (snapshot + monitor), notificações de teste — **paridade confirmada**;
  Terminal ausente.
