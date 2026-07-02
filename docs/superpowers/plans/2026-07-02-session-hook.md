# Hook SessionStart (injeção de contexto) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Um hook `SessionStart` do plugin AIPe que, ao abrir a sessão na raiz de um `aipe-<contexto>/`, injeta um único bloco de contexto do coordenador em 3 estados dirigidos pelo `state.yaml`.

**Architecture:** Bash orquestra e emite o JSON (`hookSpecificOutput.additionalContext`), como o `session-start` do superpowers; um helper Bun tipado e testado (`read-state.ts`) faz o parse robusto de `brain.yaml`+`state.yaml` (editáveis à mão) e devolve campos shell-friendly. O bash decide o estado (1 sem brain / 2 onboarding incompleto / 3 completo) e templata o texto.

**Tech Stack:** Bun + TypeScript strict, `bun test`, pacote `yaml`, bash, hook do Claude Code.

## Global Constraints

- TypeScript **strict** (`tsconfig.json`: `strict` + `noUncheckedIndexedAccess`; `bun test` NÃO checa tipos — rodar `bunx tsc --noEmit -p tsconfig.json`, 0 erros, antes de commitar).
- Reusar `BrainFile`/`StateFile`/`Phase` de `src/context-brain/types.ts` — não redefinir.
- Texto injetado em **português**; commits em português (Conventional Commits).
- Hook emite **exatamente um** `additionalContext` por sessão (switch no estado), ou `{}` se `$CLAUDE_PROJECT_DIR` for vazio.
- O hook **nunca** pode fazer o arranque da sessão falhar: toda falha de parse degrada (brain ausente/malformado → estado 1; state ausente/malformado → fases não-`brain` = `pending`).
- Output JSON do Claude Code: `{ "hookSpecificOutput": { "hookEventName": "SessionStart", "additionalContext": "<texto>" } }`.

---

## File Structure

```
hooks/
  ├── hooks.json                         ← registra o SessionStart (auto-descoberto pelo Claude Code)
  └── session-start                      ← bash: entrypoint, decide estado, templata, emite JSON
src/session-hook/
  ├── read-state.ts                      ← Bun tipado: parse robusto + campos shell-friendly
  └── __tests__/
       ├── read-state.test.ts            ← unitário (bun test)
       └── session-start.test.ts         ← fumaça: spawna o bash, valida o JSON por estado
```

---

## Task 1: Helper de leitura de estado (`read-state.ts`)

**Files:**
- Create: `src/session-hook/read-state.ts`
- Test: `src/session-hook/__tests__/read-state.test.ts`

**Interfaces:**
- Consumes: `BrainFile`, `StateFile`, `Phase` de `src/context-brain/types.ts`.
- Produces:
  - `interface Fields { brain: "present" | "absent"; contextName: string; coordinator: string; phaseBrain: Phase; phaseWorkspace: Phase; phaseRelationship: Phase; phaseGenerator: Phase; repos: string[] }`
  - `readState(workspaceDir: string): Promise<Fields>`
  - `formatFields(f: Fields): string` (formato `CHAVE=valor`, uma por linha)

- [ ] **Step 1: Escrever o teste que falha**

Create `src/session-hook/__tests__/read-state.test.ts`:

```ts
import { expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stringify } from "yaml";
import { readState, formatFields } from "../read-state";

async function ws(brain?: unknown, state?: unknown, rawBrain?: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "aipe-rs-"));
  await mkdir(join(dir, ".aipe"), { recursive: true });
  if (rawBrain !== undefined) await writeFile(join(dir, ".aipe", "brain.yaml"), rawBrain, "utf8");
  else if (brain !== undefined) await writeFile(join(dir, ".aipe", "brain.yaml"), stringify(brain), "utf8");
  if (state !== undefined) await writeFile(join(dir, ".aipe", "state.yaml"), stringify(state), "utf8");
  return dir;
}

const fullBrain = {
  context: { name: "opvibes", coordinator: "Nicolas" },
  repos: [
    { name: "embark", url: "git@github.com:opvibes/embark.git", path: "./embark" },
    { name: "prontuario", url: "git@github.com:opvibes/prontuario.git", path: "./prontuario" },
  ],
};
const doneState = { phase: { brain: "done", workspace: "done", relationship: "done", generator: "done" } };

test("brain+state completos (tudo done)", async () => {
  const dir = await ws(fullBrain, doneState);
  try {
    const f = await readState(dir);
    expect(f.brain).toBe("present");
    expect(f.contextName).toBe("opvibes");
    expect(f.coordinator).toBe("Nicolas");
    expect(f.repos).toEqual(["embark", "prontuario"]);
    expect(f.phaseWorkspace).toBe("done");
    expect(f.phaseGenerator).toBe("done");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("brain ausente → estado 1 (absent)", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-rs-"));
  try {
    const f = await readState(dir);
    expect(f.brain).toBe("absent");
    expect(f.repos).toEqual([]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("state parcial (workspace pending) reflete as fases", async () => {
  const dir = await ws(fullBrain, { phase: { brain: "done", workspace: "pending", relationship: "pending", generator: "pending" } });
  try {
    const f = await readState(dir);
    expect(f.phaseWorkspace).toBe("pending");
    expect(f.phaseBrain).toBe("done");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("state ausente com brain presente → fases não-brain = pending", async () => {
  const dir = await ws(fullBrain);
  try {
    const f = await readState(dir);
    expect(f.brain).toBe("present");
    expect(f.phaseBrain).toBe("done");
    expect(f.phaseWorkspace).toBe("pending");
    expect(f.phaseRelationship).toBe("pending");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("brain editado à mão (aspas + comentário) ainda extrai", async () => {
  const raw = `# contexto do time\ncontext:\n  name: "opvibes"\n  coordinator: 'Nicolas'\nrepos:\n  - name: embark\n    url: git@github.com:opvibes/embark.git\n    path: ./embark\n`;
  const dir = await ws(undefined, undefined, raw);
  try {
    const f = await readState(dir);
    expect(f.brain).toBe("present");
    expect(f.contextName).toBe("opvibes");
    expect(f.coordinator).toBe("Nicolas");
    expect(f.repos).toEqual(["embark"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("brain malformado (YAML inválido) degrada para absent, sem lançar", async () => {
  const dir = await ws(undefined, undefined, ": : não é : yaml :");
  try {
    const f = await readState(dir);
    expect(f.brain).toBe("absent");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("formatFields sanea quebras de linha e serializa CHAVE=valor", async () => {
  const dir = await ws({ context: { name: "op\nvibes", coordinator: "Nic" }, repos: [{ name: "a", url: "u", path: "./a" }] }, doneState);
  try {
    const out = formatFields(await readState(dir));
    expect(out).toContain("BRAIN=present");
    expect(out).toContain("CONTEXT_NAME=op vibes");
    expect(out).toContain("REPOS=a");
    expect(out.split("\n").length).toBe(8);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Rodar o teste e ver falhar**

Run: `cd ~/aipe && bun test src/session-hook/__tests__/read-state.test.ts`
Expected: FAIL — `Cannot find module "../read-state"`.

- [ ] **Step 3: Implementar `read-state.ts`**

Create `src/session-hook/read-state.ts`:

```ts
#!/usr/bin/env bun
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse } from "yaml";
import type { BrainFile, Phase, StateFile } from "../context-brain/types";

function getFlag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const v = args[i + 1];
  if (v === undefined || v.startsWith("--")) return undefined;
  return v;
}

function sanitize(v: string): string {
  return v.replace(/[\r\n\t]+/g, " ").trim();
}

function isPhase(v: unknown): v is Phase {
  return v === "pending" || v === "done";
}

export interface Fields {
  brain: "present" | "absent";
  contextName: string;
  coordinator: string;
  phaseBrain: Phase;
  phaseWorkspace: Phase;
  phaseRelationship: Phase;
  phaseGenerator: Phase;
  repos: string[];
}

async function readYaml(path: string): Promise<unknown | undefined> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    return undefined; // ausente
  }
  try {
    return parse(raw);
  } catch {
    return undefined; // malformado
  }
}

function absentFields(): Fields {
  return {
    brain: "absent",
    contextName: "",
    coordinator: "",
    phaseBrain: "pending",
    phaseWorkspace: "pending",
    phaseRelationship: "pending",
    phaseGenerator: "pending",
    repos: [],
  };
}

export async function readState(workspaceDir: string): Promise<Fields> {
  const aipe = join(workspaceDir, ".aipe");
  const brainParsed = await readYaml(join(aipe, "brain.yaml"));
  if (!brainParsed || typeof brainParsed !== "object") {
    return absentFields();
  }

  const brain = brainParsed as Partial<BrainFile>;
  const contextName = sanitize(String(brain.context?.name ?? ""));
  const coordinator = sanitize(String(brain.context?.coordinator ?? ""));
  const repos = Array.isArray(brain.repos)
    ? brain.repos
        .map((r) => sanitize(String((r as { name?: unknown } | null)?.name ?? "")))
        .filter((n) => n.length > 0)
    : [];

  const stateParsed = await readYaml(join(aipe, "state.yaml"));
  const phase = (stateParsed as Partial<StateFile> | undefined)?.phase;
  const readPhase = (v: unknown, fallback: Phase): Phase => (isPhase(v) ? v : fallback);

  return {
    brain: "present",
    contextName,
    coordinator,
    phaseBrain: readPhase(phase?.brain, "done"),
    phaseWorkspace: readPhase(phase?.workspace, "pending"),
    phaseRelationship: readPhase(phase?.relationship, "pending"),
    phaseGenerator: readPhase(phase?.generator, "pending"),
    repos,
  };
}

export function formatFields(f: Fields): string {
  return [
    `BRAIN=${f.brain}`,
    `CONTEXT_NAME=${f.contextName}`,
    `COORDINATOR=${f.coordinator}`,
    `PHASE_BRAIN=${f.phaseBrain}`,
    `PHASE_WORKSPACE=${f.phaseWorkspace}`,
    `PHASE_RELATIONSHIP=${f.phaseRelationship}`,
    `PHASE_GENERATOR=${f.phaseGenerator}`,
    `REPOS=${f.repos.join(",")}`,
  ].join("\n");
}

if (import.meta.main) {
  const workspace = getFlag(process.argv.slice(2), "--workspace") ?? process.cwd();
  console.log(formatFields(await readState(workspace)));
}
```

- [ ] **Step 4: Rodar o teste e ver passar**

Run: `cd ~/aipe && bun test src/session-hook/__tests__/read-state.test.ts`
Expected: PASS (7 testes).

- [ ] **Step 5: Type-check**

Run: `cd ~/aipe && bunx tsc --noEmit -p tsconfig.json`
Expected: 0 erros. (Se acusar em arquivos novos, corrija minimamente e re-rode.)

- [ ] **Step 6: Commit**

```bash
cd ~/aipe && git add src/session-hook/read-state.ts src/session-hook/__tests__/read-state.test.ts
git commit -m "feat: read-state do hook (parse robusto do brain/state)"
```

---

## Task 2: Hook bash + registro + teste de fumaça

**Files:**
- Create: `hooks/hooks.json`
- Create: `hooks/session-start`
- Test: `src/session-hook/__tests__/session-start.test.ts`

**Interfaces:**
- Consumes: `src/session-hook/read-state.ts` (via `bun`, saída `CHAVE=valor`); env `$CLAUDE_PROJECT_DIR`, `$CLAUDE_PLUGIN_ROOT`.
- Produces: JSON em stdout com `hookSpecificOutput.additionalContext`, ou `{}`.

- [ ] **Step 1: Escrever o teste de fumaça que falha**

Create `src/session-hook/__tests__/session-start.test.ts`:

```ts
import { expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stringify } from "yaml";

const PLUGIN_ROOT = join(import.meta.dir, "..", "..", "..");
const HOOK = join(PLUGIN_ROOT, "hooks", "session-start");

async function runHook(projectDir: string): Promise<string> {
  const proc = Bun.spawn(["bash", HOOK], {
    env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT },
    stdout: "pipe",
    stderr: "pipe",
  });
  const out = await new Response(proc.stdout).text();
  await proc.exited;
  return out.trim();
}

const brain = {
  context: { name: "opvibes", coordinator: "Nicolas" },
  repos: [{ name: "embark", url: "git@github.com:opvibes/embark.git", path: "./embark" }],
};

async function makeWs(state?: unknown, withBrain = true): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "aipe-ss-"));
  if (withBrain || state !== undefined) {
    await mkdir(join(dir, ".aipe"), { recursive: true });
    if (withBrain) await writeFile(join(dir, ".aipe", "brain.yaml"), stringify(brain), "utf8");
    if (state !== undefined) await writeFile(join(dir, ".aipe", "state.yaml"), stringify(state), "utf8");
  }
  return dir;
}

test("estado 1: sem brain → orienta /context-brain, JSON válido", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-ss-"));
  try {
    const out = await runHook(dir);
    const parsed = JSON.parse(out);
    expect(parsed.hookSpecificOutput.hookEventName).toBe("SessionStart");
    expect(parsed.hookSpecificOutput.additionalContext).toContain("/context-brain");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("estado 2: onboarding incompleto → próximo passo /make-workspace", async () => {
  const dir = await makeWs({ phase: { brain: "done", workspace: "pending", relationship: "pending", generator: "pending" } });
  try {
    const ctx = JSON.parse(await runHook(dir)).hookSpecificOutput.additionalContext;
    expect(ctx).toContain("configuração");
    expect(ctx).toContain("/make-workspace");
    expect(ctx).toContain("Nicolas");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("estado 3: tudo done → coordenador pleno com repos", async () => {
  const dir = await makeWs({ phase: { brain: "done", workspace: "done", relationship: "done", generator: "done" } });
  try {
    const ctx = JSON.parse(await runHook(dir)).hookSpecificOutput.additionalContext;
    expect(ctx).toContain("Você É Nicolas");
    expect(ctx).toContain("embark");
    expect(ctx).toContain("Pronto para receber demandas");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("opt-out presente em todos os estados", async () => {
  const dir = await makeWs({ phase: { brain: "done", workspace: "done", relationship: "done", generator: "done" } });
  try {
    const ctx = JSON.parse(await runHook(dir)).hookSpecificOutput.additionalContext;
    expect(ctx).toContain("sair do modo AIPe");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("CLAUDE_PROJECT_DIR vazio → {} (defesa)", async () => {
  const out = await runHook("");
  expect(out).toBe("{}");
});
```

- [ ] **Step 2: Rodar o teste e ver falhar**

Run: `cd ~/aipe && bun test src/session-hook/__tests__/session-start.test.ts`
Expected: FAIL — o hook `hooks/session-start` não existe (spawn falha / stdout vazio).

- [ ] **Step 3: Implementar `hooks/session-start`**

Create `hooks/session-start`:

```bash
#!/usr/bin/env bash
# SessionStart hook do plugin AIPe — injeta a "consciência" do coordenador.
set -euo pipefail

WORKSPACE="${CLAUDE_PROJECT_DIR:-}"
if [ -z "$WORKSPACE" ]; then
  printf '{}\n'
  exit 0
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$(cd "${SCRIPT_DIR}/.." && pwd)}"

# Parse robusto via bun; qualquer falha → campos vazios → estado 1.
fields="$(bun "${PLUGIN_ROOT}/src/session-hook/read-state.ts" --workspace "${WORKSPACE}" 2>/dev/null || true)"

get() { printf '%s\n' "$fields" | grep -m1 "^$1=" | cut -d= -f2- || true; }
BRAIN="$(get BRAIN)"
CONTEXT_NAME="$(get CONTEXT_NAME)"
COORDINATOR="$(get COORDINATOR)"
PHASE_WORKSPACE="$(get PHASE_WORKSPACE)"
PHASE_RELATIONSHIP="$(get PHASE_RELATIONSHIP)"
PHASE_GENERATOR="$(get PHASE_GENERATOR)"
REPOS="$(get REPOS)"

OPTOUT="Modo AIPe ativo por padrão. Se o PE pedir explicitamente para sair do modo AIPe, pare de seguir estas instruções nesta sessão."

if [ "$BRAIN" != "present" ]; then
  body="Workspace AIPe detectado, mas ainda sem brain.yaml. Rode /context-brain para mapear o contexto e começar. ${OPTOUT}"
elif [ "$PHASE_WORKSPACE" = "done" ] && [ "$PHASE_RELATIONSHIP" = "done" ] && [ "$PHASE_GENERATOR" = "done" ]; then
  body="Você É ${COORDINATOR}, coordenador do contexto ${CONTEXT_NAME}. Repos: ${REPOS}. Opere assim: decompõe as demandas do PE, contrata especialistas (teto de 16; a lei do mesmo-repo serializa, repos distintos rodam em paralelo), escala cross-repo ao PE, e cada especialista abre o PR final. Pronto para receber demandas. ${OPTOUT}"
else
  if [ "$PHASE_WORKSPACE" != "done" ]; then next="/make-workspace";
  elif [ "$PHASE_RELATIONSHIP" != "done" ]; then next="/relationship";
  else next="/context-brain-generator"; fi
  body="Contexto ${CONTEXT_NAME} em configuração. Coordenador: ${COORDINATOR} (em formação). Próximo passo: ${next}. Conduza o PE para completar o onboarding; ainda não opere como coordenador pleno. ${OPTOUT}"
fi

escape_for_json() {
  local s="$1"
  s="${s//\\/\\\\}"
  s="${s//\"/\\\"}"
  s="${s//$'\n'/\\n}"
  s="${s//$'\r'/\\r}"
  s="${s//$'\t'/\\t}"
  printf '%s' "$s"
}

escaped="$(escape_for_json "$body")"
printf '{\n  "hookSpecificOutput": {\n    "hookEventName": "SessionStart",\n    "additionalContext": "%s"\n  }\n}\n' "$escaped"
exit 0
```

Then make it executable:

```bash
chmod +x hooks/session-start
```

- [ ] **Step 4: Implementar `hooks/hooks.json`**

Create `hooks/hooks.json` (auto-descoberto pelo Claude Code no plugin root):

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "startup|resume|clear|compact",
        "hooks": [
          {
            "type": "command",
            "command": "\"${CLAUDE_PLUGIN_ROOT}/hooks/session-start\"",
            "async": false
          }
        ]
      }
    ]
  }
}
```

- [ ] **Step 5: Rodar o teste de fumaça e ver passar**

Run: `cd ~/aipe && bun test src/session-hook/__tests__/session-start.test.ts`
Expected: PASS (5 testes).

- [ ] **Step 6: Rodar a suíte inteira + type-check**

Run: `cd ~/aipe && bun test && bunx tsc --noEmit -p tsconfig.json`
Expected: todos passam; `tsc` 0 erros.

- [ ] **Step 7: Verificação manual do JSON emitido**

```bash
cd ~/aipe && MW=$(mktemp -d) && mkdir -p "$MW/.aipe" && cat > "$MW/.aipe/brain.yaml" <<'YAML'
context:
  name: opvibes
  coordinator: Nicolas
repos:
  - name: embark
    url: git@github.com:opvibes/embark.git
    path: ./embark
YAML
cat > "$MW/.aipe/state.yaml" <<'YAML'
phase:
  brain: done
  workspace: done
  relationship: done
  generator: done
YAML
CLAUDE_PROJECT_DIR="$MW" CLAUDE_PLUGIN_ROOT="$PWD" bash hooks/session-start | bun -e 'const t=await Bun.stdin.text(); JSON.parse(t); console.log("JSON válido:\n"+t)'
rm -rf "$MW"
```
Expected: imprime "JSON válido" seguido do objeto com `additionalContext` do coordenador pleno (contém "Você É Nicolas" e "embark").

- [ ] **Step 8: Commit**

```bash
cd ~/aipe && git add hooks/hooks.json hooks/session-start src/session-hook/__tests__/session-start.test.ts
git commit -m "feat: hook SessionStart que injeta o contexto do coordenador"
```

---

## Self-Review (autor do plano)

**Spec coverage:**
- §1 propósito/passivo → Tasks 1+2 (hook injeta, não decide).
- §2 ativação/detecção (raiz, `$CLAUDE_PROJECT_DIR`) + matcher → Task 2 (`hooks.json` matcher `startup|resume|clear|compact`; bash usa `$CLAUDE_PROJECT_DIR`).
- §3 bloco único em 3 estados + opt-out → Task 2 bash (switch BRAIN/fases; `OPTOUT` em todos) + testes de fumaça por estado.
- §4 componentes/contrato de saída `CHAVE=valor` → Task 1 (`formatFields`) + Task 2 (bash `get`).
- §5 robustez (sem brain→estado 1; malformado→degrada; state ausente→pending; `$CLAUDE_PROJECT_DIR` vazio→`{}`) → Task 1 (degradação testada) + Task 2 (teste `{}`).
- §6 testes → `read-state.test.ts` (7) + `session-start.test.ts` (5) + verificação manual.

**Placeholder scan:** sem TBD/TODO; todo passo traz código completo.

**Type consistency:** `Fields`/`readState`/`formatFields` definidos na Task 1 e consumidos pelo bash da Task 2 via contrato `CHAVE=valor`; `Phase` reusado de context-brain; chaves emitidas (`BRAIN`, `CONTEXT_NAME`, `COORDINATOR`, `PHASE_*`, `REPOS`) idênticas entre `formatFields` (Task 1) e os `get` do bash (Task 2).
