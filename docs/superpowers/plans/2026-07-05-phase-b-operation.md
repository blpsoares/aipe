# Phase B — Operation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the fully-onboarded coordinator *operate* — receive a demand,
dispatch per-repo specialists in parallel (respecting the same-repo law and the
cap of 16), isolate each in its own git worktree, and have each specialist
deliver a PR, with cross-repo matters escalated to the PE.

**Spec:** `docs/superpowers/specs/2026-07-05-phase-b-operation-design.md`.

**Architecture:** Same skill+CLI split as onboarding. Three new deterministic
`aipe` subcommands (`worktree`, `dispatch`, `journey`) plus one coordinator
skill (`operate`). The CLI owns everything deterministic — the worktree
lifecycle + per-worktree git identity, the physical dispatch law, the journey
ledger; the coordinator (prompting) owns decomposition, sequencing via
`graph.yaml`, brief assembly, subagent dispatch, escalation to the PE.

**Tech Stack:** Bun + TypeScript strict, `bun test`, `yaml` for YAML, real
`git` invoked via `Bun.spawn` (mirrors `src/make-workspace/git.ts`).

## Global Constraints

- TypeScript **strict**; run `bunx tsc --noEmit -p tsconfig.json` before every commit.
- Tests with `bun test` (`import { expect, test } from "bun:test"`).
- Reuse `BrainFile`/`RepoEntry` from `src/context-brain/types.ts`, `readBrain`
  from `src/make-workspace/read.ts`, and `personaSlug` from
  `src/hire-specialists/render.ts` — **do not** re-implement brain reading or slugging.
- Worktree convention (foundation spec §6, confirmed 2026-07-05):
  path `<repo>/.worktrees/<journey-id>-<slug>/`, branch `aipe/<journey-id>/<slug>`.
- `journey-id` is **provided by the coordinator**, never invented in the
  worktree hot path; it must be slug-safe (`^[a-z0-9][a-z0-9-]*$`). The only
  place a timestamp is read is `aipe journey start` (overridable via `--id`).
- Per-worktree git identity: `user.name = aipe/<Persona>`, **`user.email`
  inherited** (real account), scoped with `extensions.worktreeConfig` so the
  PE's main repo config is never touched.
- `.worktrees/` is added to `<repo>/.git/info/exclude` (local, untracked) —
  never to a tracked `.gitignore`.
- `remove` guardrail: refuse (`BLOCKED`) if the worktree has uncommitted changes
  **or** commits not on any remote, unless `--force`.
- The dispatch law: same `repo` twice in one batch → reject; >16 entries →
  reject; unknown repo/specialist → reject. The CLI never reorders across repos.
- The **hiring brief is never persisted** — only the journey ledger is durable.
- Messages to the user in **English**; commits in English, Conventional Commits.

---

## File Structure

```
src/worktree/                    # Block 1 (foundational — built first)
  ├── types.ts                   # WorktreeSpec, WorktreeRow, result unions
  ├── naming.ts                  # isValidJourneyId(), deriveSpec() (pure)
  ├── git.ts                     # Bun.spawn git wrappers (add/remove/list/identity/exclude/base/isDirtyOrUnpushed)
  ├── run.ts                     # createWorktree/listWorktrees/removeWorktree orchestration
  ├── cli.ts                     # `aipe worktree <create|list|remove>` parsing + OK/WT/BLOCKED/ERROR
  └── __tests__/{naming,run,cli}.test.ts
src/dispatch/                    # Block 2
  ├── types.ts                   # DispatchEntry, Batch, Verdict
  ├── law.ts                     # validateBatch() (pure)
  ├── cli.ts                     # `aipe dispatch validate --input <batch.json>`
  └── __tests__/{law,cli}.test.ts
src/journey/                     # Block 2
  ├── types.ts                   # JourneyLedger, JourneyDispatch
  ├── ledger.ts                  # read/merge/write .aipe/journeys/<id>.yaml
  ├── cli.ts                     # `aipe journey <start|record|show>`
  └── __tests__/{ledger,cli}.test.ts
skills/operate/SKILL.md          # Block 2 (coordinator Operation flow)
src/cli.ts                       # register the 3 new subcommands
```

