# /make-workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Materializar (clonar) na máquina todos os repos declarados no `brain.yaml` de um workspace AIPe, de forma idempotente e não-destrutiva, atualizando `state.yaml`.

**Architecture:** Mesmo padrão da `/context-brain`: uma **skill** conversacional orquestra e um **CLI tipado** (`src/make-workspace/cli.ts`) faz o trabalho determinístico. O CLI lê+valida o brain, decide por repo (clonar / pular / erro) via um **cloner** e um **inspector** injetáveis (git de verdade fica atrás dessa fronteira, para testar sem rede), agrega a fase `workspace` e a grava no `state.yaml` preservando as demais fases.

**Tech Stack:** Bun + TypeScript strict, `bun test`, pacote `yaml`, git via `Bun.spawn`.

## Global Constraints

- TypeScript **strict** (herda `tsconfig.json` do repo).
- Testes com `bun test` (import `{ expect, test } from "bun:test"`).
- Serialização/parse de YAML pelo pacote `yaml` (`parse`/`stringify`).
- Reusar os tipos `BrainFile`, `RepoEntry`, `StateFile`, `Phase` de `src/context-brain/types.ts` — **não** redefinir.
- **Nunca** sobrescrever/apagar repos existentes; `git clone` usa credenciais já configuradas do usuário, sem prompt interativo.
- Mensagens ao usuário em **português**; commits em português seguindo Conventional Commits.
- `state.phase.workspace` só vira `done` se **todos** os repos estão `cloned` ou `skipped`; qualquer `error` → `pending`.

---

## File Structure

```
src/make-workspace/
  ├── types.ts        # tipos de resultado por-repo; re-export de BrainFile/RepoEntry
  ├── read.ts         # readBrain(): lê + valida <ws>/.aipe/brain.yaml
  ├── clone.ts        # remotesMatch + materializeRepo (decisão por-repo, injetável)
  ├── state.ts        # updateWorkspacePhase(): atualiza state.yaml preservando fases
  ├── run.ts          # makeWorkspace(): orquestra leitura → materialização → estado
  ├── git.ts          # adaptadores reais (Inspector/Cloner) via Bun.spawn
  ├── cli.ts          # parse de flags, wiring com git real, renderReport (puro)
  └── __tests__/
       ├── read.test.ts
       ├── clone.test.ts
       ├── state.test.ts
       ├── run.test.ts
       └── cli.test.ts
skills/make-workspace/SKILL.md
```

---

## Task 1: Tipos + leitura/validação do brain

**Files:**
- Create: `src/make-workspace/types.ts`
- Create: `src/make-workspace/read.ts`
- Test: `src/make-workspace/__tests__/read.test.ts`

**Interfaces:**
- Consumes: `BrainFile`, `RepoEntry` de `src/context-brain/types.ts`.
- Produces:
  - `type RepoStatus = "cloned" | "skipped" | "error"`
  - `interface RepoResult { name: string; status: RepoStatus; message?: string }`
  - `type WorkspacePhase = "pending" | "done"`
  - `type ReadBrainResult = { ok: true; brain: BrainFile } | { ok: false; error: string }`
  - `readBrain(workspaceDir: string): Promise<ReadBrainResult>`

- [ ] **Step 1: Escrever os tipos**

Create `src/make-workspace/types.ts`:

```ts
import type { BrainFile, RepoEntry } from "../context-brain/types";

export type { BrainFile, RepoEntry };

export type RepoStatus = "cloned" | "skipped" | "error";

export interface RepoResult {
  name: string;
  status: RepoStatus;
  message?: string;
}

export type WorkspacePhase = "pending" | "done";
```

- [ ] **Step 2: Escrever o teste que falha**

Create `src/make-workspace/__tests__/read.test.ts`:

