# /context-brain Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build AIPe's `/context-brain` skill: interactive collection of context (a team's repos) and deterministic writing of `.aipe/brain.yaml` + `.aipe/state.yaml`.

**Architecture:** The skill separates two responsibilities. The **conversational layer** (`SKILL.md`) collects data from the PE (context name, coordinator name, list of repos). The **deterministic layer** is a Bun/TypeScript CLI that receives the collected data as JSON, **validates** it (URLs, paths, duplicates) and **serializes** it to well-formed YAML. The model never writes YAML by hand — this eliminates format hallucination.

**Tech Stack:** Bun, TypeScript (strict), the `yaml` package for serialization, `bun test` for tests.

## Global Constraints

- **Runtime:** Bun. All scripts run with `bun`; tests with `bun test`.
- **TypeScript strict:** `strict: true` in tsconfig. No implicit `any`.
- **Language:** user-facing messages (validation, skill prompts) in **English**. Commits in English, Conventional Commits.
- **Output format:** YAML, written to `<workspace>/.aipe/`. `brain.yaml` and `state.yaml`.
- **Workspace naming convention:** the context folder is named `aipe-<context.name>`; `context.name` is a slug (lowercase, numbers, hyphens).
- **Repo paths:** relative to the workspace, starting with `./`.

---

## File Structure

```
~/aipe/
  package.json                              # Bun project + deps (yaml, @types/bun)
  tsconfig.json                             # TS strict
  .claude-plugin/plugin.json                # AIPe plugin manifest
  skills/context-brain/SKILL.md             # interactive skill (conversational layer)
  src/context-brain/
    types.ts                                # types: BrainFile, RepoEntry, StateFile, ContextInput, ValidationResult
    validate.ts                             # validateContext(input): ValidationResult
    write.ts                                # writeBrainFiles(dir, brain), initialState()
    init.ts                                 # initContextBrain(input, dir): InitResult  (validates + writes)
    cli.ts                                  # entry point: reads JSON (file/stdin) → initContextBrain → prints result
    __tests__/
      validate.test.ts
      write.test.ts
      init.test.ts
      cli.test.ts
```

Responsibility per file:
- `types.ts` — single type contract, imported by everything else.
- `validate.ts` — pure rules, no I/O. Easy to test.
- `write.ts` — disk I/O (mkdir + YAML serialization). No business rules.
- `init.ts` — orchestrates validate → write. It's the module's public API.
- `cli.ts` — argument/stdin parsing. Thin; delegates to `init.ts`.
- `SKILL.md` — talks to the PE, assembles the JSON, calls the CLI, handles validation errors.

---

## Task 1: Project scaffold + types

**Files:**
- Create: `package.json`, `tsconfig.json`
- Create: `src/context-brain/types.ts`
- Test: `src/context-brain/__tests__/types.test.ts`

**Interfaces:**
- Produces: the types `RepoEntry`, `ContextMeta`, `BrainFile`, `StateFile`, `ContextInput`, `ValidationError`, `ValidationResult` — consumed by every following task.

- [ ] **Step 1: Initialize the Bun project and dependencies**

Run:
```bash
cd ~/aipe && bun init -y && bun add yaml && bun add -d @types/bun
```

- [ ] **Step 2: Write `tsconfig.json`**

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

- [ ] **Step 3: Write the types in `src/context-brain/types.ts`**

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

- [ ] **Step 4: Write a sanity test in `src/context-brain/__tests__/types.test.ts`**

```typescript
import { expect, test } from "bun:test";
import type { BrainFile } from "../types";

test("BrainFile accepts a well-formed context", () => {
  const brain: BrainFile = {
    context: { name: "opvibes", coordinator: "Nicolas" },
    repos: [{ name: "embark", url: "git@github.com:opvibes/embark.git", path: "./embark" }],
  };
  expect(brain.repos.length).toBe(1);
});
```

- [ ] **Step 5: Run the test**

Run: `cd ~/aipe && bun test src/context-brain/__tests__/types.test.ts`
Expected: PASS (1 test)

- [ ] **Step 6: Commit**

```bash
cd ~/aipe && git add -A && git commit -m "chore: scaffold bun project and context-brain types"
```

---

## Task 2: Validation

**Files:**
- Create: `src/context-brain/validate.ts`
- Test: `src/context-brain/__tests__/validate.test.ts`

**Interfaces:**
- Consumes: `ContextInput`, `ValidationResult`, `ValidationError` from `types.ts`.
- Produces: `validateContext(input: ContextInput): ValidationResult`.

- [ ] **Step 1: Write the failing tests in `src/context-brain/__tests__/validate.test.ts`**

