# Serve Framework Migration (T1.0) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reescrever o monólito `src/serve/app.html` (1377 linhas, vanilla) como uma aplicação Preact modular com router de verdade e auto-descoberta de views por convenção, preservando 100% do comportamento atual (feature parity) — exceto a view Terminal, que é removida.

**Architecture:** Preact + `@preact/signals` (estado reativo alimentado por SSE) + `preact-iso` (router). O cliente é código de browser bundlado por `Bun.build({target:"browser"})` e injetado num shell HTML; o resultado é embutido no binário via `import ... with {type:"text"}` (mesma portabilidade standalone de hoje). Em dev, o bundle é gerado on-the-fly com cache por mtime. Views vivem em `views/*.view.tsx` exportando um contrato `route`; um codegen com `Bun.Glob` gera `routes.generated.ts` (elimina o registro central `const views={}` e a nav duplicada).

**Tech Stack:** TypeScript (strict), Bun, Preact, @preact/signals, preact-iso, happy-dom + @testing-library/preact (testes), Bun.build (bundling).

## Global Constraints

- **Feature parity é requisito.** Nenhuma view/interface/comportamento atual pode sumir, exceto Terminal (removido). Bugs atuais (#1–#10) são preservados como estão — este PR **não** os conserta; ele destrava conserto futuro. Onde a migração naturalmente muda comportamento (ex.: JSX escapa tudo, enquanto o monólito escapava só alguns campos), **documentar como desvio intencional** no PR, não silenciar.
- **Server intocado.** `src/serve/server.ts` (rotas SSE `/api/stream`, `/api/monitor`, snapshot), `handler.ts`, `monitor.ts` e seus testes NÃO mudam de comportamento. Exceções cirúrgicas permitidas e explícitas: (a) `getAppHtml()` dual-mode substitui o `import app.html` em `server.ts`; (b) `handler.ts` passa a resolver o HTML de forma async; (c) remoção do endpoint `/api/terminal` + `terminal.ts` + `terminal.test.ts` (parte da remoção da feature Terminal).
- **Zero deps runtime novas no servidor.** `yaml` continua sendo a única dep runtime do servidor. Preact/signals/preact-iso são deps de **cliente** (bundladas no asset, não resolvidas em runtime pelo servidor); happy-dom/@testing-library/preact são **devDependencies**.
- **Idioma:** código/identificadores em inglês; commits em português (Conventional Commits: `feat`/`test`/`refactor`/`chore`). Rodapé de commit conforme convenção do repo.
- **Endpoints SSE do cliente:** `EventSource("api/stream")` (evento nomeado `snapshot`), `EventSource("api/monitor")` (evento nomeado `monitor`), boot via `fetch("api/snapshot", {cache:"no-store"})` — paths relativos, preservar exatamente.
- **i18n:** só a UI chrome é traduzida (en/pt); nomes de worker/repo/branch/PR/logs NUNCA passam por `t()`. `STR.en` e `STR.pt` têm o MESMO conjunto de chaves.
- **Nav order (paridade):** overview(0), org(1), pipeline(2), team/workers(3), toolbox(4), activity(5), monitor(6), settings(rodapé). Ícones: ◎ ◈ ▦ ◑ ⬡ ⧗ ◉ ⚙. Bottom-nav mobile lista só: overview, pipeline, workers, activity, monitor (sem org/toolbox/settings/terminal).
- **Comando de teste:** `bun test`. Typecheck: `bunx tsc --noEmit -p tsconfig.json`. Build binário: `bun run scripts/build.ts host`.

---

## File Structure

```
src/serve/
  app/
    main.tsx                 # bootstrap: <App/> com preact-iso Router + chrome + overlays
    shell.html               # template HTML mínimo com <!--CLIENT-CSS--> e <!--CLIENT-JS-->
    routes.generated.ts      # GERADO (Bun.Glob de views/*.view.tsx) — no .gitignore
    runtime/
      i18n.ts                # STR en/pt, lang signal, t(), stt(), setLang(), interpolate()
      store.ts               # signals (snapshot/dispatches/counts/activity/conn) + derivações puras
      sse.ts                 # connectSSE(), fetchInitialSnapshot()
      notify.ts              # NOTIF signal, beep(), notify(), wireActivityNotifications()
      monitor-store.ts       # MON state (signals) + reducer monPush + selectors
      dom.ts                 # esc, hue, initials, fqid, fqidOf, dkey helpers puros
    components/
      Avatar.tsx  Chip.tsx  Button.tsx  ConnBadge.tsx  Icon.tsx
      Sidebar.tsx  BottomNav.tsx  Topbar.tsx  LangSwitch.tsx  ThemeToggle.tsx
      CommandPalette.tsx  WorkerDrawer.tsx
      ActivityFeed.tsx  CompChips.tsx  UnitFacts.tsx
      OrgChart.tsx  OrgTree.tsx  OrgLegend.tsx
    views/
      overview.view.tsx  org.view.tsx  pipeline.view.tsx  team.view.tsx
      toolbox.view.tsx   activity.view.tsx  monitor.view.tsx  settings.view.tsx
    styles/
      tokens.css  base.css   # design tokens + chrome/layout compartilhado (extraídos de app.html:8-431)
      (cada view/componente co-loca <name>.css importado no .tsx)
    build-client.ts          # buildClient(): Bun.build browser → shell → HTML string; genRoutes()
    __tests__/               # testes de runtime, componentes e views
  server.ts                  # MODIFICADO: getAppHtml() dual-mode no lugar do import app.html
  handler.ts                 # MODIFICADO: resolve HTML async
  app.html                   # REMOVIDO ao final
  terminal.ts                # REMOVIDO (feature Terminal)
scripts/build.ts             # MODIFICADO: passo genRoutes() + buildClient() antes do --compile
```

---

## Task 1: Dependências, JSX e setup de testes

**Files:**
- Modify: `package.json` (deps + devDeps)
- Modify: `tsconfig.json` (JSX Preact)
- Create: `src/serve/app/__tests__/setup.ts` (preload happy-dom)
- Modify: `bunfig.toml` (criar se não existir — preload de teste)

**Interfaces:**
- Produces: ambiente onde `.tsx` Preact compila e testes rodam com DOM (happy-dom).

- [ ] **Step 1: Instalar dependências**

```bash
cd /home/mithrandir/aipe
bun add preact @preact/signals preact-iso
bun add -d @testing-library/preact happy-dom @testing-library/jest-dom
```

- [ ] **Step 2: Configurar JSX no tsconfig**

Editar `tsconfig.json` → `compilerOptions`, adicionar:

```json
"jsx": "react-jsx",
"jsxImportSource": "preact",
"lib": ["ESNext", "DOM", "DOM.Iterable"]
```

- [ ] **Step 3: Setup de testes com happy-dom**

Criar `src/serve/app/__tests__/setup.ts`:

```ts
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register();
```

Se `@happy-dom/global-registrator` não vier junto, usar o preload nativo do bun test com happy-dom. Criar/editar `bunfig.toml` na raiz:

```toml
[test]
preload = ["./src/serve/app/__tests__/setup.ts"]
```

- [ ] **Step 4: Teste-fumaça de que JSX + DOM funcionam**

Criar `src/serve/app/__tests__/smoke.test.tsx`:

```tsx
import { test, expect } from "bun:test";
import { render } from "@testing-library/preact";

function Hello({ name }: { name: string }) {
  return <div>Hello {name}</div>;
}

test("preact renders in happy-dom", () => {
  const { getByText } = render(<Hello name="AIPe" />);
  expect(getByText("Hello AIPe")).toBeTruthy();
});
```

- [ ] **Step 5: Rodar e verificar verde**

Run: `bun test src/serve/app/__tests__/smoke.test.tsx`
Expected: PASS (1 test). Se falhar por registro de DOM, ajustar `setup.ts` conforme a API do happy-dom instalado (`GlobalRegistrator.register()`), e reconfirmar.

Run: `bunx tsc --noEmit -p tsconfig.json`
Expected: sem erros.

- [ ] **Step 6: Commit**

```bash
git add package.json bun.lock tsconfig.json bunfig.toml src/serve/app/__tests__/
git commit -m "chore(serve): adiciona Preact/signals/preact-iso + happy-dom para a migração do serve"
```

---

## Task 2: Build integration — walking skeleton (GET / serve um bundle Preact)

Esta é a tarefa de maior risco: provar o pipeline ponta-a-ponta com um app mínimo antes de portar qualquer view. Ao final, `bun src/serve/cli.ts serve` e o binário compilado servem um "hello" Preact real.

**Files:**
- Create: `src/serve/app/shell.html`
- Create: `src/serve/app/main.tsx` (mínimo, temporário)
- Create: `src/serve/app/build-client.ts`
- Modify: `src/serve/server.ts` (linhas 11, 31, ~169 — `getAppHtml()`)
- Modify: `src/serve/handler.ts` (HTML async)
- Modify: `scripts/build.ts` (chamar genRoutes + buildClient antes do compile)
- Modify: `.gitignore`
- Test: `src/serve/app/__tests__/build-client.test.ts`, `src/serve/__tests__/handler.test.ts` (ajuste)

**Interfaces:**
- Produces:
  - `buildClient(opts?: { minify?: boolean }): Promise<string>` — retorna o HTML completo (shell + JS/CSS inline do bundle).
  - `getAppHtml(): Promise<string>` (em `server.ts`) — compilado: retorna asset pré-embutido; dev: `buildClient()` com cache por mtime.
  - shell placeholders: `<!--CLIENT-CSS-->` e `<!--CLIENT-JS-->`.

- [ ] **Step 1: Escrever o teste de buildClient**

Criar `src/serve/app/__tests__/build-client.test.ts`:

```ts
import { test, expect } from "bun:test";
import { buildClient } from "../build-client";

test("buildClient produz um HTML com o bundle JS inline", async () => {
  const html = await buildClient({ minify: false });
  expect(html).toContain("<!doctype html>");
  expect(html).toContain("<div id=\"app\">"); // mount point
  expect(html).not.toContain("<!--CLIENT-JS-->"); // placeholder foi substituído
  expect(html).toMatch(/<script[^>]*>[\s\S]*<\/script>/); // JS inline presente
});
```

- [ ] **Step 2: Rodar — deve falhar (módulo inexistente)**

Run: `bun test src/serve/app/__tests__/build-client.test.ts`
Expected: FAIL ("Cannot find module '../build-client'").

- [ ] **Step 3: Criar o shell HTML**

Criar `src/serve/app/shell.html`:

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<title>AIPe</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='8' fill='%2310b981'/%3E%3Ctext x='16' y='22' font-size='17' font-family='monospace' font-weight='700' fill='white' text-anchor='middle'%3EA%3C/text%3E%3C/svg%3E" />
<style>/*<!--CLIENT-CSS-->*/</style>
</head>
<body>
<div id="app"></div>
<script type="module"><!--CLIENT-JS--></script>
</body>
</html>
```

- [ ] **Step 4: main.tsx mínimo (temporário)**

Criar `src/serve/app/main.tsx`:

```tsx
import { render } from "preact";

function App() {
  return <div>AIPe console — framework skeleton OK</div>;
}

render(<App />, document.getElementById("app")!);
```

- [ ] **Step 5: Implementar build-client.ts**

Criar `src/serve/app/build-client.ts`:

```ts
import shell from "./shell.html" with { type: "text" };

const ENTRY = new URL("./main.tsx", import.meta.url).pathname;

export async function buildClient(opts: { minify?: boolean } = {}): Promise<string> {
  const result = await Bun.build({
    entrypoints: [ENTRY],
    target: "browser",
    minify: opts.minify ?? true,
    // CSS importado nos .tsx sai como outputs separados (kind: "asset")
  });
  if (!result.success) {
    throw new AggregateError(result.logs, "buildClient failed");
  }
  let js = "";
  let css = "";
  for (const out of result.outputs) {
    if (out.kind === "entry-point" || out.kind === "chunk") js += await out.text();
    else if (out.path.endsWith(".css")) css += await out.text();
  }
  return (shell as unknown as string)
    .replace("/*<!--CLIENT-CSS-->*/", css)
    .replace("<!--CLIENT-JS-->", js);
}
```

- [ ] **Step 6: Rodar — deve passar**

Run: `bun test src/serve/app/__tests__/build-client.test.ts`
Expected: PASS.

- [ ] **Step 7: getAppHtml() dual-mode em server.ts**

Em `src/serve/server.ts`: remover `import appAsset from "./app.html" with { type: "text" }` (linha 11) e o cast (linha 31). Adicionar (import de `stat` no topo):

```ts
import { stat } from "node:fs/promises";
import { buildClient } from "./app/build-client";

// Compilado: bundle pré-buildado embutido. Dev: rebuild on-the-fly com cache por mtime.
let PREBUILT: string | null = null;
try {
  // Só existe no binário compilado (gerado por scripts/build.ts antes do --compile).
  // @ts-expect-error - asset gerado, ausente em dev
  PREBUILT = (await import("./app/app.generated.html", { with: { type: "text" } })).default;
} catch { PREBUILT = null; }

let devCache: { html: string; key: number } | null = null;
function isCompiled(): boolean {
  const p = Bun.main || process.argv[1] || "";
  return p.startsWith("/$bunfs/") || p.startsWith("~BUN") || p.startsWith("B:\\");
}

export async function getAppHtml(): Promise<string> {
  if (isCompiled() && PREBUILT) return PREBUILT;
  const entry = new URL("./app/main.tsx", import.meta.url).pathname;
  const key = (await stat(entry)).mtimeMs;
  if (!devCache || devCache.key !== key) {
    devCache = { html: await buildClient({ minify: false }), key };
  }
  return devCache.html;
}
```

Nota: o cache por mtime do `main.tsx` é um piso; para invalidar em qualquer arquivo do grafo, na prática o dev reinicia raramente — se precisar granularidade, trocar `key` por um hash do glob de `views/`/`components/`. Manter simples nesta task.

Substituir no `startServer`/handler wiring (server.ts ~169) a passagem de `html: app` por `getHtml: getAppHtml` (ver Step 8).

- [ ] **Step 8: handler.ts resolve HTML async**

Em `src/serve/handler.ts`, trocar o contrato `ctx.html: string` por `ctx.getHtml: () => Promise<string>` e o retorno de `/`:

```ts
if (url.pathname === "/" || url.pathname === "/index.html") {
  return new Response(await ctx.getHtml(), {
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}
```

Ajustar o tipo do `ctx` e o call site em `server.ts` (`return handleRequest(req, { workspace, getHtml: getAppHtml })`).

- [ ] **Step 9: Ajustar handler.test.ts**

Em `src/serve/__tests__/handler.test.ts`, onde hoje passa `{ html: "..." }`, passar `{ getHtml: async () => "<!doctype html>..." }` e `await` no assert do corpo. Manter as asserções de content-type/cache-control.

- [ ] **Step 10: genRoutes() + integração no build**

Em `src/serve/app/build-client.ts`, adicionar:

```ts
import { Glob } from "bun";

export async function genRoutes(): Promise<void> {
  const viewsDir = new URL("./views/", import.meta.url).pathname;
  const glob = new Glob("*.view.tsx");
  const files: string[] = [];
  for await (const f of glob.scan(viewsDir)) files.push(f);
  files.sort();
  const imports = files
    .map((f, i) => `import { route as r${i} } from "./views/${f.replace(/\.tsx$/, "")}";`)
    .join("\n");
  const arr = files.map((_, i) => `r${i}`).join(", ");
  const body = `// AUTO-GERADO por genRoutes() — não editar.\n${imports}\nexport const routes = [${arr}].sort((a,b)=>a.nav.order-b.nav.order);\n`;
  await Bun.write(new URL("./routes.generated.ts", import.meta.url).pathname, body);
}
```

Em `scripts/build.ts`, antes do loop de `buildOne`, chamar o pipeline client e escrever o asset embutível:

```ts
import { buildClient, genRoutes } from "../src/serve/app/build-client";
// ...dentro de main(), antes de compilar os targets:
await genRoutes();
const html = await buildClient({ minify: true });
await Bun.write(join(ROOT, "src", "serve", "app", "app.generated.html"), html);
```

(O `import ... app.generated.html` em server.ts será resolvido pelo `--compile` a partir desse arquivo.)

- [ ] **Step 11: .gitignore dos artefatos gerados**

Adicionar a `.gitignore`:

```
src/serve/app/app.generated.html
src/serve/app/routes.generated.ts
```

- [ ] **Step 12: Verificar dev e compilado servindo o skeleton**

```bash
bun test src/serve/
bunx tsc --noEmit -p tsconfig.json
# genRoutes precisa de ao menos 1 view; criar um stub temporário se o glob estiver vazio,
# OU tornar genRoutes tolerante a zero arquivos (routes=[]). Preferir tolerante.
```

Subir dev e conferir GET /:

```bash
bun src/serve/cli.ts serve --port 7799 &
sleep 1 && curl -s localhost:7799/ | grep -c "framework skeleton OK"
kill %1
```
Expected: `1` (o app Preact montou e o texto veio no bundle).

- [ ] **Step 13: Commit**

```bash
git add -A
git commit -m "feat(serve): pipeline de build do cliente Preact (buildClient/getAppHtml dual-mode + genRoutes)"
```

---

## Task 3: runtime/i18n.ts

**Files:**
- Create: `src/serve/app/runtime/i18n.ts`
- Test: `src/serve/app/__tests__/i18n.test.ts`

**Interfaces:**
- Consumes: `@preact/signals` (`signal`).
- Produces:
  - `type Lang = "en" | "pt"`
  - `lang: Signal<Lang>`
  - `t(k: string): string` — fallback `STR[lang.value]?.[k] ?? STR.en[k] ?? k`
  - `stt(st: string): string` = `t("st_"+st) || st`
  - `setLang(l: Lang): void` — seta `lang.value` + persiste em `localStorage["aipe-lang"]`
  - `interpolate(str: string, vars: Record<string,string|number>): string` — substitui `{key}`
  - `STR: Record<Lang, Record<string,string>>`

- [ ] **Step 1: Escrever os testes de paridade i18n**

Criar `src/serve/app/__tests__/i18n.test.ts`:

```ts
import { test, expect, beforeEach } from "bun:test";
import { t, stt, setLang, lang, interpolate, STR } from "../runtime/i18n";

beforeEach(() => { lang.value = "en"; });

test("t() resolve en e pt", () => {
  expect(t("nav_overview")).toBe("Overview");
  setLang("pt");
  expect(t("nav_overview")).toBe("Visão geral");
});

test("t() cai no fallback en para idioma não suportado", () => {
  // @ts-expect-error forçar valor inválido
  lang.value = "fr";
  expect(t("nav_overview")).toBe("Overview");
});

test("t() retorna a própria chave se ausente em ambos", () => {
  expect(t("__missing__")).toBe("__missing__");
});

test("stt() prefixa st_ e traduz status", () => {
  expect(stt("active")).toBe("active");
  setLang("pt");
  expect(stt("active")).toBe("ativo");
});

test("STR.en e STR.pt têm exatamente as mesmas chaves", () => {
  const en = Object.keys(STR.en).sort();
  const pt = Object.keys(STR.pt).sort();
  expect(pt).toEqual(en);
});

test("interpolate substitui placeholders", () => {
  expect(interpolate("{n} escalation needs you", { n: 2 })).toBe("2 escalation needs you");
});

test("rel_now existe em ambos os idiomas (migrado de reltime hardcoded)", () => {
  expect(STR.en.rel_now).toBe("now");
  expect(STR.pt.rel_now).toBe("agora");
});
```

- [ ] **Step 2: Rodar — falha (módulo inexistente)**

Run: `bun test src/serve/app/__tests__/i18n.test.ts` → FAIL.

- [ ] **Step 3: Implementar i18n.ts**

Portar `STR` de `app.html:519-592` VERBATIM (todas as ~130 chaves en/pt), **adicionando** a chave nova `rel_now` (`en:"now"`, `pt:"agora"`) usada pelo `reltime` migrado. Remover as chaves `nav_terminal`, `c_openterm`, `term_*` (Terminal removido). Implementar:

```ts
import { signal, type Signal } from "@preact/signals";

export type Lang = "en" | "pt";

export const STR: Record<Lang, Record<string, string>> = {
  en: { /* ...portar app.html:521-555, +rel_now:"now", -nav_terminal/-term_*/-c_openterm... */ },
  pt: { /* ...portar app.html:557-591, +rel_now:"agora", ... */ },
};

const stored = (typeof localStorage !== "undefined" && localStorage.getItem("aipe-lang")) as Lang | null;
export const lang: Signal<Lang> = signal(stored === "pt" || stored === "en" ? stored : "en");

export function t(k: string): string {
  return STR[lang.value]?.[k] ?? STR.en[k] ?? k;
}
export function stt(st: string): string {
  return t("st_" + st) || st;
}
export function setLang(l: Lang): void {
  lang.value = l;
  try { localStorage.setItem("aipe-lang", l); } catch {}
}
export function interpolate(str: string, vars: Record<string, string | number>): string {
  return str.replace(/\{(\w+)\}/g, (_, k) => (k in vars ? String(vars[k]) : `{${k}}`));
}
```

- [ ] **Step 4: Rodar — passa**

Run: `bun test src/serve/app/__tests__/i18n.test.ts` → PASS. Se "STR.en e STR.pt têm as mesmas chaves" falhar, alinhar chaves faltantes (é o guard exato que pega omissões na portabilidade).

- [ ] **Step 5: Commit**

```bash
git add src/serve/app/runtime/i18n.ts src/serve/app/__tests__/i18n.test.ts
git commit -m "feat(serve): runtime i18n (STR en/pt + lang signal + t/stt/setLang) com paridade de chaves"
```

---

## Task 4: runtime/dom.ts + store.ts (derivações puras)

**Files:**
- Create: `src/serve/app/runtime/dom.ts`
- Create: `src/serve/app/runtime/store.ts`
- Test: `src/serve/app/__tests__/store.test.ts`

**Interfaces:**
- `dom.ts` (helpers puros portados de app.html:512-514, 608, 610, 708):
  - `esc(s: unknown): string` (app.html:512) — nota: nos componentes JSX o escape é automático; `esc` fica disponível para casos de string crua/SVG.
  - `hue(n: string): number` (514), `initials(n: string): string` (513)
  - `fqid(w): string` (708), `fqidOf(d): string` (610), `dkey(d): string` (608)
- `store.ts`:
  - Signals: `snapshot` (objeto normalizado equiv. a `DATA`), `dispatches: Signal<Dispatch[]>`, `counts: Signal<Counts>`, `activity: Signal<ActivityEvent[]>`, `conn: Signal<"wait"|"live"|"down">`, `brandCtx` (computed do nome do contexto).
  - Funções puras (testáveis sem DOM): `deriveRepos(s)`, `deriveWorkers(s)`, `deriveToolbox(s)`, `deriveCounts(s)`, `evMsg(d, t)`, `diffActivity(prevMap, curDispatches, now, t): { activity, changed }`.
  - `applySnapshot(raw, now)` — atualiza signals, roda diff, retorna `changed` (para o notify wire). NÃO dispara notificação nem toca DOM.

- [ ] **Step 1: Escrever testes (portar parityTests do brief runtime-store-sse)**

Criar `src/serve/app/__tests__/store.test.ts` cobrindo (asserções concretas do brief):

```ts
import { test, expect } from "bun:test";
import { deriveWorkers, deriveRepos, deriveCounts, evMsg, diffActivity } from "../runtime/store";
import { fqidOf, dkey } from "../runtime/dom";

const idT = (k: string) => k; // t() identidade para testes de evMsg

test("deriveWorkers exclui coordinator", () => {
  const s = { workers: [{ name: "C", role: "coordinator" }, { name: "A", role: "dev" }, { name: "B", role: "qa" }] };
  const w = deriveWorkers(s);
  expect(w.map(x => x.name)).toEqual(["A", "B"]);
});

test("deriveRepos monta packages não-implicit e group undefined quando igual", () => {
  const s = {
    repos: ["app"],
    repoInfos: [{ name: "app", stack: ["ts"], kind: "service" }],
    packages: [
      { repo: "app", package: "core", implicit: false, stack: ["ts"], kind: "lib", group: "core" },
      { repo: "app", package: "gen", implicit: true, stack: [], kind: "" },
    ],
  };
  const r = deriveRepos(s);
  expect(r).toEqual([{ name: "app", stack: ["ts"], kind: "service", packages: [{ name: "core", stack: ["ts"], kind: "lib", group: undefined }] }]);
});

test("deriveCounts renomeia available→idle e conta journeys/repos", () => {
  const s = { counts: { hired: 5, active: 3, delivered: 2, escalated: 1, available: 4 }, journeys: [{}, {}], repos: ["a", "b", "c"] };
  expect(deriveCounts(s)).toEqual({ hired: 5, active: 3, delivered: 2, escalated: 1, idle: 4, journeys: 2, repos: 3 });
});

test("fqidOf e dkey", () => {
  expect(fqidOf({ repo: "app", package: "core" })).toBe("app/core");
  expect(fqidOf({ repo: "app" })).toBe("app");
  expect(dkey({ repo: "app", package: "core", specialist: "Ana" })).toBe("app/core::ana");
});

test("evMsg formata por status", () => {
  expect(evMsg({ status: "dispatched", repo: "app", package: "core", journey: "j1" }, idT)).toContain("dispatched to app/core");
  expect(evMsg({ status: "paused", journey: "j1" }, idT)).toContain("paused");
});

test("diffActivity: primeiro snapshot popula em ordem reversa sem 'changed'", () => {
  const cur = [{ repo: "a", specialist: "X", status: "dispatched", journey: "j" }];
  const r = diffActivity(null, cur, 1000, idT);
  expect(r.activity.length).toBe(1);
  expect(r.changed.length).toBe(0);
});

test("diffActivity: mudança de status gera changed", () => {
  const prev = new Map([[dkey({ repo: "a", specialist: "X" }), { status: "dispatched", pr: undefined }]]);
  const cur = [{ repo: "a", specialist: "X", status: "delivered", journey: "j" }];
  const r = diffActivity(prev, cur, 2000, idT);
  expect(r.changed.length).toBe(1);
  expect(r.changed[0].status).toBe("delivered");
});
```

- [ ] **Step 2: Rodar — falha**

Run: `bun test src/serve/app/__tests__/store.test.ts` → FAIL.

- [ ] **Step 3: Implementar dom.ts e store.ts**

Portar 1:1 de `app.html` — `esc/hue/initials` (512-514), `fqid/fqidOf/dkey` (608/610/708), `deriveRepos/Workers/Toolbox/Counts` (615-629), `evMsg` (639-647), `diffActivity` (648-665, extrair a lógica pura recebendo `prevMap`/`now`/`t` em vez de globais; **manter o cap de 60** e a regra `!p || p.status!==d.status || p.pr!==d.pr`). Definir tipos `Dispatch`, `Worker`, `Repo`, `Counts`, `ActivityEvent`. `applySnapshot(raw, now)` seta os signals e usa um `prevMap` module-level (equivalente ao `PREV`).

- [ ] **Step 4: Rodar — passa**

Run: `bun test src/serve/app/__tests__/store.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/serve/app/runtime/dom.ts src/serve/app/runtime/store.ts src/serve/app/__tests__/store.test.ts
git commit -m "feat(serve): runtime store (signals + derivações puras snapshot→workers/counts/activity)"
```

---

## Task 5: runtime/sse.ts

**Files:**
- Create: `src/serve/app/runtime/sse.ts`
- Test: `src/serve/app/__tests__/sse.test.ts`

**Interfaces:**
- Consumes: `applySnapshot` (store), `conn` (store).
- Produces:
  - `fetchInitialSnapshot(): Promise<unknown|null>` — `fetch("api/snapshot",{cache:"no-store"})`, catch silencioso → null.
  - `connectSnapshotStream(onSnapshot, onStatus): EventSource` — `EventSource("api/stream")`, listener nomeado `snapshot`, `onopen→"live"`, `onerror` só seta `down` se `readyState===2`.
  - `bootstrap()` — orquestra fetch inicial + applySnapshot + connect (substitui `boot()`).

- [ ] **Step 1: Teste com EventSource/fetch fake**

Criar `src/serve/app/__tests__/sse.test.ts` — injetar um `EventSource`/`fetch` fake via parâmetro ou global stub, e assertar: (a) evento nomeado `snapshot` com JSON válido chama `onSnapshot` com o objeto; (b) `message` genérico NÃO chama; (c) `onopen` → status `live`; (d) `onerror` com `readyState===2` → `down`, com outro readyState → não muda. Escrever a função `connectSnapshotStream` recebendo um construtor `ES` injetável (default `globalThis.EventSource`) para testabilidade.

```ts
import { test, expect } from "bun:test";
import { connectSnapshotStream } from "../runtime/sse";

class FakeES {
  onopen: any; onerror: any; readyState = 1;
  listeners: Record<string, (m: any) => void> = {};
  constructor(public url: string) {}
  addEventListener(ev: string, fn: (m: any) => void) { this.listeners[ev] = fn; }
  emit(ev: string, data: string) { this.listeners[ev]?.({ data }); }
}

test("evento snapshot dispara onSnapshot; message não", () => {
  let got: any = null; let status = "";
  const es = connectSnapshotStream((s) => (got = s), (st) => (status = st), FakeES as any) as unknown as FakeES;
  es.onopen();
  expect(status).toBe("live");
  es.emit("snapshot", JSON.stringify({ ok: true }));
  expect(got).toEqual({ ok: true });
  es.emit("message", JSON.stringify({ ok: false }));
  expect(got).toEqual({ ok: true }); // inalterado
});

test("onerror só marca down em readyState CLOSED(2)", () => {
  let status = "live";
  const es = connectSnapshotStream(() => {}, (st) => (status = st), FakeES as any) as unknown as FakeES;
  es.readyState = 0; es.onerror();
  expect(status).toBe("live");
  es.readyState = 2; es.onerror();
  expect(status).toBe("down");
});
```

- [ ] **Step 2: Rodar — falha.** `bun test src/serve/app/__tests__/sse.test.ts` → FAIL.

- [ ] **Step 3: Implementar sse.ts** (portar `connectSSE`/`boot` de app.html:1292-1316, com `ES` injetável e paths `api/stream`/`api/snapshot`).

- [ ] **Step 4: Rodar — passa.** → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/serve/app/runtime/sse.ts src/serve/app/__tests__/sse.test.ts
git commit -m "feat(serve): runtime sse (connectSnapshotStream + fetchInitialSnapshot + bootstrap)"
```

---

## Task 6: runtime/notify.ts

**Files:**
- Create: `src/serve/app/runtime/notify.ts`
- Test: `src/serve/app/__tests__/notify.test.ts`

**Interfaces:**
- Produces:
  - `NOTIF: Signal<{enabled,desktop,sound,ev:{dispatch,delivered,escalated,merged}}>` — carregado/persistido em `localStorage["aipe-notif"]`.
  - `saveNotif()`, `notify(kind, title, body)` (beep via Web Audio + Notification API — portar app.html:681-703), `beep(kind)`.
  - `wireActivityNotifications()` — liga um `effect`/callback que, dado `changed` de `applySnapshot`, dispara `notify` conforme `NOTIF.ev` (mapa `dispatched→dispatch` etc, app.html:658-659).

- [ ] **Step 1: Testes** — `NOTIF` default (app.html:682), toggle+persist (`saveNotif`), e o mapeamento status→chave de evento em `wireActivityNotifications` (usar um `notify` fake injetável para assertar que status `escalated` com `NOTIF.ev.escalated=true` chama, e com `false` não chama; status `removed` nunca chama). Web Audio/Notification são efeitos de browser — testar só a lógica de decisão, injetando o `notify`.

- [ ] **Step 2: Rodar — falha.**

- [ ] **Step 3: Implementar notify.ts** (portar 676-703 + a decisão do diff 658-659; `beep`/`notify` guardam `typeof window`/`"Notification" in window`).

- [ ] **Step 4: Rodar — passa.**

- [ ] **Step 5: Commit**

```bash
git add src/serve/app/runtime/notify.ts src/serve/app/__tests__/notify.test.ts
git commit -m "feat(serve): runtime notify (som + Notification API + wire de activity-diff)"
```

---

## Task 7: Componentes átomos compartilhados

**Files:**
- Create: `src/serve/app/components/{Avatar,Chip,Button,ConnBadge,Icon}.tsx`
- Create: `src/serve/app/components/ActivityFeed.tsx`, `CompChips.tsx`
- Create: `src/serve/app/styles/tokens.css`, `src/serve/app/styles/base.css`
- Test: `src/serve/app/__tests__/atoms.test.tsx`

**Interfaces:**
- `<Avatar name />` (app.html:707), `<Chip status />` (706, usa `stt`), `<Button variant="primary"|"ghost" />`, `<ConnBadge />` (lê `conn` signal; texto `t("live")`/`t("conn_wait")`/`t("conn_down")`, classes `.conn`/`.conn.wait`/`.conn.down`, app.html:1280-1285), `<Icon glyph />`.
- `<ActivityFeed events />` → `<EventRow event />` (equiv. `evHTML` app.html:841, com `DOTCLS` 839 e `reltime` 840 usando `t("rel_now")`).
- `<CompChips list max? />` (app.html:895-896).

- [ ] **Step 1: Testes de átomos** — `Avatar` mostra iniciais; `Chip` mostra `stt(status)` e classe do status; `EventRow` com status desconhecido cai em `d-active`, com `e.at` usa reltime, escapa `e.w`/`e.m` (JSX faz isso — assertar que `<script>` vira texto); `CompChips` com >max renderiza max + `+N`, vazio → `t("none")`; `ConnBadge` reflete o signal `conn`.

- [ ] **Step 2: Rodar — falha.**

- [ ] **Step 3: Implementar componentes + extrair CSS.** Portar as classes de `app.html:8-431` para `tokens.css` (custom properties: `--sky`,`--accent`,`--amber`,`--slate`,`--line`,`--panel`,`--ink*`,`--radius*`,`--shadow*`,`--mono`, temas `:root`/`[data-theme=dark]`/`[data-theme=light]`) e `base.css` (`.view-in`,`.grid`,`.card`,`.between`,`.eyebrow`,`.btn*`,`.chip*`,`.avatar`,`.conn*`,`.feed`,`.ev*`,`.d-*`,`.kpi*`,`.tag`,`.sub`,`.view-h`,`.langseg`,`.sw`,`.srow` etc). Importar `tokens.css`+`base.css` em `main.tsx`. `reltime` vai em `dom.ts` ou num util, usando `t("rel_now")`.

- [ ] **Step 4: Rodar — passa.**

- [ ] **Step 5: Commit**

```bash
git add src/serve/app/components/ src/serve/app/styles/ src/serve/app/__tests__/atoms.test.tsx
git commit -m "feat(serve): átomos compartilhados (Avatar/Chip/Button/ConnBadge/ActivityFeed/CompChips) + tokens/base css"
```

---

## Task 8: Chrome + Router (main.tsx, Sidebar, BottomNav, Topbar, LangSwitch, ThemeToggle)

**Files:**
- Modify: `src/serve/app/main.tsx` (App real com preact-iso)
- Create: `src/serve/app/components/{Sidebar,BottomNav,Topbar,LangSwitch,ThemeToggle}.tsx`
- Create: 8 stubs de view (para o glob/routes funcionar) — cada `views/*.view.tsx` exporta `route` com um `component` placeholder `() => <div>{t("nav_x")}</div>`. Serão preenchidas nas tasks 11-18.
- Test: `src/serve/app/__tests__/chrome.test.tsx`

**Interfaces:**
- Consumes: `routes.generated.ts` (`routes`), `lang`/`setLang`, `conn`.
- Produces: `<App />` montando `<Router>` (preact-iso `LocationProvider`+`Router`+`Route`), `<Sidebar>`/`<BottomNav>` gerados a partir de `routes` filtrando por `nav`, `<Topbar>` com título (rota ativa), `<ConnBadge>`, `<LangSwitch>`, `<ThemeToggle>`, `<CommandPalette>` e `<WorkerDrawer>` (montados no shell, tasks 9-10 os preenchem — usar stubs por ora).

- [ ] **Step 1: Testes de chrome** — `Sidebar` renderiza um item por `route.nav` na ordem `order`, com o item ativo marcado; `BottomNav` só lista overview/pipeline/workers/activity/monitor; trocar idioma via `LangSwitch` muda os labels (lê `lang` signal); `ThemeToggle` cicla `data-theme` (dark→light→auto); título da topbar reflete a rota. Usar `preact-iso`'s router num render de teste navegando por hash.

- [ ] **Step 2: Rodar — falha.**

- [ ] **Step 3: Implementar chrome + router.** preact-iso: `import { LocationProvider, Router, Route, useLocation } from "preact-iso"`. Rotas a partir de `routes` (`routes.map(r => <Route path={r.path} component={r.component} />)`). Persistência de view: preact-iso usa history/hash; para paridade com `localStorage["aipe-view"]` + deep-link por hash, configurar rota default `/overview` e restaurar do storage no bootstrap. Nav badge de escalation no item `activity` (lê `counts.escalated`, esconde em 0 — app.html:634-637). `Sidebar` inclui rodapé com Settings + Collapse; hambúrguer/mobileopen (app.html:1177,1188) e collapse (673) preservados. Remover qualquer referência a Terminal.

- [ ] **Step 4: Rodar — passa.**

- [ ] **Step 5: Verificar no app real** — `bun src/serve/cli.ts serve --port 7799`, abrir no browser: sidebar/bottom-nav/topbar renderizam, navegação por clique e por hash funcionam, EN/PT e tema trocam. (As views ainda são stubs.)

- [ ] **Step 6: Commit**

```bash
git add src/serve/app/main.tsx src/serve/app/components/ src/serve/app/views/ src/serve/app/__tests__/chrome.test.tsx
git commit -m "feat(serve): chrome + router preact-iso (sidebar/bottom-nav/topbar/lang/tema) com auto-descoberta de views"
```

---

## Task 9: CommandPalette (⌘K)

**Files:**
- Modify: `src/serve/app/components/CommandPalette.tsx`
- Test: `src/serve/app/__tests__/command-palette.test.tsx`

**Interfaces:** portar app.html:1232-1275. Comandos de navegação (views) + ação tema + lista de workers (`DATA.workers` → `openWorker`). Filtro por texto; navegação por teclado (↑/↓/Enter/Esc); atalho ⌘K/Ctrl+K toggle. Remover o comando `c_openterm` (Terminal). O comando `c_writespec` era `alert("(mock)")` — preservar como mock (paridade), ou remover; decidir e documentar (recomendo manter mock p/ paridade).

- [ ] **Step 1: Testes** — abre/fecha com ⌘K; filtra por query (`cmdList`); ↓ move seleção; Enter roda o item selecionado (navega); clicar num worker chama abertura do drawer; sem match mostra `t("nomatch")`; não há comando de terminal.
- [ ] **Step 2: Rodar — falha.**
- [ ] **Step 3: Implementar** (signals para aberto/seleção/query; `commands()` sem terminal; workers de `store`).
- [ ] **Step 4: Rodar — passa.**
- [ ] **Step 5: Commit** `feat(serve): command palette ⌘K (navegação + ações + busca de workers)`

---

## Task 10: WorkerDrawer (overlay global) + UnitFacts

**Files:**
- Modify: `src/serve/app/components/WorkerDrawer.tsx`, create `UnitFacts.tsx`
- Create: `src/serve/app/runtime/selectors.ts` (helpers de worker: `cvOf`,`dispatchesOf`,`repoOf`,`kindOf`,`worktreeOf`,`cvWork`,`unitLines`)
- Add signal `openWorkerName: Signal<string|null>` ao store.
- Test: `src/serve/app/__tests__/worker-drawer.test.tsx`, `selectors.test.ts`

**Interfaces:** portar app.html:873-911 (selectors) + 1203-1230 (drawer). Drawer é overlay de nível de app (aberto por Team, Pipeline e Command Palette) → mora no shell (main.tsx), controlado por `openWorkerName`. `openWorker(name)` = `openWorkerName.value = name` (no-op se worker inexistente). `closeDrawer` = `openWorkerName.value = null`; scrim fecha.

- [ ] **Step 1: Testes de selectors** (portar parityTests do brief team): `kindOf` com/sem package, `worktreeOf` fallback `—`, `cvWork` buckets (delivered+merged / dispatched+escalated, `removed` fora), `unitLines` monorepo vs repo. **Testes do drawer**: abre com name válido, no-op com inválido; seções condicionais (journey/pr/bio/worktree) aparecem/somem; relations filtra por repo; competences sem limite no drawer.
- [ ] **Step 2: Rodar — falha.**
- [ ] **Step 3: Implementar** selectors + `UnitFacts` + `WorkerDrawer` (montado no shell). `rowHTML` (código morto) NÃO é portado.
- [ ] **Step 4: Rodar — passa.**
- [ ] **Step 5: Commit** `feat(serve): worker drawer global + selectors de CV/worktree/dispatches`

---

## Tasks 11–18: Views (uma por task, TDD, cada uma seu commit)

Cada view segue o MESMO ciclo:
1. **Escrever os parityTests** (listados por view abaixo — vieram dos briefs; são asserções concretas) em `src/serve/app/__tests__/<view>.view.test.tsx`, renderizando o componente com signals populados por um snapshot fixture.
2. Rodar → FAIL.
3. Implementar `views/<view>.view.tsx` portando o markup/lógica das linhas citadas de `app.html`, exportando `export const route = { path, nav:{label,icon,order}, component }` (badge só em activity). Reusar átomos/componentes das tasks 7-10. Preservar edge-cases e a asimetria de escape só quando fizer diferença observável (documentar desvios).
4. Rodar → PASS + `bunx tsc --noEmit`.
5. Commit `feat(serve): view <nome> migrada para Preact (paridade)`.

Fixtures: criar `src/serve/app/__tests__/fixtures.ts` com um snapshot representativo (2 repos, 1 monorepo com packages, ~4 workers com status variados, relations, journeys/dispatches, toolbox, worktrees, cvs) — reusado por todas as views.

### Task 11 — overview.view.tsx  (app.html:712-740, 837-838, 847-852)
Path `/overview`, order 0, icon ◎. Componentes: `HeroStatus`, `KpiRow` (6 tiles, ordem hired/active/delivered/escalated/journeys/repos, classes ''/sky/acc/amber/''/''), `MiniPipeline` (4 stages, cores sky/amber/accent), `ActivityFeed` (slice 0,5). Parity tests: hero ok/warn conforme `counts.escalated`; fallback `warn_p0` quando não há worker escalado; 6 KPIs na ordem/classe corretas; miniPipeline conta `dispatches` por status; feed limita a 5; CTAs navegam para activity/pipeline.

### Task 12 — org.view.tsx + OrgChart/OrgTree/OrgLegend  (app.html:741-759, 912-1072) — A MAIOR
Path `/org`, order 1, icon ◈. `<OrgChart>` reimplementa a matemática de layout SVG (constantes yC=42,yR=152,yS0=262,sH=64,pkgH=28,grpGap=14,colW=212,gap=34; paths olink/oedge; g.onode). Pan/zoom via signal module-level `orgTransform={s,x,y}` (sobrevive a re-render de snapshot, igual `_orgZ`), handlers wheel/pointer/dblclick por ref (useEffect+cleanup), clamp [0.3,3]. Busca via signal `orgQuery` (Preact reconcilia o input → NÃO perde foco, melhoria natural sobre o innerHTML atual — documentar). Fullscreen em `#orgstage`. Nós specialist: `tabIndex=0 role=button aria-label`, Enter/Espaço = click; clique → `openWorkerName.value=name`. `<OrgTree>` mobile; `<OrgLegend>` 5 itens. Parity tests: extensos (ver brief org, seção parityTests — 19 asserções: nomatch, clusters de package, filtro por nome de repo mostra todos, edges de relação, zoom/pan persistem, pointerdown em nó não arrasta, a11y de teclado, cores por status, legenda). **Atenção especial:** esta task pode ser dividida em 12a (OrgChart SVG + tests), 12b (OrgTree + OrgLegend + view wiring) se ficar grande demais para um review.

### Task 13 — pipeline.view.tsx  (app.html:760-765, 853-862)
Path `/pipeline`, order 2, icon ▦. 4 lanes (STAGES), `DispatchCard` (`tkHTML`) clicável → drawer, link PR com stopPropagation, cores sky/amber/accent. **Preservar literalmente** o `{a}` hardcoded `2` no subtítulo (paridade — documentar como quirk conhecido; não corrigir). Botão "Filter" sem handler (paridade). Parity tests: 4 lanes na ordem, contadores por status, placeholder `—`, PR não propaga, subtítulo com `2` literal + `dispatches.length`.

### Task 14 — team.view.tsx + WorkerCard  (app.html:766-772, 863-911)
Path `/team`, order 3, icon ◑. `WorkerCard` (cvhead/UnitFacts/CompChips max=4/cvstats), grid `.cvgrid`, header com subtítulo interpolado (h/a/i) e botões All/+Dispatch **sem handler** (paridade). Clique no card → drawer. Reusa `WorkerDrawer`/selectors da Task 10. Parity tests: N cards = N workers, title/role fallback, chip de status, UnitFacts monorepo vs repo, cvstats buckets, botões sem ação.

### Task 15 — toolbox.view.tsx  (app.html:773-785)
Path `/toolbox`, order 4, icon ⬡. 2 cards (skills/mcps), sem interação. `SkillRow`(name/when/repos), `McpRow`(name/chip idle com scope como texto). Sem empty-state (paridade — não adicionar). Parity tests: N skills/N mcps, headers traduzidos, chip mcp sempre `idle`, JSX escapa tudo (documentar mudança vs escape parcial atual).

### Task 16 — activity.view.tsx  (app.html:786-791)
Path `/activity`, order 5, icon ⧗, **badge** `counts.escalated>0?counts.escalated:undefined`. Card único com `<ActivityFeed events={activity.value}>` (feed completo). Sem interação. Parity tests: N eventos = N `.ev`, header/streaming, dot por status + fallback active, reltime/e.t, escape, feed vazio sem placeholder.

### Task 17 — monitor.view.tsx + monitor-store.ts  (app.html:792-797, 1074-1157)
Path `/monitor`, order 6, icon ◉. `monitor-store.ts`: portar `MON` como signals (`agents`,`lanes`,`showAll`), `monPush` reducer (kinds agent/file/tool, cap MON_MAX=200), selectors `monVisibleAgents`/`monHiddenCount`, `isSpecialist` (agentType!=="Explore"). `connectMonitorStream` (`EventSource("api/monitor")`, evento `monitor`) — inicia no mount da view (ou no bootstrap). `<MonLane>` (stream+files panes, mon-live/idle), toolbar active-only/all (`monToggle`), auto-scroll ao fundo se grudado. Parity tests: reducer acumula por lane, cap 200, filtro showAll, hidden count, empty-state, tool vs reason lines, files reverse. Streaming continua acumulando mesmo fora da view (store global), mas só renderiza quando ativa (natural no Preact).

### Task 18 — settings.view.tsx  (app.html:808-836, 667-703, 1190-1199)
Path `/settings`, order 7 (rodapé), icon ⚙. Toggles de notificação (`sw`/`swEv` → `NOTIF`), permissão desktop (Notification.requestPermission), botão de teste (`notify`), seção aparência (tema langseg auto/light/dark, idioma EN/PT via `LangSwitch`). Reusa `runtime/notify.ts`. Parity tests: toggles refletem/mutam `NOTIF` e persistem; chip de permissão granted/denied/grant-button; teste dispara `notify`; troca de tema seta `data-theme`; troca de idioma via `setLang`.

---

## Task 19: Cutover — remover Terminal, deletar app.html, wiring final

**Files:**
- Delete: `src/serve/app.html`, `src/serve/terminal.ts`, `src/serve/__tests__/terminal.test.ts`
- Modify: `src/serve/server.ts` (remover rota/handler `/api/terminal` e o WS de terminal), `src/serve/handler.ts` (remover ref a terminal se houver)
- Modify: `src/serve/cli.ts` (remover flag `--allow-remote-terminal` se existir e ficou órfã)
- Modify: `src/serve/app/main.tsx` (garantir bootstrap real: `fetchInitialSnapshot`→`applySnapshot`→`connectSnapshotStream`→`wireActivityNotifications`)

**Interfaces:**
- Consumes: tudo das tasks 3-18.
- Produces: app completo servido, sem Terminal, sem `app.html`.

- [ ] **Step 1: Bootstrap real no main.tsx** — no mount do `<App>`, chamar `bootstrap()` (fetch inicial + SSE + notify wire). Restaurar view do `localStorage["aipe-view"]`/hash. Verificar que `app.generated.html` não é mais necessário em dev (getAppHtml dev usa buildClient).

- [ ] **Step 2: Remover Terminal do servidor** — em `server.ts` (linhas ~146-159, rota `/api/terminal` e o upgrade WS), remover o bloco; deletar `terminal.ts` e `terminal.test.ts`; remover flag CLI órfã. Confirmar que nenhum outro módulo importa `terminal.ts`.

```bash
grep -rn "terminal" src/serve --include=*.ts | grep -v app.generated
```
Expected: sem referências vivas (fora de strings de UI já removidas).

- [ ] **Step 3: Deletar app.html**

```bash
git rm src/serve/app.html
```

- [ ] **Step 4: Suite completa verde**

Run: `bun test`
Expected: PASS (incluindo server/monitor/handler ajustados; terminal.test.ts removido).
Run: `bunx tsc --noEmit -p tsconfig.json` → sem erros.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(serve): cutover — bootstrap real, remove a feature Terminal e o monólito app.html"
```

---

## Task 20: QA de paridade no app real + build do binário (gate do PR)

**Files:** nenhum (verificação). Segue a regra #11 (PR só depois do QA verde).

- [ ] **Step 1: Build do binário standalone**

```bash
bun run scripts/build.ts host
ls -la dist/aipe-linux-x64
```
Expected: OK, binário gerado (genRoutes + buildClient rodaram; `app.generated.html` foi embutido).

- [ ] **Step 2: Rodar o binário e conferir GET /**

```bash
rm -f ~/.local/bin/aipe && cp dist/aipe-linux-x64 ~/.local/bin/aipe && chmod +x ~/.local/bin/aipe
aipe serve --port 7788 --background
sleep 1
curl -s localhost:7788/ | grep -c "id=\"app\""   # shell servido
```

- [ ] **Step 3: Dirigir a feature no browser (checklist de paridade)** — abrir `localhost:7788`, confirmar visualmente:
  - Overview renderiza (hero, 6 KPIs, mini-pipeline, feed) — não em branco.
  - Sidebar/topbar/bottom-nav corretos; navegação por clique, hash e ⌘K.
  - Org chart: SVG com pan (drag), zoom (wheel + botões), fullscreen, filtro de busca (sem perder foco), árvore mobile, legenda.
  - Pipeline: 4 lanes com contadores; card abre drawer; link PR abre em nova aba.
  - Team: cards de worker; clique abre drawer com seções condicionais.
  - Toolbox: skills + mcps.
  - Activity: feed completo; badge de escalation.
  - Monitor: conecta `/api/monitor`; lanes por especialista; toolbar active/all. (Se não houver agente ativo, mostra empty-state — comportamento atual preservado.)
  - Settings: toggles persistem; notificação de teste dispara (som + desktop se permitido); tema e idioma trocam.
  - **Terminal ausente** do nav (desktop e mobile) e do ⌘K.
  - EN↔PT troca todos os textos de chrome.
  - SSE ao vivo: alterar algo em `.aipe/` do workspace reflete sem reload.

- [ ] **Step 4: Registrar evidência** — anotar no corpo do PR o resultado do checklist (o que foi dirigido e observado) + os desvios intencionais documentados (JSX escapa tudo; input do org preserva foco; `2` hardcoded do pipeline preservado). Parar o serve:

```bash
aipe serve --port 7788 --background && pkill -f "aipe serve" || true
```

- [ ] **Step 5: Abrir o PR** (só agora, pós-QA)

```bash
git push -u origin feat/serve-framework-migration
gh pr create --title "feat(serve): migração do serve para framework Preact (T1.0)" --body "<spec + checklist de QA + desvios intencionais>"
```

---

## Self-Review (do autor do plano)

- **Cobertura do spec:** §3 stack → Task 1; §4 arquitetura/auto-descoberta → Tasks 2,8; §5 data-flow → Tasks 4,5,6; §6 build → Task 2; §7 testes → todas; §8 riscos (OrgChart) → Task 12 (com sub-divisão 12a/12b prevista); Terminal removido → Task 19; verificação §9 → Task 20. ✔
- **Ordem de dependência:** foundation (1-10) antes das views (11-18); cutover (19) e QA (20) por último. Views são independentes entre si (paralelizáveis na execução, mas cada uma é sua própria task/commit). ✔
- **Placeholders:** os stubs de view na Task 8 são intencionais e substituídos nas Tasks 11-18 (não são placeholders de plano). Código de foundation é completo; views dão estrutura + parityTests concretos + linhas-fonte exatas (port 1:1). ✔
- **Consistência de tipos/nomes:** `getAppHtml`/`buildClient`/`genRoutes`/`applySnapshot`/`connectSnapshotStream`/`openWorkerName`/`NOTIF`/`lang`/`t`/`stt` usados com os mesmos nomes entre tasks. ✔