```ts
import { expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stringify } from "yaml";
import { readBrain } from "../read";
import type { BrainFile } from "../types";

const brain: BrainFile = {
  context: { name: "opvibes", coordinator: "Nicolas" },
  repos: [{ name: "embark", url: "git@github.com:opvibes/embark.git", path: "./embark" }],
};

async function makeWorkspaceDir(brainContent?: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "aipe-mw-"));
  if (brainContent !== undefined) {
    await mkdir(join(dir, ".aipe"), { recursive: true });
    await writeFile(join(dir, ".aipe", "brain.yaml"), brainContent, "utf8");
  }
  return dir;
}

test("lê e valida um brain.yaml bem formado", async () => {
  const dir = await makeWorkspaceDir(stringify(brain));
  try {
    const result = await readBrain(dir);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.brain.context.name).toBe("opvibes");
      expect(result.brain.repos[0].url).toBe("git@github.com:opvibes/embark.git");
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("erro quando brain.yaml não existe", async () => {
  const dir = await makeWorkspaceDir();
  try {
    const result = await readBrain(dir);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("brain.yaml");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("erro quando YAML é malformado", async () => {
  const dir = await makeWorkspaceDir(": : : não é yaml :");
  try {
    const result = await readBrain(dir);
    expect(result.ok).toBe(false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("erro quando repos está ausente ou vazio", async () => {
  const dir = await makeWorkspaceDir(stringify({ context: { name: "x", coordinator: "y" }, repos: [] }));
  try {
    const result = await readBrain(dir);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("repos");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 3: Rodar o teste e ver falhar**

Run: `cd ~/aipe && bun test src/make-workspace/__tests__/read.test.ts`
Expected: FAIL — `Cannot find module "../read"`.

- [ ] **Step 4: Implementar `read.ts`**

Create `src/make-workspace/read.ts`:

```ts
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse } from "yaml";
import type { BrainFile, RepoEntry } from "./types";

export type ReadBrainResult =
  | { ok: true; brain: BrainFile }
  | { ok: false; error: string };

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

function validateRepo(repo: unknown, index: number): string | null {
  if (typeof repo !== "object" || repo === null) return `repos[${index}]: esperado objeto`;
  const r = repo as Record<string, unknown>;
  if (!isNonEmptyString(r.name)) return `repos[${index}].name: obrigatório`;
  if (!isNonEmptyString(r.url)) return `repos[${index}].url: obrigatório`;
  if (!isNonEmptyString(r.path)) return `repos[${index}].path: obrigatório`;
  return null;
}

export async function readBrain(workspaceDir: string): Promise<ReadBrainResult> {
  const brainPath = join(workspaceDir, ".aipe", "brain.yaml");
  let raw: string;
  try {
    raw = await readFile(brainPath, "utf8");
  } catch {
    return { ok: false, error: `brain.yaml não encontrado em ${brainPath}. Rode /context-brain primeiro.` };
  }

  let parsed: unknown;
  try {
    parsed = parse(raw);
  } catch {
    return { ok: false, error: "brain.yaml: YAML inválido" };
  }

  if (typeof parsed !== "object" || parsed === null) {
    return { ok: false, error: "brain.yaml: esperado um objeto" };
  }
  const obj = parsed as Record<string, unknown>;

  const context = obj.context as Record<string, unknown> | undefined;
  if (!context || !isNonEmptyString(context.name) || !isNonEmptyString(context.coordinator)) {
    return { ok: false, error: "brain.yaml: context.name/context.coordinator obrigatórios" };
  }

  if (!Array.isArray(obj.repos) || obj.repos.length === 0) {
    return { ok: false, error: "brain.yaml: repos ausente ou vazio" };
  }
  for (let i = 0; i < obj.repos.length; i++) {
    const err = validateRepo(obj.repos[i], i);
    if (err) return { ok: false, error: `brain.yaml: ${err}` };
  }

  return { ok: true, brain: { context: context as BrainFile["context"], repos: obj.repos as RepoEntry[] } };
}
```

- [ ] **Step 5: Rodar o teste e ver passar**

Run: `cd ~/aipe && bun test src/make-workspace/__tests__/read.test.ts`
Expected: PASS (4 testes).

- [ ] **Step 6: Commit**

```bash
cd ~/aipe && git add src/make-workspace/types.ts src/make-workspace/read.ts src/make-workspace/__tests__/read.test.ts
git commit -m "feat: leitura e validação do brain na make-workspace"
```

---

## Task 2: Decisão por-repo (`clone.ts`)

**Files:**
- Create: `src/make-workspace/clone.ts`
- Test: `src/make-workspace/__tests__/clone.test.ts`

**Interfaces:**
- Consumes: `RepoEntry`, `RepoResult` de `./types`.
- Produces:
  - `interface RepoInspection { exists: boolean; isGitRepo: boolean; remote?: string }`
  - `type Inspector = (absPath: string) => Promise<RepoInspection>`
  - `type Cloner = (url: string, absPath: string) => Promise<{ ok: true } | { ok: false; message: string }>`
  - `remotesMatch(a: string, b: string): boolean`
  - `materializeRepo(repo: RepoEntry, workspaceDir: string, inspect: Inspector, clone: Cloner): Promise<RepoResult>`

- [ ] **Step 1: Escrever o teste que falha**

Create `src/make-workspace/__tests__/clone.test.ts`:

```ts
import { expect, test } from "bun:test";
import { join } from "node:path";
import { materializeRepo, remotesMatch, type Inspector, type Cloner } from "../clone";
import type { RepoEntry } from "../types";