```typescript
import { expect, test } from "bun:test";
import { validateContext } from "../validate";
import type { ContextInput } from "../types";

const base: ContextInput = {
  context: { name: "opvibes", coordinator: "Nicolas" },
  repos: [{ name: "embark", url: "git@github.com:opvibes/embark.git", path: "./embark" }],
};

test("accepts a valid input", () => {
  expect(validateContext(base)).toEqual({ ok: true });
});

test("rejects a context name that is not a slug", () => {
  const r = validateContext({ ...base, context: { name: "Op Vibes", coordinator: "Nicolas" } });
  expect(r.ok).toBe(false);
});

test("rejects an empty coordinator", () => {
  const r = validateContext({ ...base, context: { name: "opvibes", coordinator: "" } });
  expect(r.ok).toBe(false);
});

test("rejects an empty repo list", () => {
  const r = validateContext({ ...base, repos: [] });
  expect(r.ok).toBe(false);
});

test("rejects an invalid repo url", () => {
  const r = validateContext({ ...base, repos: [{ name: "x", url: "not-a-url", path: "./x" }] });
  expect(r.ok).toBe(false);
});

test("rejects a path that does not start with ./", () => {
  const r = validateContext({ ...base, repos: [{ name: "x", url: "git@github.com:o/x.git", path: "x" }] });
  expect(r.ok).toBe(false);
});

test("rejects duplicate repo names", () => {
  const r = validateContext({
    ...base,
    repos: [
      { name: "dup", url: "git@github.com:o/a.git", path: "./a" },
      { name: "dup", url: "git@github.com:o/b.git", path: "./b" },
    ],
  });
  expect(r.ok).toBe(false);
});

test("rejects duplicate paths", () => {
  const r = validateContext({
    ...base,
    repos: [
      { name: "a", url: "git@github.com:o/a.git", path: "./same" },
      { name: "b", url: "git@github.com:o/b.git", path: "./same" },
    ],
  });
  expect(r.ok).toBe(false);
});

test("accepts an https url with .git", () => {
  const r = validateContext({ ...base, repos: [{ name: "x", url: "https://github.com/o/x.git", path: "./x" }] });
  expect(r.ok).toBe(true);
});
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `cd ~/aipe && bun test src/context-brain/__tests__/validate.test.ts`
Expected: FAIL ("Cannot find module '../validate'")

- [ ] **Step 3: Implement `src/context-brain/validate.ts`**

```typescript
import type { ContextInput, ValidationError, ValidationResult } from "./types";

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const GIT_URL = /^(git@[\w.-]+:[\w./-]+\.git|https?:\/\/[\w.-]+\/[\w./-]+?(?:\.git)?)$/;

