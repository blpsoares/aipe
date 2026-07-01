# /context-brain Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir a skill `/context-brain` do AIPe: coleta interativa do contexto (repos de um time) e gravação determinística de `.aipe/brain.yaml` + `.aipe/state.yaml`.

**Architecture:** A skill separa duas responsabilidades. A **camada conversacional** (`SKILL.md`) coleta os dados do PE (nome do contexto, nome do coordenador, lista de repos). A **camada determinística** é um CLI em Bun/TypeScript que recebe os dados coletados como JSON, **valida** (URLs, paths, duplicidade) e **serializa** para YAML bem-formado. O modelo nunca escreve YAML à mão — isso elimina alucinação de formato.

**Tech Stack:** Bun, TypeScript (strict), pacote `yaml` para serialização, `bun test` para testes.

## Global Constraints

- **Runtime:** Bun. Todos os scripts rodam com `bun`; testes com `bun test`.
- **TypeScript strict:** `strict: true` no tsconfig. Sem `any` implícito.
- **Idioma:** mensagens ao usuário (validação, prompts da skill) em **português**. Commits em português, Conventional Commits.
- **Formato de saída:** YAML, gravado em `<workspace>/.aipe/`. `brain.yaml` e `state.yaml`.
- **Convenção de workspace:** a pasta do contexto chama-se `aipe-<context.name>`; `context.name` é um slug (minúsculas, números, hífens).
- **Paths dos repos:** relativos ao workspace, começando com `./`.

---

## File Structure

```
~/aipe/
  package.json                              # projeto Bun + deps (yaml, @types/bun)
  tsconfig.json                             # TS strict
  .claude-plugin/plugin.json                # manifesto do plugin AIPe
  skills/context-brain/SKILL.md             # skill interativa (camada conversacional)
  src/context-brain/
    types.ts                                # tipos: BrainFile, RepoEntry, StateFile, ContextInput, ValidationResult
    validate.ts                             # validateContext(input): ValidationResult
    write.ts                                # writeBrainFiles(dir, brain), initialState()
    init.ts                                 # initContextBrain(input, dir): InitResult  (valida + grava)
    cli.ts                                  # entry: lê JSON (arquivo/stdin) → initContextBrain → imprime resultado
    __tests__/
      validate.test.ts
      write.test.ts
      init.test.ts
      cli.test.ts
```

Responsabilidade por arquivo:
- `types.ts` — contrato único de tipos, importado por todos os outros.
- `validate.ts` — regras puras, sem I/O. Fácil de testar.
- `write.ts` — I/O de disco (mkdir + serialização YAML). Sem regras de negócio.
- `init.ts` — orquestra validate → write. É a API pública do módulo.
- `cli.ts` — parsing de argumentos/stdin. Fino; delega a `init.ts`.
- `SKILL.md` — conversa com o PE, monta o JSON, chama o CLI, trata erros de validação.

---

## Task 1: Scaffold do projeto + tipos

**Files:**
- Create: `package.json`, `tsconfig.json`
- Create: `src/context-brain/types.ts`
- Test: `src/context-brain/__tests__/types.test.ts`

**Interfaces:**
- Produces: os tipos `RepoEntry`, `ContextMeta`, `BrainFile`, `StateFile`, `ContextInput`, `ValidationError`, `ValidationResult` — consumidos por todas as tasks seguintes.

- [ ] **Step 1: Inicializar o projeto Bun e dependências**

Run:
```bash
cd ~/aipe && bun init -y && bun add yaml && bun add -d @types/bun
```

- [ ] **Step 2: Escrever `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "types": ["bun"],
    "skipLibCheck": true,
    "noEmit": true
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Escrever os tipos em `src/context-brain/types.ts`**

```typescript
export interface RepoEntry {
  name: string;
  url: string;
  path: string;
  stack?: string[];
}

export interface ContextMeta {
  name: string;
  coordinator: string;
}

export interface BrainFile {
  context: ContextMeta;
  repos: RepoEntry[];
}

export type Phase = "pending" | "done";

export interface StateFile {
  phase: {
    brain: Phase;
    workspace: Phase;
    relationship: Phase;
    generator: Phase;
  };
}