const repo: RepoEntry = { name: "embark", url: "git@github.com:opvibes/embark.git", path: "./embark" };
const ws = "/tmp/ws";

test("remotesMatch normaliza ssh vs https e sufixo .git", () => {
  expect(remotesMatch("git@github.com:opvibes/embark.git", "https://github.com/opvibes/embark")).toBe(true);
  expect(remotesMatch("git@github.com:opvibes/embark.git", "git@github.com:opvibes/outro.git")).toBe(false);
});

test("path inexistente → clona", async () => {
  const inspect: Inspector = async () => ({ exists: false, isGitRepo: false });
  let clonedTo = "";
  const clone: Cloner = async (_url, absPath) => { clonedTo = absPath; return { ok: true }; };
  const res = await materializeRepo(repo, ws, inspect, clone);
  expect(res.status).toBe("cloned");
  expect(clonedTo).toBe(join(ws, "embark"));
});

test("path presente com mesmo remote → skipped, sem clonar", async () => {
  const inspect: Inspector = async () => ({ exists: true, isGitRepo: true, remote: "https://github.com/opvibes/embark" });
  let called = false;
  const clone: Cloner = async () => { called = true; return { ok: true }; };
  const res = await materializeRepo(repo, ws, inspect, clone);
  expect(res.status).toBe("skipped");
  expect(called).toBe(false);
});

test("path presente mas não é git → error, sem clonar", async () => {
  const inspect: Inspector = async () => ({ exists: true, isGitRepo: false });
  let called = false;
  const clone: Cloner = async () => { called = true; return { ok: true }; };
  const res = await materializeRepo(repo, ws, inspect, clone);
  expect(res.status).toBe("error");
  expect(res.message).toContain("ocupado");
  expect(called).toBe(false);
});

test("path presente com remote divergente → error, sem clonar", async () => {
  const inspect: Inspector = async () => ({ exists: true, isGitRepo: true, remote: "git@github.com:outro/repo.git" });
  let called = false;
  const clone: Cloner = async () => { called = true; return { ok: true }; };
  const res = await materializeRepo(repo, ws, inspect, clone);
  expect(res.status).toBe("error");
  expect(called).toBe(false);
});

test("falha do cloner → error com a mensagem do git", async () => {
  const inspect: Inspector = async () => ({ exists: false, isGitRepo: false });
  const clone: Cloner = async () => ({ ok: false, message: "Permission denied (publickey)" });
  const res = await materializeRepo(repo, ws, inspect, clone);
  expect(res.status).toBe("error");
  expect(res.message).toContain("Permission denied");
});
```

- [ ] **Step 2: Rodar o teste e ver falhar**

Run: `cd ~/aipe && bun test src/make-workspace/__tests__/clone.test.ts`
Expected: FAIL — `Cannot find module "../clone"`.

- [ ] **Step 3: Implementar `clone.ts`**

Create `src/make-workspace/clone.ts`:

```ts
import { join } from "node:path";
import type { RepoEntry, RepoResult } from "./types";

export interface RepoInspection {
  exists: boolean;
  isGitRepo: boolean;
  remote?: string;
}

export type Inspector = (absPath: string) => Promise<RepoInspection>;
export type Cloner = (
  url: string,
  absPath: string,
) => Promise<{ ok: true } | { ok: false; message: string }>;

