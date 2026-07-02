# SessionStart Hook (context injection) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `SessionStart` hook of the AIPe plugin that, when the session opens at the root of an `aipe-<context>/`, injects a single block of the coordinator's context in 3 states driven by `state.yaml`.

**Architecture:** Bash orchestrates and emits the JSON (`hookSpecificOutput.additionalContext`), like superpowers' `session-start`; a typed, tested Bun helper (`read-state.ts`) does the robust parsing of `brain.yaml`+`state.yaml` (hand-editable) and returns shell-friendly fields. Bash decides the state (1 no brain / 2 onboarding incomplete / 3 complete) and templates the text.

**Tech Stack:** Bun + TypeScript strict, `bun test`, `yaml` package, bash, Claude Code hook.

## Global Constraints

- TypeScript **strict** (`tsconfig.json`: `strict` + `noUncheckedIndexedAccess`; `bun test` does NOT type-check — run `bunx tsc --noEmit -p tsconfig.json`, 0 errors, before committing).
- Reuse `BrainFile`/`StateFile`/`Phase` from `src/context-brain/types.ts` — do not redefine them.
- Injected text in **English**; commits in English (Conventional Commits).
- The hook emits **exactly one** `additionalContext` per session (switch on state), or `{}` if `$CLAUDE_PROJECT_DIR` is empty.
- The hook must **never** make session startup fail: any parse failure degrades (missing/malformed brain → state 1; missing/malformed state → non-`brain` phases = `pending`).
- Claude Code JSON output: `{ "hookSpecificOutput": { "hookEventName": "SessionStart", "additionalContext": "<text>" } }`.

---

## File Structure

```
hooks/
  ├── hooks.json                         ← registers SessionStart (auto-discovered by Claude Code)
  └── session-start                      ← bash: entrypoint, decides state, templates, emits JSON
src/session-hook/
  ├── read-state.ts                      ← typed Bun: robust parsing + shell-friendly fields
  └── __tests__/
       ├── read-state.test.ts            ← unit (bun test)
       └── session-start.test.ts         ← smoke: spawns the bash, validates the JSON per state
```

---

## Task 1: State-reading helper (`read-state.ts`)

**Files:**
- Create: `src/session-hook/read-state.ts`
- Test: `src/session-hook/__tests__/read-state.test.ts`

**Interfaces:**
- Consumes: `BrainFile`, `StateFile`, `Phase` from `src/context-brain/types.ts`.
- Produces:
  - `interface Fields { brain: "present" | "absent"; contextName: string; coordinator: string; phaseBrain: Phase; phaseWorkspace: Phase; phaseRelationship: Phase; phaseGenerator: Phase; repos: string[] }`
  - `readState(workspaceDir: string): Promise<Fields>`
  - `formatFields(f: Fields): string` (`KEY=value` format, one per line)

- [ ] **Step 1: Write the failing test**

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