export interface ContextInput {
  context: ContextMeta;
  repos: RepoEntry[];
}

export interface ValidationError {
  field: string;
  message: string;
}

export type ValidationResult =
  | { ok: true }
  | { ok: false; errors: ValidationError[] };
```

- [ ] **Step 4: Escrever um teste de sanidade em `src/context-brain/__tests__/types.test.ts`**

```typescript
import { expect, test } from "bun:test";
import type { BrainFile } from "../types";

test("BrainFile aceita um contexto bem-formado", () => {
  const brain: BrainFile = {
    context: { name: "opvibes", coordinator: "Nicolas" },
    repos: [{ name: "embark", url: "git@github.com:opvibes/embark.git", path: "./embark" }],
  };
  expect(brain.repos.length).toBe(1);
});
```

- [ ] **Step 5: Rodar o teste**

Run: `cd ~/aipe && bun test src/context-brain/__tests__/types.test.ts`
Expected: PASS (1 test)

- [ ] **Step 6: Commit**

```bash
cd ~/aipe && git add -A && git commit -m "chore: scaffold do projeto bun e tipos da context-brain"
```

---

## Task 2: Validação

**Files:**
- Create: `src/context-brain/validate.ts`
- Test: `src/context-brain/__tests__/validate.test.ts`

**Interfaces:**
- Consumes: `ContextInput`, `ValidationResult`, `ValidationError` de `types.ts`.
- Produces: `validateContext(input: ContextInput): ValidationResult`.

- [ ] **Step 1: Escrever os testes que falham em `src/context-brain/__tests__/validate.test.ts`**

```typescript
import { expect, test } from "bun:test";
import { validateContext } from "../validate";
import type { ContextInput } from "../types";

const base: ContextInput = {
  context: { name: "opvibes", coordinator: "Nicolas" },
  repos: [{ name: "embark", url: "git@github.com:opvibes/embark.git", path: "./embark" }],
};

test("aceita um input válido", () => {
  expect(validateContext(base)).toEqual({ ok: true });
});

test("rejeita nome de contexto que não é slug", () => {
  const r = validateContext({ ...base, context: { name: "Op Vibes", coordinator: "Nicolas" } });
  expect(r.ok).toBe(false);
});

test("rejeita coordenador vazio", () => {
  const r = validateContext({ ...base, context: { name: "opvibes", coordinator: "" } });
  expect(r.ok).toBe(false);
});

test("rejeita lista de repos vazia", () => {
  const r = validateContext({ ...base, repos: [] });
  expect(r.ok).toBe(false);
});

test("rejeita url de repo inválida", () => {
  const r = validateContext({ ...base, repos: [{ name: "x", url: "not-a-url", path: "./x" }] });
  expect(r.ok).toBe(false);
});

test("rejeita path que não começa com ./", () => {
  const r = validateContext({ ...base, repos: [{ name: "x", url: "git@github.com:o/x.git", path: "x" }] });
  expect(r.ok).toBe(false);
});

test("rejeita nomes de repo duplicados", () => {
  const r = validateContext({
    ...base,
    repos: [
      { name: "dup", url: "git@github.com:o/a.git", path: "./a" },
      { name: "dup", url: "git@github.com:o/b.git", path: "./b" },
    ],
  });
  expect(r.ok).toBe(false);
});

test("rejeita paths duplicados", () => {
  const r = validateContext({
    ...base,
    repos: [
      { name: "a", url: "git@github.com:o/a.git", path: "./same" },
      { name: "b", url: "git@github.com:o/b.git", path: "./same" },
    ],
  });
  expect(r.ok).toBe(false);
});

test("aceita url https com .git", () => {
  const r = validateContext({ ...base, repos: [{ name: "x", url: "https://github.com/o/x.git", path: "./x" }] });
  expect(r.ok).toBe(true);
});
```

- [ ] **Step 2: Rodar os testes para confirmar que falham**

Run: `cd ~/aipe && bun test src/context-brain/__tests__/validate.test.ts`
Expected: FAIL ("Cannot find module '../validate'")

- [ ] **Step 3: Implementar `src/context-brain/validate.ts`**

```typescript
import type { ContextInput, ValidationError, ValidationResult } from "./types";

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const GIT_URL = /^(git@[\w.-]+:[\w./-]+\.git|https?:\/\/[\w.-]+\/[\w./-]+?(?:\.git)?)$/;