function canonicalizeRemote(url: string): string {
  let s = url.trim();
  if (s.endsWith(".git")) s = s.slice(0, -4);
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//i, ""); // remove protocolo (https://, ssh://)
  s = s.replace(/^[^@/]+@/, ""); // remove user@ (git@host)
  s = s.replace(":", "/"); // host:org/repo → host/org/repo (ssh scp-like)
  s = s.replace(/\/+$/, "");
  return s.toLowerCase();
}

export function remotesMatch(a: string, b: string): boolean {
  return canonicalizeRemote(a) === canonicalizeRemote(b);
}

export async function materializeRepo(
  repo: RepoEntry,
  workspaceDir: string,
  inspect: Inspector,
  clone: Cloner,
): Promise<RepoResult> {
  const absPath = join(workspaceDir, repo.path);
  const info = await inspect(absPath);

  if (!info.exists) {
    const result = await clone(repo.url, absPath);
    if (result.ok) return { name: repo.name, status: "cloned" };
    return { name: repo.name, status: "error", message: result.message };
  }

  if (info.isGitRepo && info.remote && remotesMatch(info.remote, repo.url)) {
    return { name: repo.name, status: "skipped", message: "já presente" };
  }

  return {
    name: repo.name,
    status: "error",
    message: `path ocupado por conteúdo diferente (${repo.path})`,
  };
}
```

- [ ] **Step 4: Rodar o teste e ver passar**

Run: `cd ~/aipe && bun test src/make-workspace/__tests__/clone.test.ts`
Expected: PASS (6 testes).

- [ ] **Step 5: Commit**

```bash
cd ~/aipe && git add src/make-workspace/clone.ts src/make-workspace/__tests__/clone.test.ts
git commit -m "feat: decisão por-repo (clonar/pular/erro) da make-workspace"
```

---

## Task 3: Atualização do `state.yaml` (`state.ts`)

**Files:**
- Create: `src/make-workspace/state.ts`
- Test: `src/make-workspace/__tests__/state.test.ts`

**Interfaces:**
- Consumes: `StateFile`, `Phase` de `../context-brain/types`; `initialState` de `../context-brain/write`.
- Produces: `updateWorkspacePhase(workspaceDir: string, phase: Phase): Promise<string>` (retorna o path do state gravado).

- [ ] **Step 1: Escrever o teste que falha**

Create `src/make-workspace/__tests__/state.test.ts`:

```ts
import { expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse, stringify } from "yaml";
import { updateWorkspacePhase } from "../state";

