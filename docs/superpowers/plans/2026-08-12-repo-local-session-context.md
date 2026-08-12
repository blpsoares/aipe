# Repo-local session context (persona + PE identity) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Opening a Claude Code session directly inside a specialist's repo (not the workspace root) automatically injects persona + PE + workspace-context awareness — today it injects nothing.

**Architecture:** (1) Capture the PE's name during `/context-brain` onboarding (`ContextMeta.pe`). (2) `read-state.ts` walks up from the session's CWD to find `.aipe/brain.yaml` instead of requiring an exact match, and reports which declared repo (if any) the original CWD falls under. (3) `hire-specialists` (and `rehydrate`) install the same `SessionStart` hook into each specialist repo, reusing a hook-merge helper extracted out of the workspace-root installer. (4) A new pure `buildPersonaAwareness` renders a specialist-scoped message (persona roster for that repo + PE name + context name + that repo's relations) instead of the coordinator's Dispatch Gate identity, fed by a new small reader (`persona-context.ts`) that reuses the existing `readPersonas`/`readGraph` functions.

**Tech Stack:** TypeScript (strict, `noUncheckedIndexedAccess`), Bun (`bun:test`), reuses the `yaml` package already a dependency.

## Global Constraints

- Design doc: `docs/superpowers/specs/2026-08-11-repo-local-session-context-design.md` — read it before starting if anything below is ambiguous.
- Language: all code, identifiers, comments, and `SKILL.md` prose are English-only (repo convention, see `README.md`).
- `tsconfig.json` has `strict: true` and `noUncheckedIndexedAccess: true` — every array/index access must be guarded.
- Coordinator-mode behavior (everything the workspace root already does) MUST NOT change — every existing test in `src/session-hook/__tests__/` and `src/harness/__tests__/` must keep passing unmodified unless a task explicitly says otherwise.
- **Multi-persona resolution (spec's open question, resolved here):** a repo can have up to 2 personas (`dev-fullstack` + `qa`), and a monorepo can have more (one pair per package/group). `buildPersonaAwareness` does **not** guess a single identity — it lists every persona hired for that repo (name + role), so the message never wrongly claims "you are X" when two personas share the repo.
- **Upward-search depth cap: 8 levels.** A dispatch worktree nests at `<repo>/.worktrees/<journey>-<slug>/` (2 levels under the repo) and a monorepo package adds at most 1 more — 8 is comfortably above any realistic nesting.
- Commit after every task with `bun test` and `bunx tsc --noEmit -p tsconfig.json` both green.

---

### Task 1: Capture the PE's name (`ContextMeta.pe`)

**Files:**
- Modify: `src/context-brain/types.ts`
- Modify: `skills/context-brain/SKILL.md`
- Test: `src/context-brain/__tests__/write.test.ts` (extend if it exists; otherwise add a case to whichever existing test covers `writeBrainFiles`/`validateContext` round-tripping `context`)

**Interfaces:**
- Produces: `ContextMeta.pe?: string` (optional — a missing PE name degrades gracefully everywhere downstream).

- [ ] **Step 1: Check for an existing test that would need extending**

Run: `find src/context-brain/__tests__ -type f` and `grep -rn "coordinator" src/context-brain/__tests__/*.test.ts`

If a test asserts the full shape of a written `brain.yaml`'s `context` block (e.g. via `stringify`/round-trip), note its exact file:line — you'll extend it in Step 4. If none does, skip straight to Step 2 (the type change alone needs no new test — it's a passthrough field with no validation logic).

- [ ] **Step 2: Add the field**

In `src/context-brain/types.ts`, change:

```typescript
export interface ContextMeta {
  name: string;
  coordinator: string;
}
```

to:

```typescript
export interface ContextMeta {
  name: string;
  coordinator: string;
  // The PE's own name (optional — a missing value degrades gracefully:
  // session-hook awareness just omits the "You work for <pe>" clause).
  pe?: string;
}
```

- [ ] **Step 3: Update `skills/context-brain/SKILL.md`**

In the "Collect only what's missing, one question at a time" list (step 2 of the skill's Flow section), add a new bullet right after the **Coordinator** bullet:

```markdown
   - **PE** name (optional) — the human's own name, if they want to give it. Used
     later to personalize awareness when a session opens directly inside a
     specialist's repo ("you work for `<pe>`"). Do not push for it if the PE
     doesn't offer one — leave `pe` out of the JSON entirely rather than guessing.
```

And in the "Assemble the JSON" example, update the `context` object to show the optional field:

```json
{
  "context": { "name": "<folder-name-without-aipe->", "coordinator": "<name>", "pe": "<optional>" },
  "repos": [ { "name": "...", "url": "...", "path": "./...", "stack": ["..."] } ]
}
```

- [ ] **Step 4: Run the full suite and typecheck**

Run: `bun test && bunx tsc --noEmit -p tsconfig.json`
Expected: all tests PASS (unchanged count unless Step 1 found an existing test to extend — if so, extend it with a case asserting `pe` round-trips through `writeBrainFiles`/`readBrain`, then re-run), typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/context-brain/types.ts skills/context-brain/SKILL.md
git commit -m "feat(context-brain): capture the PE's own name (optional, for repo-local awareness)"
```

---

### Task 2: `read-state.ts` — upward search + repo-at-CWD detection

**Files:**
- Modify: `src/session-hook/read-state.ts`
- Create: `src/session-hook/persona-context.ts` (placeholder only — Task 6 replaces its contents)
- Modify: `src/session-hook/awareness.ts` (temporary signature widening only — Task 7 replaces the function body)
- Test: `src/session-hook/__tests__/read-state.test.ts`

**Interfaces:**
- Consumes: nothing new (uses existing `BrainFile`/`RepoEntry`/`StateFile` types).
- Produces (extends `Fields`): `pe: string`, `root: string` (absolute path where `.aipe/brain.yaml` was found, `""` if absent), `repoAtCwd: { name: string; path: string } | null` (the declared repo whose path the ORIGINAL cwd falls under; `null` at the workspace root or in an unrecognized subdirectory). `readState(cwd: string): Promise<Fields>` keeps its signature — the parameter is still "the directory the hook was invoked from," just no longer required to be the exact workspace root.

- [ ] **Step 1: Write the failing tests**

Add to `src/session-hook/__tests__/read-state.test.ts` (append after the existing tests, keep the existing `ws()` helper and `fullBrain`/`doneState` fixtures as-is):

```typescript
test("cwd at the workspace root → root resolves to itself, repoAtCwd is null", async () => {
  const dir = await ws(fullBrain, doneState);
  try {
    const f = await readState(dir);
    expect(f.root).toBe(dir);
    expect(f.repoAtCwd).toBeNull();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("cwd inside a declared repo → upward search finds the root, repoAtCwd is set", async () => {
  const dir = await ws(fullBrain, doneState);
  try {
    const repoDir = join(dir, "embark");
    await mkdir(repoDir, { recursive: true });
    const f = await readState(repoDir);
    expect(f.root).toBe(dir);
    expect(f.repoAtCwd).toEqual({ name: "embark", path: "./embark" });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("cwd inside a nested worktree under a repo → still resolves the same repo", async () => {
  const dir = await ws(fullBrain, doneState);
  try {
    const nested = join(dir, "embark", ".worktrees", "j1-alice");
    await mkdir(nested, { recursive: true });
    const f = await readState(nested);
    expect(f.root).toBe(dir);
    expect(f.repoAtCwd).toEqual({ name: "embark", path: "./embark" });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("cwd in an unrecognized subdirectory of the workspace → repoAtCwd is null", async () => {
  const dir = await ws(fullBrain, doneState);
  try {
    const stray = join(dir, "docs");
    await mkdir(stray, { recursive: true });
    const f = await readState(stray);
    expect(f.root).toBe(dir);
    expect(f.repoAtCwd).toBeNull();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("no .aipe found within the depth cap → absent, same as today", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-rs-"));
  try {
    const deep = join(dir, "a", "b", "c", "d", "e", "f", "g", "h", "i", "j");
    await mkdir(deep, { recursive: true });
    const f = await readState(deep);
    expect(f.brain).toBe("absent");
    expect(f.root).toBe("");
    expect(f.repoAtCwd).toBeNull();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("pe field round-trips when present, blank when absent", async () => {
  const withPe = { context: { name: "opvibes", coordinator: "Nicolas", pe: "Bruno" }, repos: fullBrain.repos };
  const dir = await ws(withPe, doneState);
  try {
    const f = await readState(dir);
    expect(f.pe).toBe("Bruno");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("pe absent from brain.yaml → empty string, not undefined/crash", async () => {
  const dir = await ws(fullBrain, doneState);
  try {
    const f = await readState(dir);
    expect(f.pe).toBe("");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test src/session-hook/__tests__/read-state.test.ts`
Expected: FAIL — `f.root`/`f.repoAtCwd`/`f.pe` are `undefined` (property doesn't exist on the current `Fields` shape) or the new tests' expectations don't match today's exact-path-only lookup.

- [ ] **Step 3: Implement**

Replace the full contents of `src/session-hook/read-state.ts` with:

```typescript
#!/usr/bin/env bun
import { readFile, stat } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { parse } from "yaml";
import type { BrainFile, Phase, RepoEntry, StateFile } from "../context-brain/types";
import { renderSessionContext } from "./awareness";
import { readPersonaContext } from "./persona-context";

function getFlag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const v = args[i + 1];
  if (v === undefined || v.startsWith("--")) return undefined;
  return v;
}

function sanitize(v: string): string {
  return v.replace(/[\x00-\x1f]+/g, " ").trim();
}

function isPhase(v: unknown): v is Phase {
  return v === "pending" || v === "done";
}

export interface RepoAtCwd {
  name: string;
  path: string;
}

export interface Fields {
  brain: "present" | "absent";
  contextName: string;
  coordinator: string;
  pe: string;
  phaseBrain: Phase;
  phaseWorkspace: Phase;
  phaseRelationship: Phase;
  phaseSpecialists: Phase;
  repos: string[];
  root: string;
  repoAtCwd: RepoAtCwd | null;
}

const MAX_UPWARD_DEPTH = 8;

// Walks up from `startDir` (inclusive) looking for a directory containing
// `.aipe/brain.yaml`. Stops at the filesystem root or after MAX_UPWARD_DEPTH
// hops, whichever comes first. Existence only (not parseability) — a found
// but malformed brain.yaml still counts as "this is the root", matching the
// existing absent-on-malformed behavior for THAT directory rather than
// silently skipping past it to an unrelated ancestor.
async function findWorkspaceRoot(startDir: string): Promise<string | undefined> {
  let dir = resolve(startDir);
  for (let depth = 0; depth <= MAX_UPWARD_DEPTH; depth++) {
    try {
      await stat(join(dir, ".aipe", "brain.yaml"));
      return dir;
    } catch {
      // not here — try the parent
    }
    const parent = dirname(dir);
    if (parent === dir) return undefined; // reached the filesystem root
    dir = parent;
  }
  return undefined;
}

// Which declared repo (if any) the ORIGINAL cwd falls under, relative to the
// resolved root. Longest-matching path wins (defensive against overlaps —
// repos are siblings in practice, so this rarely matters).
function repoAtCwd(root: string, cwd: string, repos: RepoEntry[]): RepoAtCwd | null {
  const absCwd = resolve(cwd);
  let best: RepoAtCwd | null = null;
  let bestLen = -1;
  for (const repo of repos) {
    const absRepo = resolve(root, repo.path);
    const isMatch = absCwd === absRepo || absCwd.startsWith(absRepo + sep);
    if (isMatch && absRepo.length > bestLen) {
      best = { name: repo.name, path: repo.path };
      bestLen = absRepo.length;
    }
  }
  return best;
}

async function readYaml(path: string): Promise<unknown | undefined> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    return undefined; // absent
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
    pe: "",
    phaseBrain: "pending",
    phaseWorkspace: "pending",
    phaseRelationship: "pending",
    phaseSpecialists: "pending",
    repos: [],
    root: "",
    repoAtCwd: null,
  };
}

export async function readState(cwd: string): Promise<Fields> {
  const root = await findWorkspaceRoot(cwd);
  if (!root) return absentFields();

  const aipe = join(root, ".aipe");
  const brainParsed = await readYaml(join(aipe, "brain.yaml"));
  if (!brainParsed || typeof brainParsed !== "object") {
    return absentFields();
  }

  const brain = brainParsed as Partial<BrainFile>;
  const contextName = sanitize(String(brain.context?.name ?? ""));
  const coordinator = sanitize(String(brain.context?.coordinator ?? ""));
  const pe = sanitize(String(brain.context?.pe ?? ""));
  const repos = Array.isArray(brain.repos)
    ? brain.repos
        .map((r) => sanitize(String((r as { name?: unknown } | null)?.name ?? "")))
        .filter((n) => n.length > 0)
    : [];
  const repoEntries = Array.isArray(brain.repos) ? brain.repos : [];

  const stateParsed = await readYaml(join(aipe, "state.yaml"));
  const phase = (stateParsed as Partial<StateFile> | undefined)?.phase;
  const readPhase = (v: unknown, fallback: Phase): Phase => (isPhase(v) ? v : fallback);

  return {
    brain: "present",
    contextName,
    coordinator,
    pe,
    phaseBrain: readPhase(phase?.brain, "done"),
    phaseWorkspace: readPhase(phase?.workspace, "pending"),
    phaseRelationship: readPhase(phase?.relationship, "pending"),
    phaseSpecialists: readPhase(phase?.specialists, "pending"),
    repos,
    root,
    repoAtCwd: repoAtCwd(root, cwd, repoEntries),
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
    `PHASE_SPECIALISTS=${f.phaseSpecialists}`,
    `REPOS=${f.repos.join(",")}`,
  ].join("\n");
}

export async function run(args: string[]): Promise<number> {
  const workspace = getFlag(args, "--workspace") ?? process.cwd();
  console.log(formatFields(await readState(workspace)));
  return 0;
}

export async function runSessionContext(args: string[]): Promise<number> {
  const workspace = getFlag(args, "--workspace") ?? process.cwd();
  if (!workspace) {
    console.log("{}");
    return 0;
  }
  const fields = await readState(workspace);
  if (fields.repoAtCwd) {
    const ctx = await readPersonaContext(fields.root, fields.repoAtCwd.name);
    console.log(renderSessionContext(fields, ctx));
  } else {
    console.log(renderSessionContext(fields));
  }
  return 0;
}

if (import.meta.main) {
  run(process.argv.slice(2)).then((code) => process.exit(code));
}
```

Note: this imports `readPersonaContext` from `./persona-context`, which does not exist yet (Task 6) — that's fine, TypeScript will fail to compile until Task 6 lands, and `renderSessionContext`'s second parameter doesn't exist until Task 7. **For THIS task, temporarily stub both** so `read-state.ts` compiles and its own tests (which never exercise `runSessionContext`) pass in isolation:

Create a placeholder `src/session-hook/persona-context.ts`:

```typescript
// Placeholder — replaced by Task 6 with the real implementation (reads
// personas.yaml + relations/graph.yaml for a repo).
export interface PersonaContext {
  personas: { name: string; role: string }[];
  edges: unknown[];
}

export async function readPersonaContext(_root: string, _repoName: string): Promise<PersonaContext> {
  return { personas: [], edges: [] };
}
```

And temporarily widen `renderSessionContext`'s signature in `src/session-hook/awareness.ts` to accept an ignored second parameter (Task 7 will give it real behavior):

```typescript
export function renderSessionContext(f: Fields, _personaCtx?: unknown): string {
```

(the leading underscore signals "accepted but unused yet" — Task 7 replaces this whole function body).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test src/session-hook/__tests__/read-state.test.ts src/session-hook/__tests__/awareness.test.ts`
Expected: PASS — the 7 new `read-state` tests plus every pre-existing `read-state`/`awareness` test (the placeholder changes are no-ops for `buildAwareness`/existing `renderSessionContext` callers).

- [ ] **Step 5: Run the full suite and typecheck**

Run: `bun test && bunx tsc --noEmit -p tsconfig.json`
Expected: all tests PASS, typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add src/session-hook/read-state.ts src/session-hook/persona-context.ts src/session-hook/awareness.ts src/session-hook/__tests__/read-state.test.ts
git commit -m "feat(session-hook): upward-search for .aipe/ and detect which repo the cwd is under"
```

---

### Task 3: `harness/claude-code.ts` — extract `ensureSessionStartHook`

**Files:**
- Modify: `src/harness/claude-code.ts`
- Test: `src/harness/__tests__/harness.test.ts`

**Interfaces:**
- Produces: `ensureSessionStartHook(targetDir: string): Promise<void>` — merges the AIPe `SessionStart` hook into `<targetDir>/.claude/settings.json`, idempotently (exported for reuse by `hire-specialists` and `rehydrate` in Tasks 4–5).
- `installIntegration(workspaceDir)`'s observable behavior is UNCHANGED — it now calls `ensureSessionStartHook` internally instead of inlining the same steps.

- [ ] **Step 1: Write the failing test**

Add to `src/harness/__tests__/harness.test.ts` (check the file first for its existing import style and fixture helpers — match them; the sketch below assumes a temp-dir pattern like the rest of this codebase):

```typescript
test("ensureSessionStartHook writes the hook into an arbitrary directory (not just a workspace root)", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-hook-"));
  try {
    await ensureSessionStartHook(dir);
    const settings = JSON.parse(await readFile(join(dir, ".claude", "settings.json"), "utf8"));
    expect(JSON.stringify(settings.hooks.SessionStart)).toContain("aipe session-context");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("ensureSessionStartHook is idempotent — calling it twice does not duplicate the hook", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-hook-"));
  try {
    await ensureSessionStartHook(dir);
    await ensureSessionStartHook(dir);
    const settings = JSON.parse(await readFile(join(dir, ".claude", "settings.json"), "utf8"));
    expect(settings.hooks.SessionStart).toHaveLength(1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("ensureSessionStartHook preserves an existing unrelated settings.json entry", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-hook-"));
  try {
    await mkdir(join(dir, ".claude"), { recursive: true });
    await writeFile(join(dir, ".claude", "settings.json"), JSON.stringify({ someOtherKey: true }), "utf8");
    await ensureSessionStartHook(dir);
    const settings = JSON.parse(await readFile(join(dir, ".claude", "settings.json"), "utf8"));
    expect(settings.someOtherKey).toBe(true);
    expect(settings.hooks.SessionStart).toHaveLength(1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
```

Add whatever imports these three tests need (`mkdtemp`, `mkdir`, `readFile`, `writeFile`, `rm` from `node:fs/promises`, `tmpdir` from `node:os`, `join` from `node:path`, and `ensureSessionStartHook` from `../claude-code`) to the top of the file, alongside its existing imports — do not remove or reorder existing ones.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test src/harness/__tests__/harness.test.ts`
Expected: FAIL — `ensureSessionStartHook` is not exported from `../claude-code`.

- [ ] **Step 3: Implement**

In `src/harness/claude-code.ts`, add the exported function (place it right after the existing `hasAipeHook` function, before the `claudeCodeAdapter` export):

```typescript
export async function ensureSessionStartHook(targetDir: string): Promise<void> {
  const claudeDir = join(targetDir, ".claude");
  const settingsPath = join(claudeDir, "settings.json");
  await mkdir(claudeDir, { recursive: true });

  const settings = await readSettings(settingsPath);
  settings.hooks ??= {};
  const sessionStart = Array.isArray(settings.hooks.SessionStart) ? settings.hooks.SessionStart : [];
  if (!hasAipeHook(sessionStart)) sessionStart.push(SESSION_START_HOOK);
  settings.hooks.SessionStart = sessionStart;
  await writeFile(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
}
```

Then replace `installIntegration`'s step 1 (the hook-merge block) with a call to the new function. Change:

```typescript
  async installIntegration(workspaceDir: string): Promise<InstallReport> {
    const claudeDir = join(workspaceDir, ".claude");
    const settingsPath = join(claudeDir, "settings.json");
    await mkdir(claudeDir, { recursive: true });

    // 1. merge the SessionStart hook into settings.json (idempotent)
    const settings = await readSettings(settingsPath);
    settings.hooks ??= {};
    const sessionStart = Array.isArray(settings.hooks.SessionStart) ? settings.hooks.SessionStart : [];
    if (!hasAipeHook(sessionStart)) sessionStart.push(SESSION_START_HOOK);
    settings.hooks.SessionStart = sessionStart;
    await writeFile(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");

    // 2. write the onboarding/operation flow skills
```

to:

```typescript
  async installIntegration(workspaceDir: string): Promise<InstallReport> {
    // 1. merge the SessionStart hook into settings.json (idempotent)
    await ensureSessionStartHook(workspaceDir);

    // 2. write the onboarding/operation flow skills
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test src/harness/__tests__/harness.test.ts`
Expected: PASS — the 3 new tests plus every pre-existing test in the file (the refactor is behavior-preserving for `installIntegration`).

- [ ] **Step 5: Run the full suite and typecheck**

Run: `bun test && bunx tsc --noEmit -p tsconfig.json`
Expected: all tests PASS, typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add src/harness/claude-code.ts src/harness/__tests__/harness.test.ts
git commit -m "refactor(harness): extract ensureSessionStartHook for reuse outside the workspace root"
```

---

### Task 4: `hire-specialists` installs the hook into each repo

**Files:**
- Modify: `src/hire-specialists/run.ts`
- Test: `src/hire-specialists/__tests__/run.test.ts` (extend the existing test(s) covering `writePersonaFiles`/`runHireSpecialists` — check the file first for its exact fixture/temp-dir pattern and match it)

**Interfaces:**
- Consumes: `ensureSessionStartHook` (Task 3) from `../harness/claude-code`.
- No new exports — this is an internal addition to the existing `writePersonaFiles` function.

- [ ] **Step 1: Read the existing test file first**

Run: `cat src/hire-specialists/__tests__/run.test.ts` — find the test(s) that call `runHireSpecialists` (or `writePersonaFiles` directly, if it's exported/tested separately) against a temp workspace with a fake brain + staged reports, and note the exact fixture shape (repo names/paths) it uses. Reuse that exact fixture in Step 2 rather than inventing a new one.

- [ ] **Step 2: Write the failing test**

Add a test to `src/hire-specialists/__tests__/run.test.ts`, adapted to that file's existing fixture helper, asserting that after `runHireSpecialists` completes, each hired repo also has `.claude/settings.json` with the AIPe `SessionStart` hook — e.g. (adjust helper/variable names to match what Step 1 found):

```typescript
test("runHireSpecialists installs the SessionStart hook into each repo, alongside the persona files", async () => {
  // (reuse this file's existing workspace/brain/reports fixture setup)
  const result = await runHireSpecialists(dir);
  expect(result.ok).toBe(true);
  const settings = JSON.parse(await readFile(join(dir, "embark", ".claude", "settings.json"), "utf8"));
  expect(JSON.stringify(settings.hooks.SessionStart)).toContain("aipe session-context");
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `bun test src/hire-specialists/__tests__/run.test.ts`
Expected: FAIL — no `.claude/settings.json` is written into the repo today.

- [ ] **Step 4: Implement**

In `src/hire-specialists/run.ts`, add the import:

```typescript
import { ensureSessionStartHook } from "../harness/claude-code";
```

In `writePersonaFiles`, after the loop body's existing writes (right after the two `writeFile` calls for the source-of-truth `sourceDir`, still inside the `for (const report of reports)` loop, before its closing brace), add:

```typescript
    await ensureSessionStartHook(join(workspaceDir, repo.path));
```

The full updated loop body should read:

```typescript
  for (const report of reports) {
    const repo = brain.repos.find((r) => r.name === report.repo);
    if (!repo) continue;
    const slug = personaSlug(report.name);
    const stack = repo.stack ?? [];
    const content = renderSkillMd(report, stack);
    const agent = renderAgentMd({ name: report.name, role: report.role, repo: report.repo, stack, body: report.body });
    const skillDir = join(workspaceDir, repo.path, ".claude", "skills", slug);
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, "SKILL.md"), content, "utf8");
    const agentDir = join(workspaceDir, repo.path, ".claude", "agents");
    await mkdir(agentDir, { recursive: true });
    await writeFile(join(agentDir, `${slug}.md`), agent, "utf8");
    const sourceDir = join(workspaceDir, ".aipe", "personas", report.repo, slug);
    await mkdir(sourceDir, { recursive: true });
    await writeFile(join(sourceDir, "SKILL.md"), content, "utf8");
    await writeFile(join(sourceDir, "agent.md"), agent, "utf8");
    await ensureSessionStartHook(join(workspaceDir, repo.path));
  }
```

(`ensureSessionStartHook` is idempotent, so calling it once per persona report — twice per repo, once for dev-fullstack and once for QA — is harmless; no dedup bookkeeping needed.)

- [ ] **Step 5: Run the tests to verify they pass**

Run: `bun test src/hire-specialists/__tests__/run.test.ts`
Expected: PASS.

- [ ] **Step 6: Run the full suite and typecheck**

Run: `bun test && bunx tsc --noEmit -p tsconfig.json`
Expected: all tests PASS, typecheck clean.

- [ ] **Step 7: Commit**

```bash
git add src/hire-specialists/run.ts src/hire-specialists/__tests__/run.test.ts
git commit -m "feat(hire-specialists): install the SessionStart hook into each specialist repo"
```

---

### Task 5: `rehydrate` keeps the repo-local hook in sync

**Files:**
- Modify: `src/rehydrate/personas.ts`
- Test: `src/rehydrate/__tests__/personas.test.ts`

**Interfaces:**
- Consumes: `ensureSessionStartHook` (Task 3).
- No new exports — internal addition to `rehydratePersonas`.

- [ ] **Step 1: Read the existing test file first**

Run: `cat src/rehydrate/__tests__/personas.test.ts` — find the fixture pattern (workspace dir, `.aipe/personas/<repo>/<slug>/`, a "repo present" case) and reuse it.

- [ ] **Step 2: Write the failing test**

Add a test adapted to that fixture, asserting that after `rehydratePersonas` runs against a workspace whose repo is present, the repo also ends up with `.claude/settings.json` carrying the hook:

```typescript
test("rehydratePersonas installs the SessionStart hook into each repo it restores", async () => {
  // (reuse this file's existing "repo present, persona restored" fixture setup)
  const rows = await rehydratePersonas(dir);
  expect(rows.some((r) => r.status === "restored")).toBe(true);
  const settings = JSON.parse(await readFile(join(dir, "embark", ".claude", "settings.json"), "utf8"));
  expect(JSON.stringify(settings.hooks.SessionStart)).toContain("aipe session-context");
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `bun test src/rehydrate/__tests__/personas.test.ts`
Expected: FAIL.

- [ ] **Step 4: Implement**

In `src/rehydrate/personas.ts`, add the import:

```typescript
import { ensureSessionStartHook } from "../harness/claude-code";
```

Inside `rehydratePersonas`'s inner loop (`for (const slug of await subdirs(join(personasRoot, repoName)))`), right after the existing `rows.push({ repo: repoName, slug, status: "restored" });` line, add:

```typescript
      await ensureSessionStartHook(repoAbs);
```

The full updated inner-loop tail should read:

```typescript
      const destDir = join(repoAbs, ".claude", "skills", slug);
      await mkdir(destDir, { recursive: true });
      await copyFile(src, join(destDir, "SKILL.md"));
      await restoreAgent(personasRoot, repoAbs, roster, stackByRepo.get(repoName) ?? [], repoName, slug);
      rows.push({ repo: repoName, slug, status: "restored" });
      await ensureSessionStartHook(repoAbs);
```

(`repoAbs` is already in scope from earlier in the outer loop — reuse it, don't recompute.)

- [ ] **Step 5: Run the tests to verify they pass**

Run: `bun test src/rehydrate/__tests__/personas.test.ts`
Expected: PASS.

- [ ] **Step 6: Run the full suite and typecheck**

Run: `bun test && bunx tsc --noEmit -p tsconfig.json`
Expected: all tests PASS, typecheck clean.

- [ ] **Step 7: Commit**

```bash
git add src/rehydrate/personas.ts src/rehydrate/__tests__/personas.test.ts
git commit -m "feat(rehydrate): keep the repo-local SessionStart hook in sync on restore"
```

---

### Task 6: `persona-context.ts` — real implementation

**Files:**
- Modify: `src/session-hook/persona-context.ts` (replace Task 2's placeholder)
- Test: `src/session-hook/__tests__/persona-context.test.ts` (new)

**Interfaces:**
- Consumes: `readPersonas(workspaceDir: string): Promise<PersonaRegistryEntry[]>` (`../hire-specialists/read-personas`, unchanged); `readGraph(workspaceDir: string): Promise<Graph>` (`../relationship/read-graph`, unchanged, `Graph = { nodes: GraphNode[]; edges: MergedEdge[] }`); `repoOf(fqid: string): string` (`../relationship/fqid`, unchanged).
- Produces: `PersonaContext { personas: { name: string; role: "dev-fullstack" | "qa" }[]; edges: MergedEdge[] }`, `readPersonaContext(root: string, repoName: string): Promise<PersonaContext>`.

- [ ] **Step 1: Write the failing tests**

```typescript
// src/session-hook/__tests__/persona-context.test.ts
import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stringify } from "yaml";
import { readPersonaContext } from "../persona-context";

async function root(personas?: unknown, graph?: unknown): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "aipe-pc-"));
  await mkdir(join(dir, ".aipe", "relations"), { recursive: true });
  if (personas !== undefined) await writeFile(join(dir, ".aipe", "personas.yaml"), stringify(personas), "utf8");
  if (graph !== undefined) await writeFile(join(dir, ".aipe", "relations", "graph.yaml"), stringify(graph), "utf8");
  return dir;
}

test("returns only the personas hired for the given repo, dropping the coordinator", async () => {
  const dir = await root({
    personas: [
      { name: "Nicolas", role: "coordinator", repo: null, path: null },
      { name: "Alice", role: "dev-fullstack", repo: "embark", path: "./embark/.claude/skills/alice" },
      { name: "Bob", role: "qa", repo: "embark", path: "./embark/.claude/skills/bob" },
      { name: "Carol", role: "dev-fullstack", repo: "prontuario", path: "./prontuario/.claude/skills/carol" },
    ],
  });
  try {
    const ctx = await readPersonaContext(dir, "embark");
    expect(ctx.personas).toEqual([
      { name: "Alice", role: "dev-fullstack" },
      { name: "Bob", role: "qa" },
    ]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("returns edges touching the repo on either side, dropping unrelated edges", async () => {
  const dir = await root(undefined, {
    nodes: [],
    edges: [
      { from: "embark", to: "prontuario", type: "consumes", perspectives: [{ detail: "calls the API", evidence: "x.ts:1" }] },
      { from: "other-a", to: "other-b", type: "shares-infra", perspectives: [] },
    ],
  });
  try {
    const ctx = await readPersonaContext(dir, "embark");
    expect(ctx.edges).toHaveLength(1);
    expect(ctx.edges[0]?.to).toBe("prontuario");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("missing personas.yaml / graph.yaml → empty context, no throw", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-pc-"));
  try {
    const ctx = await readPersonaContext(dir, "embark");
    expect(ctx.personas).toEqual([]);
    expect(ctx.edges).toEqual([]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test src/session-hook/__tests__/persona-context.test.ts`
Expected: FAIL — the current placeholder always returns `{ personas: [], edges: [] }`, so the first two tests fail.

- [ ] **Step 3: Implement**

Replace the full contents of `src/session-hook/persona-context.ts` with:

```typescript
import { repoOf } from "../relationship/fqid";
import { readGraph } from "../relationship/read-graph";
import type { MergedEdge } from "../relationship/types";
import { readPersonas } from "../hire-specialists/read-personas";

export interface PersonaContext {
  personas: { name: string; role: "dev-fullstack" | "qa" }[];
  edges: MergedEdge[];
}

export async function readPersonaContext(root: string, repoName: string): Promise<PersonaContext> {
  const roster = await readPersonas(root);
  const personas = roster
    .filter((p): p is typeof p & { role: "dev-fullstack" | "qa" } => p.repo === repoName && p.role !== "coordinator")
    .map((p) => ({ name: p.name, role: p.role }));

  const graph = await readGraph(root);
  const edges = graph.edges.filter((e) => repoOf(e.from) === repoName || repoOf(e.to) === repoName);

  return { personas, edges };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test src/session-hook/__tests__/persona-context.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Run the full suite and typecheck**

Run: `bun test && bunx tsc --noEmit -p tsconfig.json`
Expected: all tests PASS, typecheck clean (the Task 2 placeholder's `PersonaContext.edges: unknown[]` is now `MergedEdge[]` — confirm nothing else imported the placeholder's looser type; nothing should, since Task 2's `read-state.ts` only calls the function, it doesn't inspect the shape).

- [ ] **Step 6: Commit**

```bash
git add src/session-hook/persona-context.ts src/session-hook/__tests__/persona-context.test.ts
git commit -m "feat(session-hook): read a repo's hired personas + relations for repo-local awareness"
```

---

### Task 7: `buildPersonaAwareness` + wire it into `renderSessionContext`

**Files:**
- Modify: `src/session-hook/awareness.ts`
- Test: `src/session-hook/__tests__/awareness.test.ts`

**Interfaces:**
- Consumes: `Fields` (Task 2, now includes `pe`/`root`/`repoAtCwd`), `PersonaContext` (Task 6).
- Produces: `buildPersonaAwareness(f: Fields, repo: { name: string; path: string }, ctx: PersonaContext): string`; `renderSessionContext(f: Fields, personaCtx?: PersonaContext): string` (replaces Task 2's stub signature with real branching behavior).

- [ ] **Step 1: Write the failing tests**

Add to `src/session-hook/__tests__/awareness.test.ts`. First, update the top-of-file `fields()` helper to include the three new `Fields` properties (required, not optional, so every existing call site needs a default — this is the one change to existing test code in this task):

```typescript
function fields(over: Partial<Fields>): Fields {
  return {
    brain: "present",
    contextName: "opvibes",
    coordinator: "Nicolas",
    pe: "",
    phaseBrain: "done",
    phaseWorkspace: "pending",
    phaseRelationship: "pending",
    phaseSpecialists: "pending",
    repos: ["embark", "prontuario"],
    root: "/tmp/aipe-opvibes",
    repoAtCwd: null,
    ...over,
  };
}
```

Then add the new tests:

```typescript
test("buildPersonaAwareness lists every persona hired for the repo, without guessing a single identity", () => {
  const body = buildPersonaAwareness(
    fields({ pe: "Bruno" }),
    { name: "embark", path: "./embark" },
    { personas: [{ name: "Alice", role: "dev-fullstack" }, { name: "Bob", role: "qa" }], edges: [] },
  );
  expect(body).toContain("Alice");
  expect(body).toContain("dev-fullstack");
  expect(body).toContain("Bob");
  expect(body).toContain("qa");
  expect(body).not.toContain("DISPATCH GATE");
});

test("buildPersonaAwareness includes the PE's name when set", () => {
  const body = buildPersonaAwareness(
    fields({ pe: "Bruno" }),
    { name: "embark", path: "./embark" },
    { personas: [], edges: [] },
  );
  expect(body).toContain("Bruno");
});

test("buildPersonaAwareness degrades gracefully when the PE's name is not set", () => {
  const body = buildPersonaAwareness(
    fields({ pe: "" }),
    { name: "embark", path: "./embark" },
    { personas: [], edges: [] },
  );
  expect(body).toContain("opvibes");
  expect(body).not.toContain("undefined");
});

test("buildPersonaAwareness surfaces this repo's relations", () => {
  const body = buildPersonaAwareness(
    fields({}),
    { name: "embark", path: "./embark" },
    {
      personas: [],
      edges: [
        { from: "embark", to: "prontuario", type: "consumes", perspectives: [{ detail: "calls the payments API", evidence: "x.ts:1" }] },
      ],
    },
  );
  expect(body).toContain("prontuario");
  expect(body).toContain("consumes");
  expect(body).toContain("calls the payments API");
});

test("buildPersonaAwareness with no relations states so explicitly", () => {
  const body = buildPersonaAwareness(fields({}), { name: "embark", path: "./embark" }, { personas: [], edges: [] });
  expect(body.toLowerCase()).toContain("no known relations");
});

test("renderSessionContext with repoAtCwd + personaCtx emits persona-mode text", () => {
  const json = renderSessionContext(
    fields({ repoAtCwd: { name: "embark", path: "./embark" } }),
    { personas: [{ name: "Alice", role: "dev-fullstack" }], edges: [] },
  );
  const parsed = JSON.parse(json);
  expect(parsed.hookSpecificOutput.additionalContext).toContain("Alice");
  expect(parsed.hookSpecificOutput.additionalContext).not.toContain("DISPATCH GATE");
});

test("renderSessionContext with repoAtCwd null still emits coordinator-mode text (unchanged)", () => {
  const json = renderSessionContext(fields({ brain: "absent" }));
  const parsed = JSON.parse(json);
  expect(parsed.hookSpecificOutput.additionalContext).toContain("/context-brain");
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test src/session-hook/__tests__/awareness.test.ts`
Expected: FAIL — `buildPersonaAwareness` is not exported, and `renderSessionContext`'s current stub ignores its second parameter entirely.

- [ ] **Step 3: Implement**

In `src/session-hook/awareness.ts`, add the import and the new function (place it after `buildAwareness`, before `renderSessionContext`):

```typescript
import type { PersonaContext } from "./persona-context";
```

```typescript
function edgeLine(edge: PersonaContext["edges"][number]): string {
  const detail = edge.perspectives[0]?.detail;
  const suffix = detail ? ` — ${detail}` : "";
  return `- ${edge.from} ${edge.type} ${edge.to}${suffix}`;
}

export function buildPersonaAwareness(
  f: Fields,
  repo: { name: string; path: string },
  ctx: PersonaContext,
): string {
  const roster =
    ctx.personas.length > 0
      ? ctx.personas.map((p) => `${p.name} (${p.role})`).join(", ")
      : "no persona has been hired for this repo yet";
  const peClause = f.pe ? ` You work for ${f.pe}.` : "";
  const relations =
    ctx.edges.length > 0 ? ctx.edges.map(edgeLine).join("\n") : "No known relations for this repo.";

  return (
    `This session opened directly inside the ${repo.name} repo, part of the ${f.contextName} context.${peClause} ` +
    `Personas hired for this repo: ${roster}. Their skill/agent files live in .claude/skills/ and .claude/agents/ — ` +
    "Claude picks the right one by matching the task to its description; you don't need to declare which one you are. " +
    `Known relations for ${repo.name}:\n${relations}`
  );
}
```

Then replace the whole `renderSessionContext` function (including Task 2's stub signature) with:

```typescript
export function renderSessionContext(f: Fields, personaCtx?: PersonaContext): string {
  const additionalContext =
    f.repoAtCwd && personaCtx ? buildPersonaAwareness(f, f.repoAtCwd, personaCtx) : buildAwareness(f);
  return JSON.stringify(
    {
      hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext,
      },
    },
    null,
    2,
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test src/session-hook/__tests__/awareness.test.ts`
Expected: PASS — all new tests plus every pre-existing test in the file (updating the `fields()` helper's defaults doesn't change any existing test's inputs, since every added field's default is chosen to be a no-op: `pe: ""`, `repoAtCwd: null`).

- [ ] **Step 5: Run the full suite and typecheck**

Run: `bun test && bunx tsc --noEmit -p tsconfig.json`
Expected: all tests PASS, typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add src/session-hook/awareness.ts src/session-hook/__tests__/awareness.test.ts
git commit -m "feat(session-hook): render persona-scoped awareness when a session opens inside a specialist repo"
```

---

## Self-review notes

- **Spec coverage:** PE-name capture (Task 1), upward search + repo detection (Task 2), hook installed per repo at hire-time and kept in sync on rehydrate (Tasks 3–5), persona roster + relations reader (Task 6), persona-scoped awareness replacing the coordinator identity (Task 7) — every section of `docs/superpowers/specs/2026-08-11-repo-local-session-context-design.md` has a task.
- **Multi-package tie-break (spec's open question):** resolved by NOT tie-breaking — `buildPersonaAwareness` lists every persona hired for the repo instead of guessing one, which is simpler and strictly safer than a prefix-matching rule that could misattribute identity in a monorepo. Documented in Global Constraints.
- **Depth cap (spec's open question):** resolved at 8, justified against the deepest realistic path (`<repo>/.worktrees/<journey>-<slug>/` = 2 levels, +1 for a monorepo package) in Global Constraints.
- **Sequencing:** Task 2 introduces a real dependency on Task 6/7's exports before they exist, so it ships temporary placeholders (a stub `persona-context.ts` and a widened `renderSessionContext` signature) that keep the build green task-by-task — Task 6 and Task 7 each fully replace their respective placeholder, not append to it. This is called out explicitly in Task 2 Step 3 and cross-referenced in Tasks 6–7 so an implementer isn't surprised to find "their" file already exists.