export function validateContext(input: ContextInput): ValidationResult {
  const errors: ValidationError[] = [];

  const name = input.context?.name?.trim() ?? "";
  if (!name) {
    errors.push({ field: "context.name", message: "nome do contexto é obrigatório" });
  } else if (!SLUG.test(name)) {
    errors.push({ field: "context.name", message: "use minúsculas, números e hífens (vira aipe-<nome>)" });
  }

  if (!input.context?.coordinator?.trim()) {
    errors.push({ field: "context.coordinator", message: "nome do coordenador é obrigatório" });
  }

  const repos = input.repos ?? [];
  if (repos.length === 0) {
    errors.push({ field: "repos", message: "informe ao menos um repositório" });
  }

  const seenNames = new Set<string>();
  const seenPaths = new Set<string>();
  repos.forEach((repo, i) => {
    const at = `repos[${i}]`;
    const rName = repo.name?.trim() ?? "";
    if (!rName) {
      errors.push({ field: `${at}.name`, message: "nome do repo é obrigatório" });
    } else if (seenNames.has(rName)) {
      errors.push({ field: `${at}.name`, message: `nome duplicado: ${rName}` });
    } else {
      seenNames.add(rName);
    }

    const url = repo.url?.trim() ?? "";
    if (!url) {
      errors.push({ field: `${at}.url`, message: "url é obrigatória" });
    } else if (!GIT_URL.test(url)) {
      errors.push({ field: `${at}.url`, message: `url inválida: ${url}` });
    }

    const path = repo.path?.trim() ?? "";
    if (!path) {
      errors.push({ field: `${at}.path`, message: "path é obrigatório" });
    } else if (!path.startsWith("./")) {
      errors.push({ field: `${at}.path`, message: "path deve ser relativo ao workspace (começar com ./)" });
    } else if (seenPaths.has(path)) {
      errors.push({ field: `${at}.path`, message: `path duplicado: ${path}` });
    } else {
      seenPaths.add(path);
    }
  });

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}
```

- [ ] **Step 4: Rodar os testes para confirmar que passam**

Run: `cd ~/aipe && bun test src/context-brain/__tests__/validate.test.ts`
Expected: PASS (9 tests)

- [ ] **Step 5: Commit**

```bash
cd ~/aipe && git add -A && git commit -m "feat: validação do input da context-brain"
```

---

## Task 3: Gravação dos arquivos YAML

**Files:**
- Create: `src/context-brain/write.ts`
- Test: `src/context-brain/__tests__/write.test.ts`

**Interfaces:**
- Consumes: `BrainFile`, `StateFile` de `types.ts`; `stringify` de `yaml`.
- Produces: `initialState(): StateFile` e `writeBrainFiles(workspaceDir: string, brain: BrainFile): Promise<{ brainPath: string; statePath: string }>`.

- [ ] **Step 1: Escrever os testes que falham em `src/context-brain/__tests__/write.test.ts`**

```typescript
import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "yaml";
import { initialState, writeBrainFiles } from "../write";
import type { BrainFile } from "../types";

const brain: BrainFile = {
  context: { name: "opvibes", coordinator: "Nicolas" },
  repos: [{ name: "embark", url: "git@github.com:opvibes/embark.git", path: "./embark", stack: ["typescript", "bun"] }],
};

test("initialState marca brain como done e o resto pending", () => {
  expect(initialState()).toEqual({
    phase: { brain: "done", workspace: "pending", relationship: "pending", generator: "pending" },
  });
});