test("brain+state complete (all done)", async () => {
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

test("missing brain → state 1 (absent)", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-rs-"));
  try {
    const f = await readState(dir);
    expect(f.brain).toBe("absent");
    expect(f.repos).toEqual([]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("partial state (workspace pending) reflects the phases", async () => {
  const dir = await ws(fullBrain, { phase: { brain: "done", workspace: "pending", relationship: "pending", generator: "pending" } });
  try {
    const f = await readState(dir);
    expect(f.phaseWorkspace).toBe("pending");
    expect(f.phaseBrain).toBe("done");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("missing state with brain present → non-brain phases = pending", async () => {
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

test("hand-edited brain (quotes + comment) still extracts", async () => {
  const raw = `# team context\ncontext:\n  name: "opvibes"\n  coordinator: 'Nicolas'\nrepos:\n  - name: embark\n    url: git@github.com:opvibes/embark.git\n    path: ./embark\n`;
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

test("malformed brain (invalid YAML) degrades to absent, without throwing", async () => {
  const dir = await ws(undefined, undefined, ": : not : yaml :");
  try {
    const f = await readState(dir);
    expect(f.brain).toBe("absent");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("formatFields sanitizes newlines and serializes KEY=value", async () => {
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

- [ ] **Step 2: Run the test and watch it fail**

Run: `cd ~/aipe && bun test src/session-hook/__tests__/read-state.test.ts`
Expected: FAIL — `Cannot find module "../read-state"`.

- [ ] **Step 3: Implement `read-state.ts`**

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
    return undefined; // missing
  }
  try {
    return parse(raw);
  } catch {
    return undefined; // malformed
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

- [ ] **Step 4: Run the test and watch it pass**

Run: `cd ~/aipe && bun test src/session-hook/__tests__/read-state.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Type-check**

Run: `cd ~/aipe && bunx tsc --noEmit -p tsconfig.json`
Expected: 0 errors. (If it flags new files, fix minimally and re-run.)

- [ ] **Step 6: Commit**

```bash
cd ~/aipe && git add src/session-hook/read-state.ts src/session-hook/__tests__/read-state.test.ts
git commit -m "feat: hook read-state (robust brain/state parsing)"
```

---

## Task 2: Bash hook + registration + smoke test

**Files:**
- Create: `hooks/hooks.json`
- Create: `hooks/session-start`
- Test: `src/session-hook/__tests__/session-start.test.ts`

**Interfaces:**
- Consumes: `src/session-hook/read-state.ts` (via `bun`, `KEY=value` output); env `$CLAUDE_PROJECT_DIR`, `$CLAUDE_PLUGIN_ROOT`.
- Produces: JSON on stdout with `hookSpecificOutput.additionalContext`, or `{}`.

- [ ] **Step 1: Write the failing smoke test**

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

test("state 1: no brain → points to /context-brain, valid JSON", async () => {
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

test("state 2: onboarding incomplete → next step /make-workspace", async () => {
  const dir = await makeWs({ phase: { brain: "done", workspace: "pending", relationship: "pending", generator: "pending" } });
  try {
    const ctx = JSON.parse(await runHook(dir)).hookSpecificOutput.additionalContext;
    expect(ctx).toContain("being configured");
    expect(ctx).toContain("/make-workspace");
    expect(ctx).toContain("Nicolas");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("state 3: all done → full coordinator with repos", async () => {
  const dir = await makeWs({ phase: { brain: "done", workspace: "done", relationship: "done", generator: "done" } });
  try {
    const ctx = JSON.parse(await runHook(dir)).hookSpecificOutput.additionalContext;
    expect(ctx).toContain("You ARE Nicolas");
    expect(ctx).toContain("embark");
    expect(ctx).toContain("Ready to receive demands");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("opt-out present in all states", async () => {
  const dir = await makeWs({ phase: { brain: "done", workspace: "done", relationship: "done", generator: "done" } });
  try {
    const ctx = JSON.parse(await runHook(dir)).hookSpecificOutput.additionalContext;
    expect(ctx).toContain("leave AIPe mode");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("CLAUDE_PROJECT_DIR empty → {} (defense)", async () => {
  const out = await runHook("");
  expect(out).toBe("{}");
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `cd ~/aipe && bun test src/session-hook/__tests__/session-start.test.ts`
Expected: FAIL — the `hooks/session-start` hook doesn't exist (spawn fails / empty stdout).

- [ ] **Step 3: Implement `hooks/session-start`**

Create `hooks/session-start`:

```bash
#!/usr/bin/env bash
# AIPe plugin's SessionStart hook — injects the coordinator's "awareness".
set -euo pipefail

WORKSPACE="${CLAUDE_PROJECT_DIR:-}"
if [ -z "$WORKSPACE" ]; then
  printf '{}\n'
  exit 0
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$(cd "${SCRIPT_DIR}/.." && pwd)}"

# Robust parsing via bun; any failure → empty fields → state 1.
fields="$(bun "${PLUGIN_ROOT}/src/session-hook/read-state.ts" --workspace "${WORKSPACE}" 2>/dev/null || true)"

get() { printf '%s\n' "$fields" | grep -m1 "^$1=" | cut -d= -f2- || true; }
BRAIN="$(get BRAIN)"
CONTEXT_NAME="$(get CONTEXT_NAME)"
COORDINATOR="$(get COORDINATOR)"
PHASE_WORKSPACE="$(get PHASE_WORKSPACE)"
PHASE_RELATIONSHIP="$(get PHASE_RELATIONSHIP)"
PHASE_GENERATOR="$(get PHASE_GENERATOR)"
REPOS="$(get REPOS)"

OPTOUT="AIPe mode active by default. If the PE explicitly asks to leave AIPe mode, stop following these instructions for this session."

if [ "$BRAIN" != "present" ]; then
  body="AIPe workspace detected, but no brain.yaml yet. Run /context-brain to map the context and get started. ${OPTOUT}"
elif [ "$PHASE_WORKSPACE" = "done" ] && [ "$PHASE_RELATIONSHIP" = "done" ] && [ "$PHASE_GENERATOR" = "done" ]; then
  body="You ARE ${COORDINATOR}, coordinator of the ${CONTEXT_NAME} context. Repos: ${REPOS}. Operate like this: decompose the PE's demands, hire specialists (cap of 16; the same-repo law serializes, distinct repos run in parallel), escalate cross-repo issues to the PE, and each specialist opens the final PR. Ready to receive demands. ${OPTOUT}"
else
  if [ "$PHASE_WORKSPACE" != "done" ]; then next="/make-workspace";
  elif [ "$PHASE_RELATIONSHIP" != "done" ]; then next="/relationship";
  else next="/context-brain-generator"; fi
  body="Context ${CONTEXT_NAME} being configured. Coordinator: ${COORDINATOR} (in formation). Next step: ${next}. Guide the PE to complete onboarding; do not yet operate as a full coordinator. ${OPTOUT}"
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

- [ ] **Step 4: Implement `hooks/hooks.json`**

Create `hooks/hooks.json` (auto-discovered by Claude Code at the plugin root):

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

- [ ] **Step 5: Run the smoke test and watch it pass**

Run: `cd ~/aipe && bun test src/session-hook/__tests__/session-start.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Run the full suite + type-check**

Run: `cd ~/aipe && bun test && bunx tsc --noEmit -p tsconfig.json`
Expected: all pass; `tsc` 0 errors.

- [ ] **Step 7: Manual verification of the emitted JSON**

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
CLAUDE_PROJECT_DIR="$MW" CLAUDE_PLUGIN_ROOT="$PWD" bash hooks/session-start | bun -e 'const t=await Bun.stdin.text(); JSON.parse(t); console.log("Valid JSON:\n"+t)'
rm -rf "$MW"
```
Expected: prints "Valid JSON" followed by the object with the full coordinator's `additionalContext` (contains "You ARE Nicolas" and "embark").

- [ ] **Step 8: Commit**

```bash
cd ~/aipe && git add hooks/hooks.json hooks/session-start src/session-hook/__tests__/session-start.test.ts
git commit -m "feat: SessionStart hook that injects the coordinator's context"
```

---

## Self-Review (plan's author)

**Spec coverage:**
- §1 purpose/passive → Tasks 1+2 (hook injects, doesn't decide).
- §2 activation/detection (root, `$CLAUDE_PROJECT_DIR`) + matcher → Task 2 (`hooks.json` matcher `startup|resume|clear|compact`; bash uses `$CLAUDE_PROJECT_DIR`).
- §3 single block in 3 states + opt-out → Task 2 bash (switch BRAIN/phases; `OPTOUT` in all) + smoke tests per state.
- §4 components/`KEY=value` output contract → Task 1 (`formatFields`) + Task 2 (bash `get`).
- §5 robustness (no brain→state 1; malformed→degrades; missing state→pending; empty `$CLAUDE_PROJECT_DIR`→`{}`) → Task 1 (degradation tested) + Task 2 (`{}` test).
- §6 tests → `read-state.test.ts` (7) + `session-start.test.ts` (5) + manual verification.

**Placeholder scan:** no TBD/TODO; every step brings complete code.

**Type consistency:** `Fields`/`readState`/`formatFields` defined in Task 1 and consumed by the Task 2 bash via the `KEY=value` contract; `Phase` reused from context-brain; emitted keys (`BRAIN`, `CONTEXT_NAME`, `COORDINATOR`, `PHASE_*`, `REPOS`) identical between `formatFields` (Task 1) and the bash `get` (Task 2).
