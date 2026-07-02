# /make-workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Materialize (clone) on the machine all repos declared in an AIPe workspace's `brain.yaml`, idempotently and non-destructively, updating `state.yaml`.

**Architecture:** Same pattern as `/context-brain`: a conversational **skill** orchestrates and a **typed CLI** (`src/make-workspace/cli.ts`) does the deterministic work. The CLI reads+validates the brain, decides per repo (clone / skip / error) via an injectable **cloner** and **inspector** (real git sits behind that boundary, to test without network), aggregates the `workspace` phase, and writes it to `state.yaml` while preserving the other phases.

**Tech Stack:** Bun + TypeScript strict, `bun test`, `yaml` package, git via `Bun.spawn`.

## Global Constraints

- TypeScript **strict** (inherits the repo's `tsconfig.json`).
- Tests with `bun test` (import `{ expect, test } from "bun:test"`).
- YAML serialization/parsing via the `yaml` package (`parse`/`stringify`).
- Reuse the `BrainFile`, `RepoEntry`, `StateFile`, `Phase` types from `src/context-brain/types.ts` — **do not** redefine them.
- **Never** overwrite/delete existing repos; `git clone` uses the user's already-configured credentials, no interactive prompt.
- Messages to the user in **English**; commits in English following Conventional Commits.
- `state.phase.workspace` only becomes `done` if **all** repos are `cloned` or `skipped`; any `error` → `pending`.

---

## File Structure

```
src/make-workspace/
  ├── types.ts        # per-repo result types; re-export of BrainFile/RepoEntry
  ├── read.ts         # readBrain(): reads + validates <ws>/.aipe/brain.yaml
  ├── clone.ts        # remotesMatch + materializeRepo (per-repo decision, injectable)
  ├── state.ts        # updateWorkspacePhase(): updates state.yaml preserving phases
  ├── run.ts          # makeWorkspace(): orchestrates reading → materialization → state
  ├── git.ts          # real adapters (Inspector/Cloner) via Bun.spawn
  ├── cli.ts          # flag parsing, wiring with real git, renderReport (pure)
  └── __tests__/
       ├── read.test.ts
       ├── clone.test.ts
       ├── state.test.ts
       ├── run.test.ts
       └── cli.test.ts
skills/make-workspace/SKILL.md
```

---

## Task 1: Types + brain reading/validation

**Files:**
- Create: `src/make-workspace/types.ts`
- Create: `src/make-workspace/read.ts`
- Test: `src/make-workspace/__tests__/read.test.ts`

**Interfaces:**
- Consumes: `BrainFile`, `RepoEntry` from `src/context-brain/types.ts`.
- Produces:
  - `type RepoStatus = "cloned" | "skipped" | "error"`
  - `interface RepoResult { name: string; status: RepoStatus; message?: string }`
  - `type WorkspacePhase = "pending" | "done"`
  - `type ReadBrainResult = { ok: true; brain: BrainFile } | { ok: false; error: string }`
  - `readBrain(workspaceDir: string): Promise<ReadBrainResult>`

- [ ] **Step 1: Write the types**

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

- [ ] **Step 2: Write the failing test**

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

test("reads and validates a well-formed brain.yaml", async () => {
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

test("errors when brain.yaml does not exist", async () => {
  const dir = await makeWorkspaceDir();
  try {
    const result = await readBrain(dir);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("brain.yaml");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("errors when YAML is malformed", async () => {
  const dir = await makeWorkspaceDir(": : : not yaml :");
  try {
    const result = await readBrain(dir);
    expect(result.ok).toBe(false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("errors when repos is missing or empty", async () => {
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

- [ ] **Step 3: Run the test and watch it fail**

Run: `cd ~/aipe && bun test src/make-workspace/__tests__/read.test.ts`
Expected: FAIL — `Cannot find module "../read"`.

- [ ] **Step 4: Implement `read.ts`**

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
  if (typeof repo !== "object" || repo === null) return `repos[${index}]: expected an object`;
  const r = repo as Record<string, unknown>;
  if (!isNonEmptyString(r.name)) return `repos[${index}].name: required`;
  if (!isNonEmptyString(r.url)) return `repos[${index}].url: required`;
  if (!isNonEmptyString(r.path)) return `repos[${index}].path: required`;
  return null;
}

export async function readBrain(workspaceDir: string): Promise<ReadBrainResult> {
  const brainPath = join(workspaceDir, ".aipe", "brain.yaml");
  let raw: string;
  try {
    raw = await readFile(brainPath, "utf8");
  } catch {
    return { ok: false, error: `brain.yaml not found at ${brainPath}. Run /context-brain first.` };
  }

  let parsed: unknown;
  try {
    parsed = parse(raw);
  } catch {
    return { ok: false, error: "brain.yaml: invalid YAML" };
  }

  if (typeof parsed !== "object" || parsed === null) {
    return { ok: false, error: "brain.yaml: expected an object" };
  }
  const obj = parsed as Record<string, unknown>;

  const context = obj.context as Record<string, unknown> | undefined;
  if (!context || !isNonEmptyString(context.name) || !isNonEmptyString(context.coordinator)) {
    return { ok: false, error: "brain.yaml: context.name/context.coordinator required" };
  }

  if (!Array.isArray(obj.repos) || obj.repos.length === 0) {
    return { ok: false, error: "brain.yaml: repos missing or empty" };
  }
  for (let i = 0; i < obj.repos.length; i++) {
    const err = validateRepo(obj.repos[i], i);
    if (err) return { ok: false, error: `brain.yaml: ${err}` };
  }

  return { ok: true, brain: { context: context as BrainFile["context"], repos: obj.repos as RepoEntry[] } };
}
```

- [ ] **Step 5: Run the test and watch it pass**

Run: `cd ~/aipe && bun test src/make-workspace/__tests__/read.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
cd ~/aipe && git add src/make-workspace/types.ts src/make-workspace/read.ts src/make-workspace/__tests__/read.test.ts
git commit -m "feat: brain reading and validation in make-workspace"
```

---

## Task 2: Per-repo decision (`clone.ts`)

**Files:**
- Create: `src/make-workspace/clone.ts`
- Test: `src/make-workspace/__tests__/clone.test.ts`

**Interfaces:**
- Consumes: `RepoEntry`, `RepoResult` from `./types`.
- Produces:
  - `interface RepoInspection { exists: boolean; isGitRepo: boolean; remote?: string }`
  - `type Inspector = (absPath: string) => Promise<RepoInspection>`
  - `type Cloner = (url: string, absPath: string) => Promise<{ ok: true } | { ok: false; message: string }>`
  - `remotesMatch(a: string, b: string): boolean`
  - `materializeRepo(repo: RepoEntry, workspaceDir: string, inspect: Inspector, clone: Cloner): Promise<RepoResult>`

- [ ] **Step 1: Write the failing test**

Create `src/make-workspace/__tests__/clone.test.ts`:

```ts
import { expect, test } from "bun:test";
import { join } from "node:path";
import { materializeRepo, remotesMatch, type Inspector, type Cloner } from "../clone";
import type { RepoEntry } from "../types";

const repo: RepoEntry = { name: "embark", url: "git@github.com:opvibes/embark.git", path: "./embark" };
const ws = "/tmp/ws";

test("remotesMatch normalizes ssh vs https and the .git suffix", () => {
  expect(remotesMatch("git@github.com:opvibes/embark.git", "https://github.com/opvibes/embark")).toBe(true);
  expect(remotesMatch("git@github.com:opvibes/embark.git", "git@github.com:opvibes/outro.git")).toBe(false);
});

test("nonexistent path → clones", async () => {
  const inspect: Inspector = async () => ({ exists: false, isGitRepo: false });
  let clonedTo = "";
  const clone: Cloner = async (_url, absPath) => { clonedTo = absPath; return { ok: true }; };
  const res = await materializeRepo(repo, ws, inspect, clone);
  expect(res.status).toBe("cloned");
  expect(clonedTo).toBe(join(ws, "embark"));
});

test("path present with same remote → skipped, no clone", async () => {
  const inspect: Inspector = async () => ({ exists: true, isGitRepo: true, remote: "https://github.com/opvibes/embark" });
  let called = false;
  const clone: Cloner = async () => { called = true; return { ok: true }; };
  const res = await materializeRepo(repo, ws, inspect, clone);
  expect(res.status).toBe("skipped");
  expect(called).toBe(false);
});

test("path present but not git → error, no clone", async () => {
  const inspect: Inspector = async () => ({ exists: true, isGitRepo: false });
  let called = false;
  const clone: Cloner = async () => { called = true; return { ok: true }; };
  const res = await materializeRepo(repo, ws, inspect, clone);
  expect(res.status).toBe("error");
  expect(res.message).toContain("occupied");
  expect(called).toBe(false);
});

test("path present with divergent remote → error, no clone", async () => {
  const inspect: Inspector = async () => ({ exists: true, isGitRepo: true, remote: "git@github.com:outro/repo.git" });
  let called = false;
  const clone: Cloner = async () => { called = true; return { ok: true }; };
  const res = await materializeRepo(repo, ws, inspect, clone);
  expect(res.status).toBe("error");
  expect(called).toBe(false);
});

test("cloner failure → error with the git message", async () => {
  const inspect: Inspector = async () => ({ exists: false, isGitRepo: false });
  const clone: Cloner = async () => ({ ok: false, message: "Permission denied (publickey)" });
  const res = await materializeRepo(repo, ws, inspect, clone);
  expect(res.status).toBe("error");
  expect(res.message).toContain("Permission denied");
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `cd ~/aipe && bun test src/make-workspace/__tests__/clone.test.ts`
Expected: FAIL — `Cannot find module "../clone"`.

- [ ] **Step 3: Implement `clone.ts`**

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
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//i, ""); // strip protocol (https://, ssh://)
  s = s.replace(/^[^@/]+@/, ""); // strip user@ (git@host)
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
    return { name: repo.name, status: "skipped", message: "already present" };
  }

  return {
    name: repo.name,
    status: "error",
    message: `path occupied by different content (${repo.path})`,
  };
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `cd ~/aipe && bun test src/make-workspace/__tests__/clone.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
cd ~/aipe && git add src/make-workspace/clone.ts src/make-workspace/__tests__/clone.test.ts
git commit -m "feat: per-repo decision (clone/skip/error) in make-workspace"
```

---

## Task 3: `state.yaml` update (`state.ts`)

**Files:**
- Create: `src/make-workspace/state.ts`
- Test: `src/make-workspace/__tests__/state.test.ts`

**Interfaces:**
- Consumes: `StateFile`, `Phase` from `../context-brain/types`; `initialState` from `../context-brain/write`.
- Produces: `updateWorkspacePhase(workspaceDir: string, phase: Phase): Promise<string>` (returns the path of the written state).

- [ ] **Step 1: Write the failing test**

Create `src/make-workspace/__tests__/state.test.ts`:

```ts
import { expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse, stringify } from "yaml";
import { updateWorkspacePhase } from "../state";

test("updates workspace preserving the other phases", async () => {
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

test("creates state from the default if missing", async () => {
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

- [ ] **Step 2: Run the test and watch it fail**

Run: `cd ~/aipe && bun test src/make-workspace/__tests__/state.test.ts`
Expected: FAIL — `Cannot find module "../state"`.

- [ ] **Step 3: Implement `state.ts`**

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
    // no prior state: start from the default
  }

  state.phase.workspace = phase;
  await mkdir(aipeDir, { recursive: true });
  await writeFile(statePath, stringify(state), "utf8");
  return statePath;
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `cd ~/aipe && bun test src/make-workspace/__tests__/state.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
cd ~/aipe && git add src/make-workspace/state.ts src/make-workspace/__tests__/state.test.ts
git commit -m "feat: workspace phase update in state.yaml"
```

---

## Task 4: Orchestration (`run.ts`)

**Files:**
- Create: `src/make-workspace/run.ts`
- Test: `src/make-workspace/__tests__/run.test.ts`

**Interfaces:**
- Consumes: `readBrain` (`./read`), `materializeRepo`/`Inspector`/`Cloner` (`./clone`), `updateWorkspacePhase` (`./state`), `RepoResult`/`WorkspacePhase` (`./types`).
- Produces:
  - `type RunResult = { ok: true; results: RepoResult[]; phase: WorkspacePhase } | { ok: false; error: string }`
  - `makeWorkspace(workspaceDir: string, deps: { inspect: Inspector; clone: Cloner }): Promise<RunResult>`

- [ ] **Step 1: Write the failing test**

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

test("all clone → phase done and state.workspace=done", async () => {
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

test("one error → phase pending and state.workspace=pending", async () => {
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

test("missing brain → ok:false, state untouched", async () => {
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

test("brain.yaml is not modified by the execution", async () => {
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

- [ ] **Step 2: Run the test and watch it fail**

Run: `cd ~/aipe && bun test src/make-workspace/__tests__/run.test.ts`
Expected: FAIL — `Cannot find module "../run"`.

- [ ] **Step 3: Implement `run.ts`**

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

- [ ] **Step 4: Run the test and watch it pass**

Run: `cd ~/aipe && bun test src/make-workspace/__tests__/run.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
cd ~/aipe && git add src/make-workspace/run.ts src/make-workspace/__tests__/run.test.ts
git commit -m "feat: makeWorkspace orchestration (materializes + aggregates state)"
```

---

## Task 5: Real git adapters + CLI

**Files:**
- Create: `src/make-workspace/git.ts`
- Create: `src/make-workspace/cli.ts`
- Test: `src/make-workspace/__tests__/cli.test.ts`

**Interfaces:**
- Consumes: `Inspector`/`Cloner` (`./clone`), `makeWorkspace` (`./run`), `RepoResult`/`WorkspacePhase` (`./types`).
- Produces:
  - `realInspect: Inspector`, `realClone: Cloner` (in `git.ts`).
  - `renderReport(results: RepoResult[], phase: WorkspacePhase): string[]` (in `cli.ts`, pure and testable).

Note: `git.ts` is thin glue over real git — verified by manual execution (Step 6), not by unit test. The testable logic (output formatting) lives in `renderReport`.

- [ ] **Step 1: Write the failing test (renderReport)**

Create `src/make-workspace/__tests__/cli.test.ts`:

```ts
import { expect, test } from "bun:test";
import { renderReport } from "../cli";

test("renderReport formats each repo and the STATE line", () => {
  const lines = renderReport(
    [
      { name: "embark", status: "cloned" },
      { name: "prontuario", status: "skipped", message: "already present" },
      { name: "faturamento", status: "error", message: "Permission denied (publickey)" },
    ],
    "pending",
  );
  expect(lines).toContain("OK cloned embark");
  expect(lines).toContain("SKIP prontuario (already present)");
  expect(lines).toContain("ERROR faturamento: Permission denied (publickey)");
  expect(lines.some((l) => l.startsWith("STATE workspace=pending"))).toBe(true);
});

test("renderReport marks done when all ok", () => {
  const lines = renderReport([{ name: "embark", status: "cloned" }], "done");
  expect(lines.some((l) => l.startsWith("STATE workspace=done"))).toBe(true);
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `cd ~/aipe && bun test src/make-workspace/__tests__/cli.test.ts`
Expected: FAIL — `Cannot find module "../cli"` (or `renderReport` undefined).

- [ ] **Step 3: Implement `git.ts`**

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
  return { ok: false, message: result.stderr || `git clone failed (code ${result.code})` };
};
```

- [ ] **Step 4: Implement `cli.ts`**

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
    else if (r.status === "skipped") lines.push(`SKIP ${r.name} (${r.message ?? "already present"})`);
    else lines.push(`ERROR ${r.name}: ${r.message ?? "unknown error"}`);
  }
  const errors = results.filter((r) => r.status === "error").length;
  const suffix = errors > 0 ? ` (${errors} error(s) out of ${results.length} repos)` : "";
  lines.push(`STATE workspace=${phase}${suffix}`);
  return lines;
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const workspace = getFlag(args, "--workspace") ?? process.cwd();

  const result = await makeWorkspace(workspace, { inspect: realInspect, clone: realClone });
  if (!result.ok) {
    console.log(`ERROR brain: ${result.error}`);
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
    console.log(`ERROR ${err}`);
    process.exit(1);
  });
```

- [ ] **Step 5: Run the test and watch it pass**

Run: `cd ~/aipe && bun test src/make-workspace/__tests__/cli.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Manual end-to-end verification (real git)**

Create a temporary workspace with a brain pointing to a small public repo and run the CLI:

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
# Running again should skip (idempotence):
bun src/make-workspace/cli.ts --workspace "$MW"; echo "exit=$?"
rm -rf "$MW"
```
Expected: 1st run `OK cloned sample` + `STATE workspace=done` (exit 0); 2nd run `SKIP sample (already present)` + `STATE workspace=done` (exit 0).

- [ ] **Step 7: Run the full suite**

Run: `cd ~/aipe && bun test`
Expected: PASS (all context-brain + make-workspace tests).

- [ ] **Step 8: Commit**

```bash
cd ~/aipe && git add src/make-workspace/git.ts src/make-workspace/cli.ts src/make-workspace/__tests__/cli.test.ts
git commit -m "feat: cli and git adapters for make-workspace"
```

---

## Task 6: `/make-workspace` skill

**Files:**
- Create: `skills/make-workspace/SKILL.md`

**Interfaces:**
- Consumes: `src/make-workspace/cli.ts` (via `bun`), `<workspace>/.aipe/brain.yaml` and `state.yaml`.
- Produces: no code symbol — it's the conversational interface.

- [ ] **Step 1: Write the skill**

Create `skills/make-workspace/SKILL.md`:

```markdown
---
name: make-workspace
description: Use in step 2 of AIPe onboarding to materialize (git clone) the repositories declared in .aipe/brain.yaml inside the workspace, idempotently. Does not create a worktree, does not detect stack, does not edit the brain.
---

# /make-workspace

Materializes the context's brain repos on the machine. You (the coordinator) do NOT
clone by hand — you delegate to the typed CLI, which decides per repo (clone / skip /
error), never overwrites anything, and updates `state.yaml`.

## Flow

1. **Confirm the workspace.** By default it's the current directory (must be an
   `aipe-<context>` folder with `.aipe/brain.yaml`).

2. **Check the precondition.** The brain must exist. If there is no
   `<workspace>/.aipe/brain.yaml`, guide the PE to run `/context-brain` first —
   it makes no sense to clone without the map.

3. **Run the CLI:**
   ```bash
   bun <plugin-path>/src/make-workspace/cli.ts --workspace <workspace>
   ```

4. **Translate the output to the PE** (one line per repo):
   - `OK cloned <repo>` → cloned now.
   - `SKIP <repo> (already present)` → was already there, nothing touched.
   - `ERROR <repo>: <message>` → failed (auth, network, or path occupied by
     different content). Explain and suggest the fix (e.g. grant access to the repo,
     move the occupied folder, or fix the URL in the brain via `/context-brain`).
   - `STATE workspace=done|pending` → aggregated state.

5. **Next step:** if `workspace=done` (all present), the context is ready for
   `/relationship`. If `pending`, list what's missing to the PE; re-running is safe and
   only completes what's missing.

## Rules

- Never clone or edit `brain.yaml`/`state.yaml` by hand — always through the CLI.
- Don't create worktrees here (that's a separate sub-project).
- Auth failure is never worked around: report the git message to the PE.
```

- [ ] **Step 2: Check coherence with the existing pattern**

Run: `cd ~/aipe && cat skills/context-brain/SKILL.md skills/make-workspace/SKILL.md | head -60`
Expected: frontmatter (`name`/`description`) in the same format; no hand-edited YAML described.

- [ ] **Step 3: Commit**

```bash
cd ~/aipe && git add skills/make-workspace/SKILL.md
git commit -m "feat: /make-workspace skill"
```

---

## Self-Review (by the plan's author)

**Spec coverage:**
- §1 purpose/boundaries (clone-only; not worktree/stack/brain/hook) → Tasks 1-6 (boundaries reflected in the Task 6 skill and the absence of worktree/stack code).
- §2 skill+CLI flow → Task 5 (cli) + Task 6 (skill).
- §3 per-repo behavior (cloned/skipped/error, same remote, occupied path, auth without prompt, injectable) → Task 2 (`materializeRepo`) + Task 5 (`realInspect`/`realClone`).
- §4 binary state (done only if all) → Task 3 (`updateWorkspacePhase`) + Task 4 (aggregation).
- §5 errors/robustness (missing brain, occupied path, partial failure doesn't interrupt, re-execution) → Tasks 1,2,4 (tests cover each case).
- §6 tests → all `__tests__` + manual verification (Task 5 Step 6).
- §8 code structure → File Structure matches 1:1.

**Placeholder scan:** no TBD/TODO; every code step brings complete code.

**Type consistency:** `RepoResult`/`RepoStatus`/`WorkspacePhase` defined in Task 1 and used identically in Tasks 2/4/5; `Inspector`/`Cloner` defined in Task 2 and reused in 4/5; `makeWorkspace(workspaceDir, {inspect, clone})` identical in run.ts and cli.ts; `updateWorkspacePhase(workspaceDir, phase)` identical in state.ts and run.ts.
```