test("grava brain.yaml e state.yaml em .aipe e são YAML válidos", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-"));
  try {
    const { brainPath, statePath } = await writeBrainFiles(dir, brain);
    expect(brainPath).toBe(join(dir, ".aipe", "brain.yaml"));
    expect(statePath).toBe(join(dir, ".aipe", "state.yaml"));

    const brainParsed = parse(await readFile(brainPath, "utf8"));
    expect(brainParsed.context.name).toBe("opvibes");
    expect(brainParsed.repos[0].stack).toEqual(["typescript", "bun"]);

    const stateParsed = parse(await readFile(statePath, "utf8"));
    expect(stateParsed.phase.brain).toBe("done");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Rodar os testes para confirmar que falham**

Run: `cd ~/aipe && bun test src/context-brain/__tests__/write.test.ts`
Expected: FAIL ("Cannot find module '../write'")

- [ ] **Step 3: Implementar `src/context-brain/write.ts`**

```typescript
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { stringify } from "yaml";
import type { BrainFile, StateFile } from "./types";

export function initialState(): StateFile {
  return {
    phase: { brain: "done", workspace: "pending", relationship: "pending", generator: "pending" },
  };
}

export async function writeBrainFiles(
  workspaceDir: string,
  brain: BrainFile,
): Promise<{ brainPath: string; statePath: string }> {
  const aipeDir = join(workspaceDir, ".aipe");
  await mkdir(aipeDir, { recursive: true });
  const brainPath = join(aipeDir, "brain.yaml");
  const statePath = join(aipeDir, "state.yaml");
  await writeFile(brainPath, stringify(brain), "utf8");
  await writeFile(statePath, stringify(initialState()), "utf8");
  return { brainPath, statePath };
}
```

- [ ] **Step 4: Rodar os testes para confirmar que passam**

Run: `cd ~/aipe && bun test src/context-brain/__tests__/write.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
cd ~/aipe && git add -A && git commit -m "feat: gravação de brain.yaml e state.yaml"
```

---

## Task 4: Orquestração (validate + write)

**Files:**
- Create: `src/context-brain/init.ts`
- Test: `src/context-brain/__tests__/init.test.ts`

**Interfaces:**
- Consumes: `validateContext` de `validate.ts`; `writeBrainFiles` de `write.ts`; `ContextInput` de `types.ts`.
- Produces: `initContextBrain(input: ContextInput, workspaceDir: string): Promise<InitResult>` onde
  `InitResult = { ok: true; brainPath: string; statePath: string } | { ok: false; errors: ValidationError[] }`.

- [ ] **Step 1: Escrever os testes que falham em `src/context-brain/__tests__/init.test.ts`**

```typescript
import { expect, test } from "bun:test";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initContextBrain } from "../init";
import type { ContextInput } from "../types";

const valid: ContextInput = {
  context: { name: "opvibes", coordinator: "Nicolas" },
  repos: [{ name: "embark", url: "git@github.com:opvibes/embark.git", path: "./embark" }],
};

test("input inválido retorna erros e não grava nada", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-"));
  try {
    const r = await initContextBrain({ ...valid, repos: [] }, dir);
    expect(r.ok).toBe(false);
    await expect(stat(join(dir, ".aipe"))).rejects.toThrow();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("input válido grava os arquivos e retorna os paths", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-"));
  try {
    const r = await initContextBrain(valid, dir);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect((await stat(r.brainPath)).isFile()).toBe(true);
      expect((await stat(r.statePath)).isFile()).toBe(true);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Rodar os testes para confirmar que falham**

Run: `cd ~/aipe && bun test src/context-brain/__tests__/init.test.ts`
Expected: FAIL ("Cannot find module '../init'")

- [ ] **Step 3: Implementar `src/context-brain/init.ts`**

```typescript
import type { ContextInput, ValidationError } from "./types";
import { validateContext } from "./validate";
import { writeBrainFiles } from "./write";

export type InitResult =
  | { ok: true; brainPath: string; statePath: string }
  | { ok: false; errors: ValidationError[] };

export async function initContextBrain(
  input: ContextInput,
  workspaceDir: string,
): Promise<InitResult> {
  const validation = validateContext(input);
  if (!validation.ok) {
    return { ok: false, errors: validation.errors };
  }
  const { brainPath, statePath } = await writeBrainFiles(workspaceDir, {
    context: input.context,
    repos: input.repos,
  });
  return { ok: true, brainPath, statePath };
}
```

- [ ] **Step 4: Rodar os testes para confirmar que passam**

Run: `cd ~/aipe && bun test src/context-brain/__tests__/init.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
cd ~/aipe && git add -A && git commit -m "feat: orquestração initContextBrain (valida + grava)"
```

---

## Task 5: CLI

**Files:**
- Create: `src/context-brain/cli.ts`
- Test: `src/context-brain/__tests__/cli.test.ts`

**Interfaces:**
- Consumes: `initContextBrain` de `init.ts`; `ContextInput` de `types.ts`.
- Comportamento: `bun src/context-brain/cli.ts --input <arquivo.json> --workspace <dir>`. Se `--workspace` for omitido, usa `process.cwd()`. Lê o JSON do arquivo (`--input`) ou de stdin se `--input` ausente. Em sucesso, imprime linhas `OK brain=<path>` e `OK state=<path>` e sai com código 0. Em erro de validação, imprime cada erro como `ERRO <field>: <message>` e sai com código 1.

- [ ] **Step 1: Escrever o teste que falha em `src/context-brain/__tests__/cli.test.ts`**

```typescript
import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CLI = join(import.meta.dir, "..", "cli.ts");

async function runCli(inputJson: unknown, workspace: string) {
  const inputPath = join(workspace, "input.json");
  await writeFile(inputPath, JSON.stringify(inputJson), "utf8");
  const proc = Bun.spawn(["bun", CLI, "--input", inputPath, "--workspace", workspace], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const exitCode = await proc.exited;
  const stdout = await new Response(proc.stdout).text();
  return { exitCode, stdout };
}

test("CLI grava os arquivos e sai com 0 em input válido", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-"));
  try {
    const { exitCode, stdout } = await runCli(
      {
        context: { name: "opvibes", coordinator: "Nicolas" },
        repos: [{ name: "embark", url: "git@github.com:opvibes/embark.git", path: "./embark" }],
      },
      dir,
    );
    expect(exitCode).toBe(0);
    expect(stdout).toContain("OK brain=");
    expect(stdout).toContain("OK state=");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("CLI sai com 1 e imprime erros em input inválido", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-"));
  try {
    const { exitCode, stdout } = await runCli(
      { context: { name: "opvibes", coordinator: "Nicolas" }, repos: [] },
      dir,
    );
    expect(exitCode).toBe(1);
    expect(stdout).toContain("ERRO repos:");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Rodar o teste para confirmar que falha**

Run: `cd ~/aipe && bun test src/context-brain/__tests__/cli.test.ts`
Expected: FAIL ("Cannot find module '../cli'" ou processo sem saída esperada)

- [ ] **Step 3: Implementar `src/context-brain/cli.ts`**

```typescript
#!/usr/bin/env bun
import { initContextBrain } from "./init";
import type { ContextInput } from "./types";

function getFlag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const inputPath = getFlag(args, "--input");
  const workspace = getFlag(args, "--workspace") ?? process.cwd();

  const raw = inputPath ? await Bun.file(inputPath).text() : await Bun.stdin.text();
  const input = JSON.parse(raw) as ContextInput;

  const result = await initContextBrain(input, workspace);
  if (!result.ok) {
    for (const e of result.errors) {
      console.log(`ERRO ${e.field}: ${e.message}`);
    }
    return 1;
  }
  console.log(`OK brain=${result.brainPath}`);
  console.log(`OK state=${result.statePath}`);
  return 0;
}

main().then((code) => process.exit(code));
```

- [ ] **Step 4: Rodar o teste para confirmar que passa**

Run: `cd ~/aipe && bun test src/context-brain/__tests__/cli.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Rodar a suíte inteira**

Run: `cd ~/aipe && bun test`
Expected: PASS (todos os testes das tasks 1-5)

- [ ] **Step 6: Commit**

```bash
cd ~/aipe && git add -A && git commit -m "feat: cli da context-brain"
```

---

## Task 6: Skill interativa + manifesto do plugin

**Files:**
- Create: `skills/context-brain/SKILL.md`
- Create: `.claude-plugin/plugin.json`

**Interfaces:**
- Consumes: o CLI `src/context-brain/cli.ts` (contrato da Task 5).
- Produces: a skill invocável `/context-brain` e o manifesto do plugin AIPe.

- [ ] **Step 1: Escrever o manifesto `.claude-plugin/plugin.json`**

```json
{
  "name": "aipe",
  "version": "0.1.0",
  "description": "AI Product Engineer — coordenador geral de engenharia multi-repo"
}
```

- [ ] **Step 2: Escrever a skill `skills/context-brain/SKILL.md`**

````markdown
---
name: context-brain
description: Use no onboarding de um contexto/time AIPe para mapear os repositórios (URLs, paths, stacks) e gravar .aipe/brain.yaml + .aipe/state.yaml. Não clona nem analisa código — só registra o conhecimento factual.
---

# /context-brain

Coleta interativa do contexto de um time e gravação determinística do brain file.
Você (coordenador) NÃO escreve o YAML à mão — coleta os dados do PE e delega a
gravação ao CLI tipado, que valida e serializa.

## Fluxo

1. **Confirme o workspace.** O brain é gravado em `<workspace>/.aipe/`. Por padrão o
   workspace é o diretório atual. Confirme com o PE se é aqui (deve ser uma pasta
   `aipe-<contexto>`).

2. **Colete os dados, uma pergunta por vez:**
   - Nome do **contexto** (slug: minúsculas, números, hífens — vira `aipe-<nome>`).
   - Nome do **coordenador** (como o PE quer te chamar).
   - Os **repositórios**: para cada um, `name`, `url` (git@ ou https .git) e `path`
     relativo (começando com `./`). `stack` é opcional — só preencha se o PE souber;
     senão deixe de fora (será preenchido em fases posteriores). O PE pode colar uma
     lista de uma vez.

3. **Monte o JSON** no formato `ContextInput`:
   ```json
   {
     "context": { "name": "<slug>", "coordinator": "<nome>" },
     "repos": [ { "name": "...", "url": "...", "path": "./...", "stack": ["..."] } ]
   }
   ```

4. **Grave via CLI.** Escreva o JSON em um arquivo temporário e rode:
   ```bash
   bun <caminho-do-plugin>/src/context-brain/cli.ts --input <arquivo.json> --workspace <workspace>
   ```

5. **Trate o resultado:**
   - Saída `OK brain=... / OK state=...` → confirme ao PE os arquivos gravados.
   - Linhas `ERRO <campo>: <mensagem>` → mostre ao PE, corrija o dado apontado e
     rode de novo. Não grave nada à mão.

## Regras

- Nunca edite `brain.yaml`/`state.yaml` diretamente aqui — sempre pelo CLI, para
  garantir formato válido.
- Uma pergunta por vez; não despeje todas de uma vez.
- Se o workspace não existir ou não parecer um `aipe-<contexto>`, pergunte antes de
  gravar.
````

- [ ] **Step 3: Verificação manual da skill**

Run:
```bash
cd /tmp && rm -rf aipe-teste && mkdir aipe-teste && cd aipe-teste \
  && printf '{"context":{"name":"teste","coordinator":"Nicolas"},"repos":[{"name":"embark","url":"git@github.com:opvibes/embark.git","path":"./embark"}]}' > input.json \
  && bun ~/aipe/src/context-brain/cli.ts --input input.json --workspace . \
  && echo "--- brain.yaml ---" && cat .aipe/brain.yaml && echo "--- state.yaml ---" && cat .aipe/state.yaml
```
Expected: imprime `OK brain=... / OK state=...` seguido do conteúdo YAML dos dois arquivos, com `phase.brain: done`.

- [ ] **Step 4: Commit**

```bash
cd ~/aipe && git add -A && git commit -m "feat: skill /context-brain e manifesto do plugin aipe"
```

---

## Notas de execução

- **`import.meta.dir`** (usado no teste do CLI) é uma API do Bun que resolve o diretório
  do arquivo de teste; combina com o caminho `../cli.ts`.
- **Detecção de stack** fica fora deste plano (é responsabilidade de uma fase posterior,
  quando o código estiver clonado). `stack` é opcional no brain.
- **Distribuição do plugin** (publicar, instalar por escopo global/projeto) é uma
  preocupação separada do roadmap; aqui o manifesto mínimo já torna o plugin carregável
  localmente.