---

# BLOCK 1 — Worktree-per-journey (foundational)

## Task 1: Types (`src/worktree/types.ts`)

- [ ] **Step 1: Write the types**

```ts
import type { BrainFile, RepoEntry } from "../context-brain/types";
export type { BrainFile, RepoEntry };

export interface WorktreeSpec {
  repo: string;        // repo name (from brain)
  specialist: string;  // persona display name
  journey: string;     // journey id
  slug: string;        // personaSlug(specialist)
  branch: string;      // aipe/<journey>/<slug>
  relPath: string;     // .worktrees/<journey>-<slug> (relative to the repo)
}

export interface WorktreeRow {
  repo: string;
  slug: string;
  journey: string;
  branch: string;
  path: string;        // absolute
}

export type CreateResult =
  | { ok: true; path: string; branch: string; created: boolean }
  | { ok: false; error: string };

export type RemoveResult =
  | { ok: true; path: string }
  | { ok: false; blocked: boolean; error: string };
```

- [ ] **Step 2:** `bunx tsc --noEmit`. - [ ] **Step 3:** commit `feat: worktree types`.

---

## Task 2: Naming (`src/worktree/naming.ts`)

Pure derivation, no git. Consumes `personaSlug` from `../hire-specialists/render`.

- [ ] **Step 1: Failing test** `__tests__/naming.test.ts`:

```ts
import { expect, test } from "bun:test";
import { deriveSpec, isValidJourneyId } from "../naming";

test("isValidJourneyId accepts slug-safe ids, rejects others", () => {
  expect(isValidJourneyId("j-20260705-a1")).toBe(true);
  expect(isValidJourneyId("abc")).toBe(true);
  expect(isValidJourneyId("has/slash")).toBe(false);
  expect(isValidJourneyId("has space")).toBe(false);
  expect(isValidJourneyId("-leading")).toBe(false);
  expect(isValidJourneyId("")).toBe(false);
});

test("deriveSpec builds branch and relPath from journey + specialist", () => {
  const spec = deriveSpec("embark", "j-20260705-a1", "Joaquim");
  expect(spec.slug).toBe("joaquim");
  expect(spec.branch).toBe("aipe/j-20260705-a1/joaquim");
  expect(spec.relPath).toBe(".worktrees/j-20260705-a1-joaquim");
});

test("deriveSpec slugifies multi-word / accented names", () => {
  const spec = deriveSpec("embark", "j1", "Ana Maria");
  expect(spec.slug).toBe("ana-maria");
  expect(spec.branch).toBe("aipe/j1/ana-maria");
});
```

- [ ] **Step 2:** run → FAIL (no module). - [ ] **Step 3: Implement** `naming.ts`:

```ts
import { join } from "node:path";
import { personaSlug } from "../hire-specialists/render";
import type { WorktreeSpec } from "./types";

export function isValidJourneyId(id: string): boolean {
  return /^[a-z0-9][a-z0-9-]*$/.test(id);
}

export function deriveSpec(repo: string, journey: string, specialist: string): WorktreeSpec {
  const slug = personaSlug(specialist);
  return {
    repo,
    specialist,
    journey,
    slug,
    branch: `aipe/${journey}/${slug}`,
    relPath: join(".worktrees", `${journey}-${slug}`),
  };
}
```

- [ ] **Step 4:** run → PASS (3). - [ ] **Step 5:** commit `feat: worktree naming and journey-id validation`.

---

## Task 3: Git wrappers (`src/worktree/git.ts`)

Thin `Bun.spawn` wrappers, mirroring `make-workspace/git.ts`'s `run()`. No unit
test of its own — exercised end-to-end by Task 4's real-git integration tests
(same posture as `make-workspace`, but purely local git ops: no network, no
remote-URL rewrite, so not subject to the known env-flaky test).

- [ ] **Step 1: Implement** `git.ts`:

```ts
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export async function run(cmd: string[], cwd?: string): Promise<{ code: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(cmd, { cwd, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  return { code: await proc.exited, stdout: stdout.trim(), stderr: stderr.trim() };
}

export async function defaultBase(repoAbs: string): Promise<string> {
  const head = await run(["git", "-C", repoAbs, "symbolic-ref", "--short", "refs/remotes/origin/HEAD"]);
  if (head.code === 0 && head.stdout) return head.stdout.replace(/^origin\//, "");
  const cur = await run(["git", "-C", repoAbs, "rev-parse", "--abbrev-ref", "HEAD"]);
  return cur.code === 0 && cur.stdout ? cur.stdout : "HEAD";
}

export async function gitDir(repoAbs: string): Promise<string> {
  const r = await run(["git", "-C", repoAbs, "rev-parse", "--absolute-git-dir"]);
  return r.stdout;
}

export async function ensureExcluded(repoAbs: string, entry: string): Promise<void> {
  const dir = await gitDir(repoAbs);
  const excludePath = join(dir, "info", "exclude");
  let current = "";
  try { current = await readFile(excludePath, "utf8"); } catch { /* create below */ }
  const lines = current.split("\n").map((l) => l.trim());
  if (lines.includes(entry)) return;
  const next = current.endsWith("\n") || current === "" ? current : current + "\n";
  await writeFile(excludePath, `${next}${entry}\n`, "utf8");
}

export async function listPorcelain(repoAbs: string): Promise<{ path: string; branch: string }[]> {
  const r = await run(["git", "-C", repoAbs, "worktree", "list", "--porcelain"]);
  if (r.code !== 0) return [];
  const out: { path: string; branch: string }[] = [];
  let path = "";
  for (const line of r.stdout.split("\n")) {
    if (line.startsWith("worktree ")) path = line.slice("worktree ".length);
    else if (line.startsWith("branch ")) out.push({ path, branch: line.slice("branch ".length).replace(/^refs\/heads\//, "") });
  }
  return out;
}

export async function branchExists(repoAbs: string, branch: string): Promise<boolean> {
  const r = await run(["git", "-C", repoAbs, "rev-parse", "--verify", "--quiet", `refs/heads/${branch}`]);
  return r.code === 0;
}

export async function worktreeAdd(repoAbs: string, wtAbs: string, branch: string, base: string): Promise<{ ok: boolean; message?: string }> {
  const args = (await branchExists(repoAbs, branch))
    ? ["git", "-C", repoAbs, "worktree", "add", wtAbs, branch]
    : ["git", "-C", repoAbs, "worktree", "add", "-b", branch, wtAbs, base];
  const r = await run(args);
  return r.code === 0 ? { ok: true } : { ok: false, message: r.stderr || `git worktree add failed (${r.code})` };
}

export async function setWorktreeIdentity(repoAbs: string, wtAbs: string, name: string): Promise<void> {
  await run(["git", "-C", repoAbs, "config", "extensions.worktreeConfig", "true"]);
  await run(["git", "-C", wtAbs, "config", "--worktree", "user.name", name]);
}

export async function isDirtyOrUnpushed(wtAbs: string): Promise<boolean> {
  const status = await run(["git", "-C", wtAbs, "status", "--porcelain"]);
  if (status.stdout.length > 0) return true;
  const unpushed = await run(["git", "-C", wtAbs, "rev-list", "--count", "HEAD", "--not", "--remotes"]);
  return unpushed.code === 0 && unpushed.stdout !== "0" && unpushed.stdout !== "";
}

export async function worktreeRemove(repoAbs: string, wtAbs: string, force: boolean): Promise<{ ok: boolean; message?: string }> {
  const args = ["git", "-C", repoAbs, "worktree", "remove", ...(force ? ["--force"] : []), wtAbs];
  const r = await run(args);
  return r.code === 0 ? { ok: true } : { ok: false, message: r.stderr || `git worktree remove failed (${r.code})` };
}
```

- [ ] **Step 2:** `bunx tsc --noEmit`. - [ ] **Step 3:** commit `feat: worktree git wrappers`.

---

## Task 4: Orchestration (`src/worktree/run.ts`) — real-git integration tests