export function validateContext(input: ContextInput): ValidationResult {
  const errors: ValidationError[] = [];

  const name = input.context?.name?.trim() ?? "";
  if (!name) {
    errors.push({ field: "context.name", message: "context name is required" });
  } else if (!SLUG.test(name)) {
    errors.push({ field: "context.name", message: "use lowercase letters, numbers and hyphens (becomes aipe-<name>)" });
  }

  if (!input.context?.coordinator?.trim()) {
    errors.push({ field: "context.coordinator", message: "coordinator name is required" });
  }

  const repos = input.repos ?? [];
  if (repos.length === 0) {
    errors.push({ field: "repos", message: "provide at least one repository" });
  }

  const seenNames = new Set<string>();
  const seenPaths = new Set<string>();
  repos.forEach((repo, i) => {
    const at = `repos[${i}]`;
    const rName = repo.name?.trim() ?? "";
    if (!rName) {
      errors.push({ field: `${at}.name`, message: "repo name is required" });
    } else if (seenNames.has(rName)) {
      errors.push({ field: `${at}.name`, message: `duplicate name: ${rName}` });
    } else {
      seenNames.add(rName);
    }

    const url = repo.url?.trim() ?? "";
    if (!url) {
      errors.push({ field: `${at}.url`, message: "url is required" });
    } else if (!GIT_URL.test(url)) {
      errors.push({ field: `${at}.url`, message: `invalid url: ${url}` });
    }

    const path = repo.path?.trim() ?? "";
    if (!path) {
      errors.push({ field: `${at}.path`, message: "path is required" });
    } else if (!path.startsWith("./")) {
      errors.push({ field: `${at}.path`, message: "path must be relative to the workspace (start with ./)" });
    } else if (seenPaths.has(path)) {
      errors.push({ field: `${at}.path`, message: `duplicate path: ${path}` });
    } else {
      seenPaths.add(path);
    }
  });

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}
```

- [ ] **Step 4: Run the tests to confirm they pass**

Run: `cd ~/aipe && bun test src/context-brain/__tests__/validate.test.ts`
Expected: PASS (9 tests)

- [ ] **Step 5: Commit**

```bash
cd ~/aipe && git add -A && git commit -m "feat: validate context-brain input"
```

---

## Task 3: Writing the YAML files

**Files:**
- Create: `src/context-brain/write.ts`
- Test: `src/context-brain/__tests__/write.test.ts`

**Interfaces:**
- Consumes: `BrainFile`, `StateFile` from `types.ts`; `stringify` from `yaml`.
- Produces: `initialState(): StateFile` and `writeBrainFiles(workspaceDir: string, brain: BrainFile): Promise<{ brainPath: string; statePath: string }>`.

- [ ] **Step 1: Write the failing tests in `src/context-brain/__tests__/write.test.ts`**

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

test("initialState marks brain as done and the rest as pending", () => {
  expect(initialState()).toEqual({
    phase: { brain: "done", workspace: "pending", relationship: "pending", generator: "pending" },
  });
});

test("writes brain.yaml and state.yaml in .aipe and they are valid YAML", async () => {
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

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `cd ~/aipe && bun test src/context-brain/__tests__/write.test.ts`
Expected: FAIL ("Cannot find module '../write'")

- [ ] **Step 3: Implement `src/context-brain/write.ts`**

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

- [ ] **Step 4: Run the tests to confirm they pass**

Run: `cd ~/aipe && bun test src/context-brain/__tests__/write.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
cd ~/aipe && git add -A && git commit -m "feat: write brain.yaml and state.yaml"
```

---

## Task 4: Orchestration (validate + write)

**Files:**
- Create: `src/context-brain/init.ts`
- Test: `src/context-brain/__tests__/init.test.ts`

**Interfaces:**
- Consumes: `validateContext` from `validate.ts`; `writeBrainFiles` from `write.ts`; `ContextInput` from `types.ts`.
- Produces: `initContextBrain(input: ContextInput, workspaceDir: string): Promise<InitResult>` where
  `InitResult = { ok: true; brainPath: string; statePath: string } | { ok: false; errors: ValidationError[] }`.

- [ ] **Step 1: Write the failing tests in `src/context-brain/__tests__/init.test.ts`**

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

test("invalid input returns errors and writes nothing", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-"));
  try {
    const r = await initContextBrain({ ...valid, repos: [] }, dir);
    expect(r.ok).toBe(false);
    await expect(stat(join(dir, ".aipe"))).rejects.toThrow();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("valid input writes the files and returns the paths", async () => {
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

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `cd ~/aipe && bun test src/context-brain/__tests__/init.test.ts`
Expected: FAIL ("Cannot find module '../init'")

- [ ] **Step 3: Implement `src/context-brain/init.ts`**

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

- [ ] **Step 4: Run the tests to confirm they pass**

Run: `cd ~/aipe && bun test src/context-brain/__tests__/init.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
cd ~/aipe && git add -A && git commit -m "feat: initContextBrain orchestration (validate + write)"
```

---

## Task 5: CLI

**Files:**
- Create: `src/context-brain/cli.ts`
- Test: `src/context-brain/__tests__/cli.test.ts`

**Interfaces:**
- Consumes: `initContextBrain` from `init.ts`; `ContextInput` from `types.ts`.
- Behavior: `bun src/context-brain/cli.ts --input <file.json> --workspace <dir>`. If `--workspace` is omitted, uses `process.cwd()`. Reads the JSON from the file (`--input`) or from stdin if `--input` is absent. On success, prints lines `OK brain=<path>` and `OK state=<path>` and exits with code 0. On validation error, prints each error as `ERROR <field>: <message>` and exits with code 1.

- [ ] **Step 1: Write the failing test in `src/context-brain/__tests__/cli.test.ts`**

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

test("CLI writes the files and exits 0 on valid input", async () => {
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

test("CLI exits 1 and prints errors on invalid input", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-"));
  try {
    const { exitCode, stdout } = await runCli(
      { context: { name: "opvibes", coordinator: "Nicolas" }, repos: [] },
      dir,
    );
    expect(exitCode).toBe(1);
    expect(stdout).toContain("ERROR repos:");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `cd ~/aipe && bun test src/context-brain/__tests__/cli.test.ts`
Expected: FAIL ("Cannot find module '../cli'" or process without the expected output)

- [ ] **Step 3: Implement `src/context-brain/cli.ts`**

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
      console.log(`ERROR ${e.field}: ${e.message}`);
    }
    return 1;
  }
  console.log(`OK brain=${result.brainPath}`);
  console.log(`OK state=${result.statePath}`);
  return 0;
}

main().then((code) => process.exit(code));
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `cd ~/aipe && bun test src/context-brain/__tests__/cli.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Run the full suite**