test("atualiza workspace preservando as outras fases", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-st-"));
  try {
    await mkdir(join(dir, ".aipe"), { recursive: true });
    await writeFile(
      join(dir, ".aipe", "state.yaml"),
      stringify({ phase: { brain: "done", workspace: "pending", relationship: "pending", generator: "pending" } }),
      "utf8",
    );

    const statePath = await updateWorkspacePhase(dir, "done");
    const parsed = parse(await readFile(statePath, "utf8"));
    expect(parsed.phase.workspace).toBe("done");
    expect(parsed.phase.brain).toBe("done");
    expect(parsed.phase.relationship).toBe("pending");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("cria state a partir do default se ausente", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-st-"));
  try {
    const statePath = await updateWorkspacePhase(dir, "pending");
    const parsed = parse(await readFile(statePath, "utf8"));
    expect(parsed.phase.brain).toBe("done");
    expect(parsed.phase.workspace).toBe("pending");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Rodar o teste e ver falhar**

Run: `cd ~/aipe && bun test src/make-workspace/__tests__/state.test.ts`
Expected: FAIL — `Cannot find module "../state"`.

- [ ] **Step 3: Implementar `state.ts`**

Create `src/make-workspace/state.ts`:

```ts
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parse, stringify } from "yaml";
import type { Phase, StateFile } from "../context-brain/types";
import { initialState } from "../context-brain/write";

export async function updateWorkspacePhase(workspaceDir: string, phase: Phase): Promise<string> {
  const aipeDir = join(workspaceDir, ".aipe");
  const statePath = join(aipeDir, "state.yaml");

  let state: StateFile = initialState();
  try {
    const raw = await readFile(statePath, "utf8");
    const parsed = parse(raw);
    if (parsed && typeof parsed === "object" && parsed.phase) {
      state = { phase: { ...state.phase, ...parsed.phase } };
    }
  } catch {
    // sem state prévio: parte do default
  }

  state.phase.workspace = phase;
  await mkdir(aipeDir, { recursive: true });
  await writeFile(statePath, stringify(state), "utf8");
  return statePath;
}
```

- [ ] **Step 4: Rodar o teste e ver passar**

Run: `cd ~/aipe && bun test src/make-workspace/__tests__/state.test.ts`
Expected: PASS (2 testes).

- [ ] **Step 5: Commit**

```bash
cd ~/aipe && git add src/make-workspace/state.ts src/make-workspace/__tests__/state.test.ts
git commit -m "feat: atualização da fase workspace no state.yaml"
```

---

## Task 4: Orquestração (`run.ts`)

**Files:**
- Create: `src/make-workspace/run.ts`
- Test: `src/make-workspace/__tests__/run.test.ts`

**Interfaces:**
- Consumes: `readBrain` (`./read`), `materializeRepo`/`Inspector`/`Cloner` (`./clone`), `updateWorkspacePhase` (`./state`), `RepoResult`/`WorkspacePhase` (`./types`).
- Produces:
  - `type RunResult = { ok: true; results: RepoResult[]; phase: WorkspacePhase } | { ok: false; error: string }`
  - `makeWorkspace(workspaceDir: string, deps: { inspect: Inspector; clone: Cloner }): Promise<RunResult>`

- [ ] **Step 1: Escrever o teste que falha**

Create `src/make-workspace/__tests__/run.test.ts`:

```ts
import { expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse, stringify } from "yaml";
import { makeWorkspace } from "../run";
import type { Inspector, Cloner } from "../clone";
import type { BrainFile } from "../types";

const brain: BrainFile = {
  context: { name: "opvibes", coordinator: "Nicolas" },
  repos: [
    { name: "embark", url: "git@github.com:opvibes/embark.git", path: "./embark" },
    { name: "prontuario", url: "git@github.com:opvibes/prontuario.git", path: "./prontuario" },
  ],
};

async function ws(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "aipe-run-"));
  await mkdir(join(dir, ".aipe"), { recursive: true });
  await writeFile(join(dir, ".aipe", "brain.yaml"), stringify(brain), "utf8");
  await writeFile(
    join(dir, ".aipe", "state.yaml"),
    stringify({ phase: { brain: "done", workspace: "pending", relationship: "pending", generator: "pending" } }),
    "utf8",
  );
  return dir;
}

test("todos clonam → phase done e state.workspace=done", async () => {
  const dir = await ws();
  try {
    const inspect: Inspector = async () => ({ exists: false, isGitRepo: false });
    const clone: Cloner = async () => ({ ok: true });
    const result = await makeWorkspace(dir, { inspect, clone });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.phase).toBe("done");
      expect(result.results.map((r) => r.status)).toEqual(["cloned", "cloned"]);
    }
    const state = parse(await readFile(join(dir, ".aipe", "state.yaml"), "utf8"));
    expect(state.phase.workspace).toBe("done");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("um erro → phase pending e state.workspace=pending", async () => {
  const dir = await ws();
  try {
    const inspect: Inspector = async () => ({ exists: false, isGitRepo: false });
    const clone: Cloner = async (url) =>
      url.includes("prontuario") ? { ok: false, message: "Permission denied" } : { ok: true };
    const result = await makeWorkspace(dir, { inspect, clone });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.phase).toBe("pending");
    const state = parse(await readFile(join(dir, ".aipe", "state.yaml"), "utf8"));
    expect(state.phase.workspace).toBe("pending");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("brain ausente → ok:false, state não é tocado", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-run-"));
  try {
    const inspect: Inspector = async () => ({ exists: false, isGitRepo: false });
    const clone: Cloner = async () => ({ ok: true });
    const result = await makeWorkspace(dir, { inspect, clone });
    expect(result.ok).toBe(false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("brain.yaml não é modificado pela execução", async () => {
  const dir = await ws();
  try {
    const before = await readFile(join(dir, ".aipe", "brain.yaml"), "utf8");
    const inspect: Inspector = async () => ({ exists: false, isGitRepo: false });
    const clone: Cloner = async () => ({ ok: true });
    await makeWorkspace(dir, { inspect, clone });
    const after = await readFile(join(dir, ".aipe", "brain.yaml"), "utf8");
    expect(after).toBe(before);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Rodar o teste e ver falhar**

Run: `cd ~/aipe && bun test src/make-workspace/__tests__/run.test.ts`
Expected: FAIL — `Cannot find module "../run"`.

- [ ] **Step 3: Implementar `run.ts`**

Create `src/make-workspace/run.ts`:

```ts
import { readBrain } from "./read";
import { materializeRepo, type Cloner, type Inspector } from "./clone";
import { updateWorkspacePhase } from "./state";
import type { RepoResult, WorkspacePhase } from "./types";

export type RunResult =
  | { ok: true; results: RepoResult[]; phase: WorkspacePhase }
  | { ok: false; error: string };

export async function makeWorkspace(
  workspaceDir: string,
  deps: { inspect: Inspector; clone: Cloner },
): Promise<RunResult> {
  const brainResult = await readBrain(workspaceDir);
  if (!brainResult.ok) return { ok: false, error: brainResult.error };

  const results: RepoResult[] = [];
  for (const repo of brainResult.brain.repos) {
    results.push(await materializeRepo(repo, workspaceDir, deps.inspect, deps.clone));
  }

  const phase: WorkspacePhase = results.every((r) => r.status !== "error") ? "done" : "pending";
  await updateWorkspacePhase(workspaceDir, phase);

  return { ok: true, results, phase };
}
```

- [ ] **Step 4: Rodar o teste e ver passar**

Run: `cd ~/aipe && bun test src/make-workspace/__tests__/run.test.ts`
Expected: PASS (4 testes).

- [ ] **Step 5: Commit**

```bash
cd ~/aipe && git add src/make-workspace/run.ts src/make-workspace/__tests__/run.test.ts
git commit -m "feat: orquestração makeWorkspace (materializa + agrega estado)"
```

---

## Task 5: Adaptadores git reais + CLI

**Files:**
- Create: `src/make-workspace/git.ts`
- Create: `src/make-workspace/cli.ts`
- Test: `src/make-workspace/__tests__/cli.test.ts`

**Interfaces:**
- Consumes: `Inspector`/`Cloner` (`./clone`), `makeWorkspace` (`./run`), `RepoResult`/`WorkspacePhase` (`./types`).
- Produces:
  - `realInspect: Inspector`, `realClone: Cloner` (em `git.ts`).
  - `renderReport(results: RepoResult[], phase: WorkspacePhase): string[]` (em `cli.ts`, pura e testável).

Nota: `git.ts` é glue fino sobre git de verdade — verificado por execução manual (Step 6), não por unit test. A lógica testável (formatação de saída) vive em `renderReport`.

- [ ] **Step 1: Escrever o teste que falha (renderReport)**

Create `src/make-workspace/__tests__/cli.test.ts`:

```ts
import { expect, test } from "bun:test";
import { renderReport } from "../cli";

test("renderReport formata cada repo e a linha de STATE", () => {
  const lines = renderReport(
    [
      { name: "embark", status: "cloned" },
      { name: "prontuario", status: "skipped", message: "já presente" },
      { name: "faturamento", status: "error", message: "Permission denied (publickey)" },
    ],
    "pending",
  );
  expect(lines).toContain("OK cloned embark");
  expect(lines).toContain("SKIP prontuario (já presente)");
  expect(lines).toContain("ERRO faturamento: Permission denied (publickey)");
  expect(lines.some((l) => l.startsWith("STATE workspace=pending"))).toBe(true);
});

test("renderReport marca done quando todos ok", () => {
  const lines = renderReport([{ name: "embark", status: "cloned" }], "done");
  expect(lines.some((l) => l.startsWith("STATE workspace=done"))).toBe(true);
});
```

- [ ] **Step 2: Rodar o teste e ver falhar**

Run: `cd ~/aipe && bun test src/make-workspace/__tests__/cli.test.ts`
Expected: FAIL — `Cannot find module "../cli"` (ou `renderReport` indefinido).

- [ ] **Step 3: Implementar `git.ts`**

Create `src/make-workspace/git.ts`:

```ts
import { stat } from "node:fs/promises";
import type { Cloner, Inspector, RepoInspection } from "./clone";

async function run(cmd: string[], cwd?: string): Promise<{ code: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(cmd, { cwd, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const code = await proc.exited;
  return { code, stdout: stdout.trim(), stderr: stderr.trim() };
}

export const realInspect: Inspector = async (absPath: string): Promise<RepoInspection> => {
  try {
    await stat(absPath);
  } catch {
    return { exists: false, isGitRepo: false };
  }
  const inside = await run(["git", "-C", absPath, "rev-parse", "--is-inside-work-tree"]);
  if (inside.code !== 0 || inside.stdout !== "true") {
    return { exists: true, isGitRepo: false };
  }
  const remote = await run(["git", "-C", absPath, "remote", "get-url", "origin"]);
  return {
    exists: true,
    isGitRepo: true,
    remote: remote.code === 0 ? remote.stdout : undefined,
  };
};

export const realClone: Cloner = async (url: string, absPath: string) => {
  const result = await run(["git", "clone", url, absPath]);
  if (result.code === 0) return { ok: true };
  return { ok: false, message: result.stderr || `git clone falhou (código ${result.code})` };
};
```

- [ ] **Step 4: Implementar `cli.ts`**

Create `src/make-workspace/cli.ts`:

```ts
#!/usr/bin/env bun
import { makeWorkspace } from "./run";
import { realClone, realInspect } from "./git";
import type { RepoResult, WorkspacePhase } from "./types";

function getFlag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const value = args[i + 1];
  if (value === undefined || value.startsWith("--")) return undefined;
  return value;
}

export function renderReport(results: RepoResult[], phase: WorkspacePhase): string[] {
  const lines: string[] = [];
  for (const r of results) {
    if (r.status === "cloned") lines.push(`OK cloned ${r.name}`);
    else if (r.status === "skipped") lines.push(`SKIP ${r.name} (${r.message ?? "já presente"})`);
    else lines.push(`ERRO ${r.name}: ${r.message ?? "erro desconhecido"}`);
  }
  const errors = results.filter((r) => r.status === "error").length;
  const suffix = errors > 0 ? ` (${errors} erro(s) de ${results.length} repos)` : "";
  lines.push(`STATE workspace=${phase}${suffix}`);
  return lines;
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const workspace = getFlag(args, "--workspace") ?? process.cwd();

  const result = await makeWorkspace(workspace, { inspect: realInspect, clone: realClone });
  if (!result.ok) {
    console.log(`ERRO brain: ${result.error}`);
    return 1;
  }

  for (const line of renderReport(result.results, result.phase)) {
    console.log(line);
  }
  return result.phase === "done" ? 0 : 1;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.log(`ERRO ${err}`);
    process.exit(1);
  });
```

- [ ] **Step 5: Rodar o teste e ver passar**

Run: `cd ~/aipe && bun test src/make-workspace/__tests__/cli.test.ts`
Expected: PASS (2 testes).

- [ ] **Step 6: Verificação manual de ponta a ponta (git real)**

Cria um workspace temporário com um brain apontando para um repo público pequeno e roda o CLI:

```bash
cd ~/aipe && MW=$(mktemp -d) && mkdir -p "$MW/.aipe" && cat > "$MW/.aipe/brain.yaml" <<'YAML'
context:
  name: teste
  coordinator: Nicolas
repos:
  - name: sample
    url: https://github.com/octocat/Hello-World.git
    path: ./sample
YAML
bun src/make-workspace/cli.ts --workspace "$MW"; echo "exit=$?"
# Rodar de novo deve pular (idempotência):
bun src/make-workspace/cli.ts --workspace "$MW"; echo "exit=$?"
rm -rf "$MW"
```
Expected: 1ª execução `OK cloned sample` + `STATE workspace=done` (exit 0); 2ª execução `SKIP sample (já presente)` + `STATE workspace=done` (exit 0).

- [ ] **Step 7: Rodar a suíte inteira**

Run: `cd ~/aipe && bun test`
Expected: PASS (todos os testes de context-brain + make-workspace).

- [ ] **Step 8: Commit**

```bash
cd ~/aipe && git add src/make-workspace/git.ts src/make-workspace/cli.ts src/make-workspace/__tests__/cli.test.ts
git commit -m "feat: cli e adaptadores git da make-workspace"
```

---

## Task 6: Skill `/make-workspace`

**Files:**
- Create: `skills/make-workspace/SKILL.md`

**Interfaces:**
- Consumes: `src/make-workspace/cli.ts` (via `bun`), `<workspace>/.aipe/brain.yaml` e `state.yaml`.
- Produces: nenhum símbolo de código — é a interface conversacional.

- [ ] **Step 1: Escrever a skill**

Create `skills/make-workspace/SKILL.md`:

```markdown
---
name: make-workspace
description: Use na etapa 2 do onboarding AIPe para materializar (git clone) os repositórios declarados no .aipe/brain.yaml dentro do workspace, de forma idempotente. Não cria worktree, não detecta stack, não edita o brain.
---

# /make-workspace

Materializa na máquina os repos do brain de um contexto. Você (coordenador) NÃO clona
à mão — delega ao CLI tipado, que decide por repo (clonar / pular / erro), nunca
sobrescreve nada e atualiza o `state.yaml`.

## Fluxo

1. **Confirme o workspace.** Por padrão é o diretório atual (deve ser uma pasta
   `aipe-<contexto>` com `.aipe/brain.yaml`).

2. **Cheque a pré-condição.** O brain precisa existir. Se não houver
   `<workspace>/.aipe/brain.yaml`, oriente o PE a rodar `/context-brain` primeiro —
   não faz sentido clonar sem o mapa.

3. **Execute o CLI:**
   ```bash
   bun <caminho-do-plugin>/src/make-workspace/cli.ts --workspace <workspace>
   ```

4. **Traduza a saída ao PE** (uma linha por repo):
   - `OK cloned <repo>` → clonado agora.
   - `SKIP <repo> (já presente)` → já estava lá, nada tocado.
   - `ERRO <repo>: <mensagem>` → falhou (auth, rede, ou path ocupado por conteúdo
     diferente). Explique e sugira a correção (ex: dar acesso ao repo, mover a pasta
     ocupada, ou corrigir a URL no brain via `/context-brain`).
   - `STATE workspace=done|pending` → estado agregado.

5. **Próximo passo:** se `workspace=done` (todos presentes), o contexto está pronto
   para a `/relationship`. Se `pending`, liste ao PE o que falta; re-rodar é seguro e
   completa só o que faltou.

## Regras

- Nunca clone nem edite `brain.yaml`/`state.yaml` à mão — sempre pelo CLI.
- Não crie worktrees aqui (é outro sub-projeto).
- Falha de autenticação nunca é contornada: reporte a mensagem do git ao PE.
```

- [ ] **Step 2: Verificar coerência com o padrão existente**

Run: `cd ~/aipe && cat skills/context-brain/SKILL.md skills/make-workspace/SKILL.md | head -60`
Expected: frontmatter (`name`/`description`) no mesmo formato; sem YAML editado à mão descrito.

- [ ] **Step 3: Commit**

```bash
cd ~/aipe && git add skills/make-workspace/SKILL.md
git commit -m "feat: skill /make-workspace"
```

---

## Self-Review (feita pelo autor do plano)

**Spec coverage:**
- §1 propósito/fronteiras (clone-only; não worktree/stack/brain/hook) → Tasks 1-6 (fronteiras refletidas na skill Task 6 e na ausência de código de worktree/stack).
- §2 fluxo skill+CLI → Task 5 (cli) + Task 6 (skill).
- §3 comportamento por-repo (cloned/skipped/error, mesmo remote, path ocupado, auth sem prompt, injetável) → Task 2 (`materializeRepo`) + Task 5 (`realInspect`/`realClone`).
- §4 state binário (done só se todos) → Task 3 (`updateWorkspacePhase`) + Task 4 (agregação).
- §5 erros/robustez (brain ausente, path ocupado, falha parcial não interrompe, re-execução) → Tasks 1,2,4 (testes cobrem cada caso).
- §6 testes → todos os `__tests__` + verificação manual (Task 5 Step 6).
- §8 estrutura de código → File Structure bate 1:1.

**Placeholder scan:** sem TBD/TODO; todo passo de código traz o código completo.

**Type consistency:** `RepoResult`/`RepoStatus`/`WorkspacePhase` definidos na Task 1 e usados igualzinho nas Tasks 2/4/5; `Inspector`/`Cloner` definidos na Task 2 e reusados em 4/5; `makeWorkspace(workspaceDir, {inspect, clone})` idêntico em run.ts e cli.ts; `updateWorkspacePhase(workspaceDir, phase)` idêntico em state.ts e run.ts.
```