- [ ] **Step 1: Failing test** `__tests__/run.test.ts` — build a real temp repo,
  create/list/remove a worktree, assert the branch, the per-worktree identity,
  the exclude entry, idempotency, and the remove guardrail. Key cases:
  - `createWorktree` makes `<repo>/.worktrees/<journey>-<slug>/`, on branch
    `aipe/<journey>/<slug>`, with `git config --worktree user.name` =
    `aipe/<Persona>` (and `user.email` NOT overridden in the worktree config).
  - `.worktrees/` is present in `.git/info/exclude`.
  - second `createWorktree` with the same args → `created: false`, no error.
  - `listWorktrees` returns a row for the created worktree (repo, slug, journey, branch).
  - `removeWorktree` on a clean, base-only worktree succeeds.
  - `removeWorktree` with an uncommitted file → `blocked: true`; with `--force` → succeeds.
  - unknown repo → `ok: false`.
  - invalid journey id → `ok: false`.

  Helper to build a repo: `git init`, set a throwaway `user.email`/`user.name`,
  write a file, `git add`+`commit`, and (for the unpushed check) leave it with
  no remote so a base-only worktree has 0 commits beyond base.

- [ ] **Step 2:** run → FAIL. - [ ] **Step 3: Implement** `run.ts`:

```ts
import { access } from "node:fs/promises";
import { join } from "node:path";
import { readBrain } from "../make-workspace/read";
import { deriveSpec, isValidJourneyId } from "./naming";
import { defaultBase, ensureExcluded, isDirtyOrUnpushed, listPorcelain, setWorktreeIdentity, worktreeAdd, worktreeRemove } from "./git";
import type { CreateResult, RemoveResult, WorktreeRow } from "./types";

const WORKTREES_DIR = ".worktrees";

async function repoAbsOf(workspaceDir: string, repoName: string): Promise<{ ok: true; abs: string } | { ok: false; error: string }> {
  const brain = await readBrain(workspaceDir);
  if (!brain.ok) return { ok: false, error: brain.error };
  const repo = brain.brain.repos.find((r) => r.name === repoName);
  if (!repo) return { ok: false, error: `unknown-repo ${repoName}` };
  return { ok: true, abs: join(workspaceDir, repo.path) };
}

export async function createWorktree(
  workspaceDir: string,
  opts: { repo: string; specialist: string; journey: string; base?: string },
): Promise<CreateResult> {
  if (!isValidJourneyId(opts.journey)) return { ok: false, error: `invalid-journey ${opts.journey}` };
  const resolved = await repoAbsOf(workspaceDir, opts.repo);
  if (!resolved.ok) return { ok: false, error: resolved.error };

  const spec = deriveSpec(opts.repo, opts.journey, opts.specialist);
  const wtAbs = join(resolved.abs, spec.relPath);

  await ensureExcluded(resolved.abs, `${WORKTREES_DIR}/`);

  const existing = await listPorcelain(resolved.abs);
  if (existing.some((w) => w.path === wtAbs || w.branch === spec.branch)) {
    return { ok: true, path: wtAbs, branch: spec.branch, created: false };
  }

  const base = opts.base ?? (await defaultBase(resolved.abs));
  const added = await worktreeAdd(resolved.abs, wtAbs, spec.branch, base);
  if (!added.ok) return { ok: false, error: added.message ?? "worktree add failed" };

  await setWorktreeIdentity(resolved.abs, wtAbs, `aipe/${opts.specialist}`);
  return { ok: true, path: wtAbs, branch: spec.branch, created: true };
}

export async function listWorktrees(workspaceDir: string, journey?: string): Promise<WorktreeRow[]> {
  const brain = await readBrain(workspaceDir);
  if (!brain.ok) return [];
  const rows: WorktreeRow[] = [];
  for (const repo of brain.brain.repos) {
    const repoAbs = join(workspaceDir, repo.path);
    for (const w of await listPorcelain(repoAbs)) {
      const m = /^aipe\/([^/]+)\/(.+)$/.exec(w.branch);
      if (!m) continue;
      const [, j, slug] = m;
      if (journey && j !== journey) continue;
      rows.push({ repo: repo.name, slug: slug!, journey: j!, branch: w.branch, path: w.path });
    }
  }
  return rows;
}

export async function removeWorktree(
  workspaceDir: string,
  opts: { repo: string; specialist: string; journey: string; force?: boolean },
): Promise<RemoveResult> {
  if (!isValidJourneyId(opts.journey)) return { ok: false, blocked: false, error: `invalid-journey ${opts.journey}` };
  const resolved = await repoAbsOf(workspaceDir, opts.repo);
  if (!resolved.ok) return { ok: false, blocked: false, error: resolved.error };

  const spec = deriveSpec(opts.repo, opts.journey, opts.specialist);
  const wtAbs = join(resolved.abs, spec.relPath);
  try { await access(wtAbs); } catch { return { ok: false, blocked: false, error: `not-found ${wtAbs}` }; }

  if (!opts.force && (await isDirtyOrUnpushed(wtAbs))) {
    return { ok: false, blocked: true, error: "uncommitted or unpushed work — pass --force to discard" };
  }

  const removed = await worktreeRemove(resolved.abs, wtAbs, opts.force ?? false);
  if (!removed.ok) return { ok: false, blocked: false, error: removed.message ?? "worktree remove failed" };
  return { ok: true, path: wtAbs };
}
```