Run: `cd ~/aipe && bun test`
Expected: PASS (all tests from tasks 1-5)

- [ ] **Step 6: Commit**

```bash
cd ~/aipe && git add -A && git commit -m "feat: context-brain cli"
```

---

## Task 6: Interactive skill + plugin manifest

**Files:**
- Create: `skills/context-brain/SKILL.md`
- Create: `.claude-plugin/plugin.json`

**Interfaces:**
- Consumes: the CLI `src/context-brain/cli.ts` (Task 5's contract).
- Produces: the invocable `/context-brain` skill and the AIPe plugin manifest.

- [ ] **Step 1: Write the manifest `.claude-plugin/plugin.json`**

```json
{
  "name": "aipe",
  "version": "0.1.0",
  "description": "AI Product Engineer — general multi-repo engineering coordinator"
}
```

- [ ] **Step 2: Write the skill `skills/context-brain/SKILL.md`**

````markdown
---
name: context-brain
description: Use during onboarding of an AIPe context/team to map the repositories (URLs, paths, stacks) and write .aipe/brain.yaml + .aipe/state.yaml. Does not clone or analyze code — only records factual knowledge.
---

# /context-brain

Interactive collection of a team's context and deterministic writing of the brain file.
You (coordinator) do NOT write the YAML by hand — collect the data from the PE and delegate
the writing to the typed CLI, which validates and serializes it.

## Flow

1. **Confirm the workspace.** The brain is written to `<workspace>/.aipe/`. By default the
   workspace is the current directory. Confirm with the PE whether this is the right place
   (it should be an `aipe-<context>` folder).

2. **Collect the data, one question at a time:**
   - **Context** name (slug: lowercase, numbers, hyphens — becomes `aipe-<name>`).
   - **Coordinator** name (how the PE wants to be addressed).
   - The **repositories**: for each one, `name`, `url` (git@ or https .git) and a
     relative `path` (starting with `./`). `stack` is optional — only fill it in if the
     PE knows it; otherwise leave it out (it will be filled in during later phases). The
     PE may paste a whole list at once.

3. **Assemble the JSON** in `ContextInput` format:
   ```json
   {
     "context": { "name": "<slug>", "coordinator": "<name>" },
     "repos": [ { "name": "...", "url": "...", "path": "./...", "stack": ["..."] } ]
   }
   ```

4. **Write via the CLI.** Write the JSON to a temporary file and run:
   ```bash
   bun <plugin-path>/src/context-brain/cli.ts --input <file.json> --workspace <workspace>
   ```

5. **Handle the result:**
   - Output `OK brain=... / OK state=...` → confirm to the PE that the files were written.
   - Lines `ERROR <field>: <message>` → show them to the PE, fix the flagged data and
     run it again. Never write anything by hand.

## Rules

- Never edit `brain.yaml`/`state.yaml` directly here — always go through the CLI, to
  guarantee a valid format.
- One question at a time; don't dump them all at once.
- If the workspace doesn't exist or doesn't look like an `aipe-<context>`, ask before
  writing.
````

- [ ] **Step 3: Manual verification of the skill**

Run:
```bash
cd /tmp && rm -rf aipe-teste && mkdir aipe-teste && cd aipe-teste \
  && printf '{"context":{"name":"teste","coordinator":"Nicolas"},"repos":[{"name":"embark","url":"git@github.com:opvibes/embark.git","path":"./embark"}]}' > input.json \
  && bun ~/aipe/src/context-brain/cli.ts --input input.json --workspace . \
  && echo "--- brain.yaml ---" && cat .aipe/brain.yaml && echo "--- state.yaml ---" && cat .aipe/state.yaml
```
Expected: prints `OK brain=... / OK state=...` followed by the YAML content of both files, with `phase.brain: done`.

- [ ] **Step 4: Commit**

```bash
cd ~/aipe && git add -A && git commit -m "feat: /context-brain skill and aipe plugin manifest"
```

---

## Execution notes

- **`import.meta.dir`** (used in the CLI test) is a Bun API that resolves the directory
  of the test file; combines with the `../cli.ts` path.
- **Stack detection** is out of scope for this plan (it's the responsibility of a later
  phase, once the code has been cloned). `stack` is optional in the brain.
- **Plugin distribution** (publishing, installing at global/project scope) is a separate
  concern from the roadmap; here the minimal manifest already makes the plugin loadable
  locally.