- [ ] **Step 4:** run → PASS. - [ ] **Step 5:** commit `feat: worktree create/list/remove orchestration`.

---

## Task 5: CLI (`src/worktree/cli.ts`) + wiring into `src/cli.ts`

- [ ] **Step 1: Failing test** `__tests__/cli.test.ts` — unit-test the pure
  `renderRows()` (WT lines) and a full `run(["create", ...])` against a temp repo
  asserting the `OK <path> <branch>` line and exit 0; `create` with a bad journey
  → `ERROR` + exit 1; `remove` blocked → `BLOCKED` + exit 1.

- [ ] **Step 2:** run → FAIL. - [ ] **Step 3: Implement** `cli.ts` exporting
  `run(args): Promise<number>`:
  - `aipe worktree create --repo --specialist --journey [--base] [--workspace]`
    → `OK <path> <branch>` (or `EXISTS <path> <branch>` when `created:false`); exit 0.
  - `aipe worktree list [--journey] [--workspace]` → one `WT <repo> <slug> <journey> <branch> <path>` per row; exit 0.
  - `aipe worktree remove --repo --specialist --journey [--force] [--workspace]`
    → `OK removed <path>` / `BLOCKED <reason>` (exit 1) / `ERROR <reason>` (exit 1).
  - `getFlag` / `hasFlag` helpers, same style as `hire-specialists/cli.ts`.
  - `run(args)` reads `args[0]` as the sub-subcommand; unknown → `ERROR` + usage.

- [ ] **Step 4:** wire into `src/cli.ts`: `import { run as worktree } from "./worktree/cli"`, add `worktree` to `SUBCOMMANDS` + a `HELP` line.
- [ ] **Step 5:** `bun test && bunx tsc --noEmit`. - [ ] **Step 6:** commit `feat: aipe worktree subcommand`.

---

# BLOCK 2 — Dispatch mechanics

## Task 6: Dispatch law (`src/dispatch/law.ts` + `aipe dispatch validate`)

- [ ] **Types** `src/dispatch/types.ts`: `DispatchEntry { repo; specialist }`,
  `Batch = DispatchEntry[]`, `Verdict = { ok: true } | { ok: false; rejects: string[] }`.
- [ ] **Failing test** `__tests__/law.test.ts`: same-repo twice → reject
  `same-repo <repo>`; 17 distinct entries → reject `cap-exceeded 17`; unknown
  repo → `unknown-repo`; unknown specialist (not in personas.yaml for that repo)
  → `unknown-specialist`; a lawful batch of distinct repos ≤16 → `{ ok: true }`.
- [ ] **Implement** `law.ts`: `validateBatch(batch, brain, personas): Verdict`,
  pure. Cap constant `MAX_CONCURRENT = 16`. Existence checks read the
  `personas.yaml` roster (`PersonaRegistryEntry[]`) filtered by `repo`.
- [ ] **CLI** `src/dispatch/cli.ts`: `aipe dispatch validate --input <batch.json>
  [--workspace]` → reads brain + `personas.yaml`, prints `OK` or one
  `REJECT <reason>` per problem; exit 0/1. Wire into `src/cli.ts`.
- [ ] Commit `feat: aipe dispatch validate (parallel-dispatch law)`.

## Task 7: Journey ledger (`src/journey/` + `aipe journey`)

- [ ] **Types**: `JourneyDispatch { repo; specialist; branch; worktree; pr?; status }`,
  `JourneyLedger { id; dispatches: JourneyDispatch[] }`.
- [ ] **Failing test** `__tests__/ledger.test.ts`: `start` writes
  `.aipe/journeys/<id>.yaml`; `record` upserts a dispatch by `(repo, specialist)`
  preserving others; `read` round-trips; unknown journey `show` → empty/So error.
- [ ] **Implement** `ledger.ts` (read/merge/write, `yaml`) + `cli.ts`
  (`start [--id] [--workspace]`, `record --journey --repo --specialist --branch
  --worktree [--pr] [--status]`, `show --journey`). `start` mints
  `j-<YYYYMMDD>-<rand2>` only when `--id` absent (the sole timestamp read).
  Wire into `src/cli.ts`. Commit `feat: aipe journey ledger`.

## Task 8: `operate` skill + persona brief prose

- [ ] **Create** `skills/operate/SKILL.md` — the coordinator Operation flow:
  1. On a demand, mint a journey (`aipe journey start`).
  2. Decompose into per-repo tasks; sequence cross-repo order using
     `.aipe/relations/graph.yaml` (dependency-first).
  3. For each parallel wave: build a batch → `aipe dispatch validate` → on `OK`,
     `aipe worktree create` per entry.
  4. For each entry, read the persona's `SKILL.md` body from
     `<repo>/.claude/skills/<slug>/SKILL.md` and dispatch a subagent whose prompt
     = that identity + the canonical hiring brief (spec §4.2) + "operate strictly
     inside `<worktree>`; return `{status: delivered, pr}` or `{status: escalate, …}`".
  5. Record each dispatch (`aipe journey record`), collect results.
  6. Present every `escalate` to the PE; on approval, form the next wave for the
     target repo (dependency-first) and loop.
  7. On merge, `aipe worktree remove` (guardrail-protected).
  - **Rules block:** never edit another repo from within a specialist; the law is
    adjudicated by `aipe dispatch validate`, not by hand; the brief is never
    written to disk; each specialist opens its own PR (persona-namespaced author).
- [ ] **Persona brief prose:** confirm the two-mode persona `SKILL.md` already
  tells a dispatched persona how to read a brief (it does — `hire-specialists`
  decision 8); if the §4.2 field names help, add a short "a brief looks like:"
  note to `render.ts`'s template (doc-only, re-generated on next hire). Decide in
  execution whether this is worth a template change or stays skill-only.
- [ ] Commit `feat: operate skill for Phase B dispatch`.

---

## Task 9: Whole-block verification + dossier

- [ ] `bun test` (whole repo) + `bunx tsc --noEmit` green (modulo the known
  env-only `make-workspace/git.test.ts` remote-URL case).
- [ ] End-to-end smoke through the **compiled** `bin/aipe`: create a temp
  workspace with two fake git repos + a `brain.yaml`/`personas.yaml`; run
  `aipe worktree create` for two distinct repos, `aipe dispatch validate` on a
  lawful and an unlawful batch, `aipe journey start/record/show`, then
  `aipe worktree remove`.
- [ ] Add dossier entry `docs/dossie/07-phase-b-operation.md` (decisions, plan,
  execution, review, final state) and update `docs/dossie/README.md` +
  `README.md` status table.

---

## Out of scope (this cycle)

- Headless-session dispatch, CLI-derived cross-repo sequencing, persisted hiring
  brief, HR cost gate beyond the hard cap, `/aipe-add-repo`, release/Cloudflare
  wiring, non-Claude-Code harness adapters (see spec §8).
