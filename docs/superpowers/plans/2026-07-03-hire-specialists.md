# /hire-specialists Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **As-built note (2026-07-04):** renamed from `context-brain-generator` to
> `hire-specialists`; the `generator` phase became `specialists`; the module
> lives at `src/hire-specialists/` and is invoked as the `aipe
> hire-specialists` subcommand of the unified binary (not `bun …/cli.ts`).
> The per-task `~/aipe-worktree-*` and `bun src/…/cli.ts` commands below are
> historical; the code was implemented in-place on the session branch. See
> dossier entry 05 for what actually shipped.

**Goal:** Generate, for every repo in a context, exactly 2 personas (1 dev-fullstack + 1 QA) installed as two-mode skills inside that repo, plus a cross-repo `.aipe/personas.yaml` registry (coordinator + every persona).

**Architecture:** Same skill+CLI split as `/relationship`, with one extra deterministic step before dispatch: name resolution. The coordinator asks the PE for names (or leaves them blank), the CLI's `--resolve-names` mode fills gaps from a built-in pool and guarantees uniqueness across the whole context, then the coordinator dispatches 2N agents (one per repo × role) with their final names, each writing the prose body of a persona skill file grounded in that repo's `stack` (`brain.yaml`) and relations (`graph.yaml`). A second CLI invocation (the default mode) validates the 2N reports, writes every `SKILL.md`, writes `personas.yaml`, and updates `state.yaml`.

**Tech Stack:** Bun + TypeScript strict, `bun test`, `yaml` package for YAML files, plain `JSON.parse` for the per-persona report files (the coordinator writes those, not the CLI).

## Global Constraints

- TypeScript **strict** (inherits the repo's `tsconfig.json`); run `bunx tsc --noEmit -p tsconfig.json` before every commit (does not run as part of `bun test`).
- Tests with `bun test` (import `{ expect, test } from "bun:test"`).
- Reuse `BrainFile`, `RepoEntry`, `Phase`, `StateFile` from `src/context-brain/types.ts`, `readBrain` from `src/make-workspace/read.ts`, and `initialState` from `src/context-brain/write.ts` — **do not** redefine or re-implement brain reading/validation/state defaults.
- Persona `role` is a **closed enum**: `dev-fullstack | qa`. No free text, no additional roles.
- **Always exactly 2 personas per repo** — 1 `dev-fullstack` + 1 `qa`, regardless of the repo's detected `stack`. Never split by sub-stack.
- **Name resolution happens in its own CLI mode (`--resolve-names`), before dispatch** — an agent must receive its final name before it writes identity prose. Uniqueness is enforced across the *entire* context: no two personas (nor the coordinator) share a name, case-insensitively.
- Built-in name pool (used to fill any name the PE didn't provide), in this exact order: `Alice, Bruno, Carla, Diego, Elena, Felipe, Gabriela, Hugo, Isabela, Joaquim, Karen, Lucas, Marina, Nicolas, Olivia, Pedro, Quintino, Rafaela, Samuel, Tania, Ursula, Victor, Wanda, Xavier, Yasmin, Zeca`. If the pool is exhausted (more than 26 personas needed), fall back to `persona-1`, `persona-2`, ... until an unused one is found.
- Slugification for a persona's directory name and skill `name:` frontmatter field: lowercase, non-alphanumeric runs collapsed to a single `-`, leading/trailing `-` trimmed (e.g. `Joaquim` → `joaquim`).
- The materialize CLI mode **defensively deduplicates** reports by name (case-insensitive) and drops any report whose name equals the coordinator's — first occurrence wins, later duplicates are silently dropped (never overwritten in place), keeping the invariant intact even if two live agents somehow returned the same name.
- `state.phase.specialists` becomes `done` only if **every** `(repo, role)` pair — 2 per repo — has a valid report; otherwise `pending`.
- `.aipe/specialists/.reports/` (transient staging) is deleted **only when the phase reaches `done`** — when `pending`, it's left in place so a coordinator retry can add just the missing `(repo, role)` reports without losing the ones that already succeeded.
- The **hiring brief is never a persisted artifact** — no template file is written by this CLI or this skill. A persona's `SKILL.md` only documents in prose how to interpret one when received.
- Messages to the user in **English**; commits in English following Conventional Commits.

---

## File Structure

```
src/hire-specialists/
  ├── types.ts        # PersonaRole, PersonaAssignment, NamingResult, ProvidedNames, PersonaReport, PersonaRegistryEntry, SpecialistsPhase
  ├── naming.ts         # resolveNames(), dedupeReportsByName(): pure name resolution + collision handling
  ├── render.ts         # personaSlug(), renderSkillMd(): pure SKILL.md assembly from a validated PersonaReport
  ├── reports.ts        # readReports(): reads + validates .reports/*.json from disk
  ├── registry.ts       # buildRegistry(), renderPersonasYaml(): pure personas.yaml assembly
  ├── state.ts          # updateSpecialistsPhase(): updates state.yaml preserving other phases
  ├── run.ts            # resolvePersonaNames(), runHireSpecialists(): orchestration
  ├── cli.ts            # flag parsing, two modes (--resolve-names / materialize), renderReport (pure), wiring
  └── __tests__/
       ├── naming.test.ts
       ├── render.test.ts
       ├── reports.test.ts
       ├── registry.test.ts
       ├── state.test.ts
       ├── run.test.ts
       └── cli.test.ts
skills/hire-specialists/SKILL.md
```

---

## Task 1: Types (`types.ts`)

**Files:**
- Create: `src/hire-specialists/types.ts`

**Interfaces:**
- Consumes: `BrainFile`, `RepoEntry`, `Phase`, `StateFile` from `src/context-brain/types.ts` (re-exported).
- Produces:
  - `type PersonaRole = "dev-fullstack" | "qa"`
  - `interface PersonaAssignment { repo: string; role: PersonaRole; name: string }`
  - `interface NamingResult { coordinator: string; personas: PersonaAssignment[] }`
  - `interface ProvidedNames { [repo: string]: { devFullstack?: string | null; qa?: string | null } }`
  - `interface PersonaReport { repo: string; role: PersonaRole; name: string; body: string }`
  - `interface PersonaRegistryEntry { name: string; role: PersonaRole | "coordinator"; repo: string | null; path: string | null }`
  - `type SpecialistsPhase = "pending" | "done"`

- [ ] **Step 1: Write the types**

Create `src/hire-specialists/types.ts`:

```ts
import type { BrainFile, Phase, RepoEntry, StateFile } from "../context-brain/types";

export type { BrainFile, Phase, RepoEntry, StateFile };

export type PersonaRole = "dev-fullstack" | "qa";

export interface PersonaAssignment {
  repo: string;
  role: PersonaRole;
  name: string;
}

export interface NamingResult {
  coordinator: string;
  personas: PersonaAssignment[];
}

export interface ProvidedNames {
  [repo: string]: { devFullstack?: string | null; qa?: string | null };
}

export interface PersonaReport {
  repo: string;
  role: PersonaRole;
  name: string;
  body: string;
}

export interface PersonaRegistryEntry {
  name: string;
  role: PersonaRole | "coordinator";
  repo: string | null;
  path: string | null;
}

export type SpecialistsPhase = "pending" | "done";
```

- [ ] **Step 2: Type-check**

Run: `cd ~/aipe-worktree-hire-specialists && bunx tsc --noEmit -p tsconfig.json`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
cd ~/aipe-worktree-hire-specialists && git add src/hire-specialists/types.ts
git commit -m "feat: hire-specialists types"
```

---

## Task 2: Naming (`naming.ts`)

**Files:**
- Create: `src/hire-specialists/naming.ts`
- Test: `src/hire-specialists/__tests__/naming.test.ts`

**Interfaces:**
- Consumes: `BrainFile`, `NamingResult`, `PersonaAssignment`, `ProvidedNames`, `PersonaReport` from `./types`.
- Produces:
  - `resolveNames(brain: BrainFile, provided: ProvidedNames): NamingResult`
  - `dedupeReportsByName(reports: PersonaReport[], coordinatorName: string): PersonaReport[]`

- [ ] **Step 1: Write the failing test**

Create `src/hire-specialists/__tests__/naming.test.ts`:

```ts
import { expect, test } from "bun:test";
import { dedupeReportsByName, resolveNames } from "../naming";
import type { BrainFile, PersonaReport, ProvidedNames } from "../types";

const brain: BrainFile = {
  context: { name: "opvibes", coordinator: "Nicolas" },
  repos: [
    { name: "embark", url: "git@github.com:opvibes/embark.git", path: "./embark" },
    { name: "prontuario", url: "git@github.com:opvibes/prontuario.git", path: "./prontuario" },
  ],
};

test("produces exactly 2 personas per repo (dev-fullstack + qa)", () => {
  const result = resolveNames(brain, {});
  expect(result.personas).toHaveLength(4);
  expect(result.personas.filter((p) => p.repo === "embark").map((p) => p.role).sort()).toEqual(["dev-fullstack", "qa"]);
  expect(result.personas.filter((p) => p.repo === "prontuario").map((p) => p.role).sort()).toEqual(["dev-fullstack", "qa"]);
});

test("uses PE-provided names when present", () => {
  const provided: ProvidedNames = { embark: { devFullstack: "Joaquim", qa: "Marina" } };
  const result = resolveNames(brain, provided);
  const embarkDev = result.personas.find((p) => p.repo === "embark" && p.role === "dev-fullstack");
  const embarkQa = result.personas.find((p) => p.repo === "embark" && p.role === "qa");
  expect(embarkDev?.name).toBe("Joaquim");
  expect(embarkQa?.name).toBe("Marina");
});

test("fills missing names from the built-in pool, never colliding with the coordinator", () => {
  const result = resolveNames(brain, {});
  const names = [result.coordinator, ...result.personas.map((p) => p.name)].map((n) => n.toLowerCase());
  expect(new Set(names).size).toBe(names.length);
  expect(result.coordinator).toBe("Nicolas");
});

test("re-picks from the pool when a provided name collides with an already-used name", () => {
  const provided: ProvidedNames = {
    embark: { devFullstack: "Nicolas", qa: null },
    prontuario: { devFullstack: null, qa: null },
  };
  const result = resolveNames(brain, provided);
  const embarkDev = result.personas.find((p) => p.repo === "embark" && p.role === "dev-fullstack");
  expect(embarkDev?.name).not.toBe("Nicolas");
  const names = [result.coordinator, ...result.personas.map((p) => p.name)].map((n) => n.toLowerCase());
  expect(new Set(names).size).toBe(names.length);
});

test("dedupeReportsByName keeps the first occurrence of a duplicate name", () => {
  const reports: PersonaReport[] = [
    { repo: "embark", role: "dev-fullstack", name: "Joaquim", body: "first" },
    { repo: "prontuario", role: "dev-fullstack", name: "Joaquim", body: "second" },
  ];
  const kept = dedupeReportsByName(reports, "Nicolas");
  expect(kept).toHaveLength(1);
  expect(kept[0]?.body).toBe("first");
});

test("dedupeReportsByName drops a report whose name matches the coordinator's, case-insensitively", () => {
  const reports: PersonaReport[] = [{ repo: "embark", role: "qa", name: "nicolas", body: "oops" }];
  const kept = dedupeReportsByName(reports, "Nicolas");
  expect(kept).toHaveLength(0);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd ~/aipe-worktree-hire-specialists && bun test src/hire-specialists/__tests__/naming.test.ts`
Expected: FAIL — `Cannot find module "../naming"`.

- [ ] **Step 3: Implement `naming.ts`**

Create `src/hire-specialists/naming.ts`:

```ts
import type { BrainFile, NamingResult, PersonaAssignment, PersonaReport, ProvidedNames } from "./types";

const NAME_POOL = [
  "Alice", "Bruno", "Carla", "Diego", "Elena", "Felipe", "Gabriela", "Hugo",
  "Isabela", "Joaquim", "Karen", "Lucas", "Marina", "Nicolas", "Olivia", "Pedro",
  "Quintino", "Rafaela", "Samuel", "Tania", "Ursula", "Victor", "Wanda", "Xavier",
  "Yasmin", "Zeca",
];

function pickUnused(used: Set<string>): string {
  for (const candidate of NAME_POOL) {
    if (!used.has(candidate.toLowerCase())) return candidate;
  }
  let i = 1;
  while (used.has(`persona-${i}`)) i++;
  return `persona-${i}`;
}

export function resolveNames(brain: BrainFile, provided: ProvidedNames): NamingResult {
  const used = new Set<string>([brain.context.coordinator.toLowerCase()]);
  const personas: PersonaAssignment[] = [];

  for (const repo of brain.repos) {
    for (const role of ["dev-fullstack", "qa"] as const) {
      const key = role === "dev-fullstack" ? "devFullstack" : "qa";
      const suggested = provided[repo.name]?.[key];
      let name = suggested && suggested.trim().length > 0 ? suggested.trim() : undefined;

      if (!name || used.has(name.toLowerCase())) {
        name = pickUnused(used);
      }

      used.add(name.toLowerCase());
      personas.push({ repo: repo.name, role, name });
    }
  }

  return { coordinator: brain.context.coordinator, personas };
}

export function dedupeReportsByName(reports: PersonaReport[], coordinatorName: string): PersonaReport[] {
  const seen = new Set<string>([coordinatorName.toLowerCase()]);
  const kept: PersonaReport[] = [];
  for (const report of reports) {
    const key = report.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(report);
  }
  return kept;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd ~/aipe-worktree-hire-specialists && bun test src/hire-specialists/__tests__/naming.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
cd ~/aipe-worktree-hire-specialists && git add src/hire-specialists/naming.ts src/hire-specialists/__tests__/naming.test.ts
git commit -m "feat: persona name resolution and dedupe"
```

---

## Task 3: Rendering (`render.ts`)

**Files:**
- Create: `src/hire-specialists/render.ts`
- Test: `src/hire-specialists/__tests__/render.test.ts`

**Interfaces:**
- Consumes: `PersonaReport`, `PersonaRole` from `./types`.
- Produces:
  - `personaSlug(name: string): string`
  - `renderSkillMd(report: PersonaReport, stack: string[]): string`

- [ ] **Step 1: Write the failing test**

Create `src/hire-specialists/__tests__/render.test.ts`:

```ts
import { expect, test } from "bun:test";
import { personaSlug, renderSkillMd } from "../render";
import type { PersonaReport } from "../types";

test("personaSlug lowercases and hyphenates a name", () => {
  expect(personaSlug("Joaquim")).toBe("joaquim");
  expect(personaSlug("Ana Maria")).toBe("ana-maria");
  expect(personaSlug(" -Zé- ")).toBe("ze");
});

test("renderSkillMd produces frontmatter with the slugified name", () => {
  const report: PersonaReport = { repo: "embark", role: "dev-fullstack", name: "Joaquim", body: "You are Joaquim." };
  const md = renderSkillMd(report, ["typescript", "bun"]);
  expect(md).toContain("name: joaquim");
  expect(md).toContain("description: Fullstack specialist for the embark repo (typescript, bun).");
  expect(md).toContain("You are Joaquim.");
});

test("renderSkillMd uses the QA label for qa role", () => {
  const report: PersonaReport = { repo: "embark", role: "qa", name: "Marina", body: "You are Marina." };
  const md = renderSkillMd(report, ["typescript"]);
  expect(md).toContain("description: QA specialist for the embark repo (typescript).");
});

test("renderSkillMd falls back to 'unknown stack' when stack is empty", () => {
  const report: PersonaReport = { repo: "embark", role: "dev-fullstack", name: "Joaquim", body: "body" };
  const md = renderSkillMd(report, []);
  expect(md).toContain("(unknown stack)");
});

test("renderSkillMd starts with YAML frontmatter delimiters", () => {
  const report: PersonaReport = { repo: "embark", role: "qa", name: "Marina", body: "body" };
  const md = renderSkillMd(report, ["typescript"]);
  const lines = md.split("\n");
  expect(lines[0]).toBe("---");
  expect(lines.slice(1).findIndex((l) => l === "---")).toBeGreaterThan(0);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd ~/aipe-worktree-hire-specialists && bun test src/hire-specialists/__tests__/render.test.ts`
Expected: FAIL — `Cannot find module "../render"`.

- [ ] **Step 3: Implement `render.ts`**

Create `src/hire-specialists/render.ts`:

```ts
import type { PersonaReport, PersonaRole } from "./types";

const ROLE_LABEL: Record<PersonaRole, string> = {
  "dev-fullstack": "Fullstack specialist",
  qa: "QA specialist",
};

export function personaSlug(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-+|-+$)/g, "");
}

export function renderSkillMd(report: PersonaReport, stack: string[]): string {
  const slug = personaSlug(report.name);
  const stackLabel = stack.length > 0 ? stack.join(", ") : "unknown stack";
  const description = `${ROLE_LABEL[report.role]} for the ${report.repo} repo (${stackLabel}). Dispatched by the coordinator for tasks scoped to ${report.repo}, or worn directly when a session opens inside this repo.`;

  return `---\nname: ${slug}\ndescription: ${description}\n---\n\n${report.body.trim()}\n`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd ~/aipe-worktree-hire-specialists && bun test src/hire-specialists/__tests__/render.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
cd ~/aipe-worktree-hire-specialists && git add src/hire-specialists/render.ts src/hire-specialists/__tests__/render.test.ts
git commit -m "feat: persona SKILL.md rendering"
```

---

## Task 4: Report reading (`reports.ts`)

**Files:**
- Create: `src/hire-specialists/reports.ts`
- Test: `src/hire-specialists/__tests__/reports.test.ts`

**Interfaces:**
- Consumes: `PersonaReport` from `./types`.
- Produces: `readReports(reportsDir: string): Promise<PersonaReport[]>`

- [ ] **Step 1: Write the failing test**

Create `src/hire-specialists/__tests__/reports.test.ts`:

```ts
import { expect, test } from "bun:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readReports } from "../reports";

test("reads and parses every valid report json file", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-gen-"));
  try {
    await writeFile(join(dir, "embark-dev-fullstack.json"), JSON.stringify({ repo: "embark", role: "dev-fullstack", name: "Joaquim", body: "b" }));
    await writeFile(join(dir, "embark-qa.json"), JSON.stringify({ repo: "embark", role: "qa", name: "Marina", body: "b" }));
    const reports = await readReports(dir);
    expect(reports.map((r) => r.name).sort()).toEqual(["Joaquim", "Marina"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("ignores non-json files", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-gen-"));
  try {
    await writeFile(join(dir, "embark-qa.json"), JSON.stringify({ repo: "embark", role: "qa", name: "Marina", body: "b" }));
    await writeFile(join(dir, "notes.txt"), "hello");
    const reports = await readReports(dir);
    expect(reports).toHaveLength(1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("skips a malformed json file instead of throwing", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-gen-"));
  try {
    await writeFile(join(dir, "embark-qa.json"), JSON.stringify({ repo: "embark", role: "qa", name: "Marina", body: "b" }));
    await writeFile(join(dir, "broken.json"), "{ not valid json");
    const reports = await readReports(dir);
    expect(reports).toHaveLength(1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("rejects a report with an out-of-enum role", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-gen-"));
  try {
    await writeFile(join(dir, "embark-lead.json"), JSON.stringify({ repo: "embark", role: "lead", name: "Someone", body: "b" }));
    const reports = await readReports(dir);
    expect(reports).toHaveLength(0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("rejects a report missing required fields", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-gen-"));
  try {
    await writeFile(join(dir, "incomplete.json"), JSON.stringify({ repo: "embark", role: "qa" }));
    const reports = await readReports(dir);
    expect(reports).toHaveLength(0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("returns an empty list when the directory does not exist", async () => {
  const reports = await readReports("/tmp/aipe-does-not-exist-ever");
  expect(reports).toEqual([]);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd ~/aipe-worktree-hire-specialists && bun test src/hire-specialists/__tests__/reports.test.ts`
Expected: FAIL — `Cannot find module "../reports"`.

- [ ] **Step 3: Implement `reports.ts`**

Create `src/hire-specialists/reports.ts`:

```ts
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { PersonaReport } from "./types";

const ROLES = new Set(["dev-fullstack", "qa"]);

function isValidReport(value: unknown): value is PersonaReport {
  if (typeof value !== "object" || value === null) return false;
  const r = value as Record<string, unknown>;
  return (
    typeof r.repo === "string" &&
    r.repo.trim().length > 0 &&
    typeof r.role === "string" &&
    ROLES.has(r.role) &&
    typeof r.name === "string" &&
    r.name.trim().length > 0 &&
    typeof r.body === "string" &&
    r.body.trim().length > 0
  );
}

export async function readReports(reportsDir: string): Promise<PersonaReport[]> {
  let files: string[];
  try {
    files = await readdir(reportsDir);
  } catch {
    return [];
  }

  const reports: PersonaReport[] = [];
  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    try {
      const raw = await readFile(join(reportsDir, file), "utf8");
      const parsed: unknown = JSON.parse(raw);
      if (isValidReport(parsed)) reports.push(parsed);
    } catch {
      // malformed report file: treated as a missing (repo, role) pair
    }
  }
  return reports;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd ~/aipe-worktree-hire-specialists && bun test src/hire-specialists/__tests__/reports.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
cd ~/aipe-worktree-hire-specialists && git add src/hire-specialists/reports.ts src/hire-specialists/__tests__/reports.test.ts
git commit -m "feat: persona report reading and validation"
```

---

## Task 5: Registry (`registry.ts`)

**Files:**
- Create: `src/hire-specialists/registry.ts`
- Test: `src/hire-specialists/__tests__/registry.test.ts`

**Interfaces:**
- Consumes: `BrainFile`, `PersonaRegistryEntry`, `PersonaReport` from `./types`; `personaSlug` from `./render`.
- Produces:
  - `buildRegistry(brain: BrainFile, reports: PersonaReport[]): PersonaRegistryEntry[]`
  - `renderPersonasYaml(entries: PersonaRegistryEntry[]): string`

- [ ] **Step 1: Write the failing test**

Create `src/hire-specialists/__tests__/registry.test.ts`:

```ts
import { expect, test } from "bun:test";
import { parse } from "yaml";
import { buildRegistry, renderPersonasYaml } from "../registry";
import type { BrainFile, PersonaReport } from "../types";

const brain: BrainFile = {
  context: { name: "opvibes", coordinator: "Nicolas" },
  repos: [{ name: "embark", url: "git@github.com:opvibes/embark.git", path: "./embark" }],
};

test("buildRegistry includes the coordinator entry with null repo/path", () => {
  const entries = buildRegistry(brain, []);
  expect(entries).toEqual([{ name: "Nicolas", role: "coordinator", repo: null, path: null }]);
});

test("buildRegistry adds one entry per report with a slugified skill path", () => {
  const reports: PersonaReport[] = [{ repo: "embark", role: "dev-fullstack", name: "Joaquim", body: "b" }];
  const entries = buildRegistry(brain, reports);
  const joaquim = entries.find((e) => e.name === "Joaquim");
  expect(joaquim).toEqual({ name: "Joaquim", role: "dev-fullstack", repo: "embark", path: "./embark/.claude/skills/joaquim" });
});

test("renderPersonasYaml produces parseable YAML with a personas list", () => {
  const entries = buildRegistry(brain, [{ repo: "embark", role: "qa", name: "Marina", body: "b" }]);
  const parsed = parse(renderPersonasYaml(entries));
  expect(parsed.personas).toHaveLength(2);
  expect(parsed.personas.map((p: { name: string }) => p.name).sort()).toEqual(["Marina", "Nicolas"]);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd ~/aipe-worktree-hire-specialists && bun test src/hire-specialists/__tests__/registry.test.ts`
Expected: FAIL — `Cannot find module "../registry"`.

- [ ] **Step 3: Implement `registry.ts`**

Create `src/hire-specialists/registry.ts`:

```ts
import { stringify } from "yaml";
import { personaSlug } from "./render";
import type { BrainFile, PersonaRegistryEntry, PersonaReport } from "./types";

export function buildRegistry(brain: BrainFile, reports: PersonaReport[]): PersonaRegistryEntry[] {
  const entries: PersonaRegistryEntry[] = [
    { name: brain.context.coordinator, role: "coordinator", repo: null, path: null },
  ];

  for (const report of reports) {
    const repo = brain.repos.find((r) => r.name === report.repo);
    const repoPath = repo?.path ?? `./${report.repo}`;
    entries.push({
      name: report.name,
      role: report.role,
      repo: report.repo,
      path: `${repoPath}/.claude/skills/${personaSlug(report.name)}`,
    });
  }

  return entries;
}

export function renderPersonasYaml(entries: PersonaRegistryEntry[]): string {
  return stringify({ personas: entries });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd ~/aipe-worktree-hire-specialists && bun test src/hire-specialists/__tests__/registry.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
cd ~/aipe-worktree-hire-specialists && git add src/hire-specialists/registry.ts src/hire-specialists/__tests__/registry.test.ts
git commit -m "feat: personas.yaml registry assembly"
```

---

## Task 6: `state.yaml` update (`state.ts`)

**Files:**
- Create: `src/hire-specialists/state.ts`
- Test: `src/hire-specialists/__tests__/state.test.ts`

**Interfaces:**
- Consumes: `Phase`, `StateFile` from `../context-brain/types`; `initialState` from `../context-brain/write`.
- Produces: `updateSpecialistsPhase(workspaceDir: string, phase: Phase): Promise<string>`.

- [ ] **Step 1: Write the failing test**

Create `src/hire-specialists/__tests__/state.test.ts`:

```ts
import { expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse, stringify } from "yaml";
import { updateSpecialistsPhase } from "../state";

test("updates specialists preserving the other phases", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-genst-"));
  try {
    await mkdir(join(dir, ".aipe"), { recursive: true });
    await writeFile(
      join(dir, ".aipe", "state.yaml"),
      stringify({ phase: { brain: "done", workspace: "done", relationship: "done", specialists: "pending" } }),
      "utf8",
    );

    const statePath = await updateSpecialistsPhase(dir, "done");
    const parsed = parse(await readFile(statePath, "utf8"));
    expect(parsed.phase.specialists).toBe("done");
    expect(parsed.phase.relationship).toBe("done");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("creates state from the default if missing", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-genst-"));
  try {
    const statePath = await updateSpecialistsPhase(dir, "pending");
    const parsed = parse(await readFile(statePath, "utf8"));
    expect(parsed.phase.brain).toBe("done");
    expect(parsed.phase.specialists).toBe("pending");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd ~/aipe-worktree-hire-specialists && bun test src/hire-specialists/__tests__/state.test.ts`
Expected: FAIL — `Cannot find module "../state"`.

- [ ] **Step 3: Implement `state.ts`**

Create `src/hire-specialists/state.ts`:

```ts
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parse, stringify } from "yaml";
import type { Phase, StateFile } from "../context-brain/types";
import { initialState } from "../context-brain/write";

export async function updateSpecialistsPhase(workspaceDir: string, phase: Phase): Promise<string> {
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

  state.phase.specialists = phase;
  await mkdir(aipeDir, { recursive: true });
  await writeFile(statePath, stringify(state), "utf8");
  return statePath;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd ~/aipe-worktree-hire-specialists && bun test src/hire-specialists/__tests__/state.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
cd ~/aipe-worktree-hire-specialists && git add src/hire-specialists/state.ts src/hire-specialists/__tests__/state.test.ts
git commit -m "feat: specialists phase update in state.yaml"
```

---

## Task 7: Orchestration (`run.ts`)

**Files:**
- Create: `src/hire-specialists/run.ts`
- Test: `src/hire-specialists/__tests__/run.test.ts`

**Interfaces:**
- Consumes: `readBrain` (`../make-workspace/read`), `resolveNames`/`dedupeReportsByName` (`./naming`), `readReports` (`./reports`), `personaSlug`/`renderSkillMd` (`./render`), `buildRegistry`/`renderPersonasYaml` (`./registry`), `updateSpecialistsPhase` (`./state`), `ProvidedNames`/`NamingResult`/`SpecialistsPhase`/`PersonaRole` (`./types`).
- Produces:
  - `type ResolveNamesResult = { ok: true; result: NamingResult } | { ok: false; error: string }`
  - `resolvePersonaNames(workspaceDir: string, provided: ProvidedNames): Promise<ResolveNamesResult>`
  - `interface PersonaStatus { repo: string; role: PersonaRole; status: "ok" | "missing" }`
  - `type RunResult = { ok: true; results: PersonaStatus[]; phase: SpecialistsPhase } | { ok: false; error: string }`
  - `runHireSpecialists(workspaceDir: string): Promise<RunResult>`

- [ ] **Step 1: Write the failing test**

Create `src/hire-specialists/__tests__/run.test.ts`:

```ts
import { expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile, readFile, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse, stringify } from "yaml";
import { resolvePersonaNames, runHireSpecialists } from "../run";
import type { BrainFile } from "../types";

const brain: BrainFile = {
  context: { name: "opvibes", coordinator: "Nicolas" },
  repos: [
    { name: "embark", url: "git@github.com:opvibes/embark.git", path: "./embark", stack: ["typescript"] },
    { name: "prontuario", url: "git@github.com:opvibes/prontuario.git", path: "./prontuario", stack: ["python"] },
  ],
};

async function ws(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "aipe-gen-run-"));
  await mkdir(join(dir, ".aipe"), { recursive: true });
  await writeFile(join(dir, ".aipe", "brain.yaml"), stringify(brain), "utf8");
  await writeFile(
    join(dir, ".aipe", "state.yaml"),
    stringify({ phase: { brain: "done", workspace: "done", relationship: "done", specialists: "pending" } }),
    "utf8",
  );
  return dir;
}

async function putReport(dir: string, repo: string, role: string, content: unknown): Promise<void> {
  const reportsDir = join(dir, ".aipe", "specialists", ".reports");
  await mkdir(reportsDir, { recursive: true });
  await writeFile(join(reportsDir, `${repo}-${role}.json`), JSON.stringify(content), "utf8");
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

test("resolvePersonaNames returns 4 assignments for a 2-repo brain", async () => {
  const dir = await ws();
  try {
    const result = await resolvePersonaNames(dir, {});
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.result.personas).toHaveLength(4);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("resolvePersonaNames propagates a missing brain as an error", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-gen-run-"));
  try {
    const result = await resolvePersonaNames(dir, {});
    expect(result.ok).toBe(false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("all (repo, role) pairs reported → phase done, SKILL.md files written, personas.yaml written, reports dir cleaned up", async () => {
  const dir = await ws();
  try {
    await putReport(dir, "embark", "dev-fullstack", { repo: "embark", role: "dev-fullstack", name: "Joaquim", body: "You are Joaquim." });
    await putReport(dir, "embark", "qa", { repo: "embark", role: "qa", name: "Marina", body: "You are Marina." });
    await putReport(dir, "prontuario", "dev-fullstack", { repo: "prontuario", role: "dev-fullstack", name: "Pedro", body: "You are Pedro." });
    await putReport(dir, "prontuario", "qa", { repo: "prontuario", role: "qa", name: "Karen", body: "You are Karen." });

    const result = await runHireSpecialists(dir);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.phase).toBe("done");
      expect(result.results.every((r) => r.status === "ok")).toBe(true);
    }

    const skillMd = await readFile(join(dir, "embark", ".claude", "skills", "joaquim", "SKILL.md"), "utf8");
    expect(skillMd).toContain("You are Joaquim.");
    expect(skillMd).toContain("Fullstack specialist for the embark repo (typescript).");

    const registry = parse(await readFile(join(dir, ".aipe", "personas.yaml"), "utf8"));
    expect(registry.personas).toHaveLength(5); // coordinator + 4 personas

    const state = parse(await readFile(join(dir, ".aipe", "state.yaml"), "utf8"));
    expect(state.phase.specialists).toBe("done");

    expect(await exists(join(dir, ".aipe", "specialists", ".reports"))).toBe(false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a missing (repo, role) report → phase pending, reports dir kept for retry", async () => {
  const dir = await ws();
  try {
    await putReport(dir, "embark", "dev-fullstack", { repo: "embark", role: "dev-fullstack", name: "Joaquim", body: "b" });

    const result = await runHireSpecialists(dir);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.phase).toBe("pending");
      expect(result.results.find((r) => r.repo === "embark" && r.role === "qa")?.status).toBe("missing");
      expect(result.results.find((r) => r.repo === "embark" && r.role === "dev-fullstack")?.status).toBe("ok");
    }

    expect(await exists(join(dir, ".aipe", "specialists", ".reports", "embark-dev-fullstack.json"))).toBe(true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("missing brain → ok:false, nothing written", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-gen-run-"));
  try {
    const result = await runHireSpecialists(dir);
    expect(result.ok).toBe(false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd ~/aipe-worktree-hire-specialists && bun test src/hire-specialists/__tests__/run.test.ts`
Expected: FAIL — `Cannot find module "../run"`.

- [ ] **Step 3: Implement `run.ts`**

Create `src/hire-specialists/run.ts`:

```ts
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { readBrain } from "../make-workspace/read";
import { dedupeReportsByName, resolveNames } from "./naming";
import { personaSlug, renderSkillMd } from "./render";
import { readReports } from "./reports";
import { buildRegistry, renderPersonasYaml } from "./registry";
import { updateSpecialistsPhase } from "./state";
import type { SpecialistsPhase, NamingResult, PersonaRole, ProvidedNames } from "./types";

export type ResolveNamesResult =
  | { ok: true; result: NamingResult }
  | { ok: false; error: string };

export async function resolvePersonaNames(workspaceDir: string, provided: ProvidedNames): Promise<ResolveNamesResult> {
  const brainResult = await readBrain(workspaceDir);
  if (!brainResult.ok) return { ok: false, error: brainResult.error };
  return { ok: true, result: resolveNames(brainResult.brain, provided) };
}

export interface PersonaStatus {
  repo: string;
  role: PersonaRole;
  status: "ok" | "missing";
}

export type RunResult =
  | { ok: true; results: PersonaStatus[]; phase: SpecialistsPhase }
  | { ok: false; error: string };

export async function runHireSpecialists(workspaceDir: string): Promise<RunResult> {
  const brainResult = await readBrain(workspaceDir);
  if (!brainResult.ok) return { ok: false, error: brainResult.error };
  const brain = brainResult.brain;

  const reportsDir = join(workspaceDir, ".aipe", "specialists", ".reports");
  const rawReports = await readReports(reportsDir);
  const reports = dedupeReportsByName(rawReports, brain.context.coordinator);
  const byKey = new Map(reports.map((r) => [`${r.repo}|${r.role}`, r]));

  const results: PersonaStatus[] = [];
  for (const repo of brain.repos) {
    for (const role of ["dev-fullstack", "qa"] as const) {
      results.push({ repo: repo.name, role, status: byKey.has(`${repo.name}|${role}`) ? "ok" : "missing" });
    }
  }
  const phase: SpecialistsPhase = results.every((r) => r.status === "ok") ? "done" : "pending";

  for (const report of reports) {
    const repo = brain.repos.find((r) => r.name === report.repo);
    if (!repo) continue;
    const skillDir = join(workspaceDir, repo.path, ".claude", "skills", personaSlug(report.name));
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, "SKILL.md"), renderSkillMd(report, repo.stack ?? []), "utf8");
  }

  const registry = buildRegistry(brain, reports);
  await mkdir(join(workspaceDir, ".aipe"), { recursive: true });
  await writeFile(join(workspaceDir, ".aipe", "personas.yaml"), renderPersonasYaml(registry), "utf8");

  await updateSpecialistsPhase(workspaceDir, phase);

  if (phase === "done") {
    await rm(reportsDir, { recursive: true, force: true });
  }

  return { ok: true, results, phase };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd ~/aipe-worktree-hire-specialists && bun test src/hire-specialists/__tests__/run.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
cd ~/aipe-worktree-hire-specialists && git add src/hire-specialists/run.ts src/hire-specialists/__tests__/run.test.ts
git commit -m "feat: hire-specialists orchestration"
```

---

## Task 8: CLI + manual end-to-end verification

**Files:**
- Create: `src/hire-specialists/cli.ts`
- Test: `src/hire-specialists/__tests__/cli.test.ts`

**Interfaces:**
- Consumes: `resolvePersonaNames`, `runHireSpecialists`, `PersonaStatus` (`./run`), `SpecialistsPhase` (`./types`).
- Produces: `renderReport(results: PersonaStatus[], phase: SpecialistsPhase): string[]` (pure, testable).

- [ ] **Step 1: Write the failing test**

Create `src/hire-specialists/__tests__/cli.test.ts`:

```ts
import { expect, test } from "bun:test";
import { renderReport } from "../cli";

test("renderReport formats each (repo, role) pair and the STATE line when done", () => {
  const lines = renderReport(
    [
      { repo: "embark", role: "dev-fullstack", status: "ok" },
      { repo: "embark", role: "qa", status: "ok" },
    ],
    "done",
  );
  expect(lines).toContain("OK embark dev-fullstack");
  expect(lines).toContain("OK embark qa");
  expect(lines.some((l) => l.startsWith("STATE specialists=done"))).toBe(true);
});

test("renderReport lists missing pairs and marks pending", () => {
  const lines = renderReport(
    [
      { repo: "embark", role: "dev-fullstack", status: "ok" },
      { repo: "embark", role: "qa", status: "missing" },
    ],
    "pending",
  );
  expect(lines).toContain("MISSING embark qa");
  expect(lines.some((l) => l.startsWith("STATE specialists=pending"))).toBe(true);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd ~/aipe-worktree-hire-specialists && bun test src/hire-specialists/__tests__/cli.test.ts`
Expected: FAIL — `Cannot find module "../cli"` (or `renderReport` undefined).

- [ ] **Step 3: Implement `cli.ts`**

Create `src/hire-specialists/cli.ts`:

```ts
#!/usr/bin/env bun
import { readFile } from "node:fs/promises";
import { resolvePersonaNames, runHireSpecialists, type PersonaStatus } from "./run";
import type { SpecialistsPhase, ProvidedNames } from "./types";

function getFlag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const value = args[i + 1];
  if (value === undefined || value.startsWith("--")) return undefined;
  return value;
}

export function renderReport(results: PersonaStatus[], phase: SpecialistsPhase): string[] {
  const lines: string[] = [];
  for (const r of results) {
    lines.push(r.status === "ok" ? `OK ${r.repo} ${r.role}` : `MISSING ${r.repo} ${r.role}`);
  }
  const missing = results.filter((r) => r.status === "missing").length;
  const suffix = missing > 0 ? ` (${missing} missing of ${results.length} personas)` : "";
  lines.push(`STATE specialists=${phase}${suffix}`);
  return lines;
}

async function resolveNamesCommand(args: string[]): Promise<number> {
  const workspace = getFlag(args, "--workspace") ?? process.cwd();
  const inputPath = getFlag(args, "--input");
  if (!inputPath) {
    console.log("ERROR input: --input <file.json> is required with --resolve-names");
    return 1;
  }

  let provided: ProvidedNames;
  try {
    provided = JSON.parse(await readFile(inputPath, "utf8"));
  } catch {
    console.log(`ERROR input: could not read/parse ${inputPath}`);
    return 1;
  }

  const result = await resolvePersonaNames(workspace, provided);
  if (!result.ok) {
    console.log(`ERROR brain: ${result.error}`);
    return 1;
  }

  console.log(JSON.stringify(result.result));
  return 0;
}

async function materializeCommand(args: string[]): Promise<number> {
  const workspace = getFlag(args, "--workspace") ?? process.cwd();
  const result = await runHireSpecialists(workspace);
  if (!result.ok) {
    console.log(`ERROR brain: ${result.error}`);
    return 1;
  }

  for (const line of renderReport(result.results, result.phase)) {
    console.log(line);
  }
  return result.phase === "done" ? 0 : 1;
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  if (args.includes("--resolve-names")) return resolveNamesCommand(args);
  return materializeCommand(args);
}

if (import.meta.main) {
  main()
    .then((code) => process.exit(code))
    .catch((err) => {
      console.log(`ERROR ${err}`);
      process.exit(1);
    });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd ~/aipe-worktree-hire-specialists && bun test src/hire-specialists/__tests__/cli.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Manual end-to-end verification (no live agents needed — simulate their output)**

```bash
cd ~/aipe-worktree-hire-specialists && GW=$(mktemp -d) && mkdir -p "$GW/.aipe"
cat > "$GW/.aipe/brain.yaml" <<'YAML'
context:
  name: teste
  coordinator: Nicolas
repos:
  - name: embark
    url: git@github.com:opvibes/embark.git
    path: ./embark
    stack: [typescript, bun]
  - name: prontuario
    url: git@github.com:opvibes/prontuario.git
    path: ./prontuario
    stack: [python]
YAML
cat > "$GW/.aipe/state.yaml" <<'YAML'
phase:
  brain: done
  workspace: done
  relationship: done
  specialists: pending
YAML
mkdir -p "$GW/embark" "$GW/prontuario"

# Step A: resolve names (simulating the PE leaving everything blank)
echo '{}' > "$GW/names.json"
bun src/hire-specialists/cli.ts --resolve-names --input "$GW/names.json" --workspace "$GW" | tee "$GW/resolved.json"

# Step B: simulate the 4 agent reports using the resolved names
NAMES=$(cat "$GW/resolved.json")
mkdir -p "$GW/.aipe/specialists/.reports"
bun -e '
const fs = require("fs");
const resolved = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const dir = process.argv[2];
for (const p of resolved.personas) {
  const body = `You are ${p.name}, the ${p.role} for ${p.repo}.`;
  fs.writeFileSync(`${dir}/.aipe/specialists/.reports/${p.repo}-${p.role}.json`, JSON.stringify({ ...p, body }));
}
' "$GW/resolved.json" "$GW"

# Step C: materialize
bun src/hire-specialists/cli.ts --workspace "$GW"; echo "exit=$?"
cat "$GW/.aipe/personas.yaml"
find "$GW/embark/.claude/skills" "$GW/prontuario/.claude/skills" -name SKILL.md -print -exec cat {} \;
ls "$GW/.aipe/specialists" 2>&1 # .reports/ must be gone (dir itself may remain empty or not exist)
rm -rf "$GW"
```
Expected: `--resolve-names` prints one JSON line with `coordinator: "Nicolas"` and 4 personas, all names distinct. Materialize prints 4 `OK <repo> <role>` lines and `STATE specialists=done` (exit 0). `personas.yaml` lists 5 entries (coordinator + 4). Each repo has exactly one `SKILL.md` per assigned persona under `.claude/skills/<slug>/`, with the agent's body text present. `.aipe/specialists/.reports/` no longer exists.

- [ ] **Step 6: Run the full suite and type-check**

Run: `cd ~/aipe-worktree-hire-specialists && bun test && bunx tsc --noEmit -p tsconfig.json`
Expected: all tests PASS, 0 type errors.

- [ ] **Step 7: Commit**

```bash
cd ~/aipe-worktree-hire-specialists && git add src/hire-specialists/cli.ts src/hire-specialists/__tests__/cli.test.ts
git commit -m "feat: hire-specialists CLI"
```

---

## Task 9: `/hire-specialists` skill

**Files:**
- Create: `skills/hire-specialists/SKILL.md`

**Interfaces:**
- Consumes: `src/hire-specialists/cli.ts` (via `bun`, both modes), `<workspace>/.aipe/brain.yaml`, `.aipe/relations/graph.yaml`, and `state.yaml`.
- Produces: no code symbol — the conversational interface, naming flow, and the exact `Agent()` schema the coordinator forces per `(repo, role)` pair.

- [ ] **Step 1: Write the skill**

Create `skills/hire-specialists/SKILL.md`:

````markdown
---
name: hire-specialists
description: Use in step 4 (last) of AIPe onboarding to generate the persona skills — 1 dev-fullstack + 1 QA per repo — installed inside each repo, plus the cross-repo personas.yaml registry. Resolves persona names with the PE, dispatches 2 subagents per repo (one per role), then hands the structured results to a deterministic CLI.
---

# /hire-specialists

Materializes the context's specialists: for every repo in `brain.yaml`, one
dev-fullstack persona and one QA persona, each installed as a two-mode skill
inside that repo (`<repo>/.claude/skills/<name>/SKILL.md`). You (the
coordinator) drive naming and dispatch subagents that write persona prose —
name resolution, validation, and file writing are handled by a deterministic
CLI, same as the earlier onboarding steps.

## Flow

1. **Confirm the workspace.** By default the current directory (must be an
   `aipe-<context>` folder with `.aipe/brain.yaml`).

2. **Check the precondition.** Read `.aipe/state.yaml`. If `phase.relationship`
   is not `done`, stop and guide the PE to run `/relationship` first — there's
   no stack/relations data to ground personas in yet.

3. **Read `brain.yaml`** (repos, stack, `context.coordinator`) and
   `.aipe/relations/graph.yaml` (edges) directly, to have them on hand for
   steps 4 and 6.

4. **Ask the PE for names, one repo at a time.** For each repo, ask for the
   dev-fullstack's name and the QA's name. The PE may answer or ask you to
   generate one — leave that slot `null` in this step, the CLI fills it.
   Assemble the answers into a `ProvidedNames` JSON object, e.g.:
   ```json
   {
     "embark": { "devFullstack": "Joaquim", "qa": null },
     "prontuario": { "devFullstack": null, "qa": null }
   }
   ```

5. **Resolve final names.** Write that JSON to a temp file and run:
   ```bash
   bun <plugin-path>/src/hire-specialists/cli.ts --resolve-names --input <file.json> --workspace <workspace>
   ```
   The CLI prints one JSON line: `{"coordinator":"Nicolas","personas":[{"repo":"embark","role":"dev-fullstack","name":"Joaquim"}, ...]}`.
   Every name here is final and unique across the whole context (including
   the coordinator's) — this is what you dispatch with next, not whatever the
   PE originally typed.

6. **Dispatch one agent per (repo, role) — 2N agents, all in parallel.** For
   each entry in the resolved `personas` list, launch an agent and give it:
   - Its assigned `name` and `role` (`dev-fullstack` or `qa`).
   - The repo's `stack` (from `brain.yaml`).
   - The repo's relations (edges from `graph.yaml` where `from` or `to`
     equals this repo).
   - The coordinator's name and the context name.
   - Instructions to write the **body** of a Claude Code skill file: one
     identity paragraph grounded in the stack/relations, then two short
     sections — (a) how to behave when dispatched as a subagent with a
     hiring brief (a scoped task description handed to you by the
     coordinator at dispatch time): stay within this repo, report back
     through the coordinator, never touch another repo; (b) how to behave
     when the PE opens a session directly inside this repo: pair with them
     directly as this repo's fullstack dev/QA, same posture as any Claude
     Code session, colored by this repo's stack/relations awareness.
   - A forced structured output matching exactly this shape:
     ```json
     {
       "repo": "<repo-name>",
       "role": "dev-fullstack | qa",
       "name": "<assigned name from step 5>",
       "body": "<markdown body for SKILL.md, below the frontmatter>"
     }
     ```

7. **Save each result** to
   `<workspace>/.aipe/specialists/.reports/<repo-name>-<role>.json` (create the
   directory if needed).

8. **Run the CLI:**
   ```bash
   bun <plugin-path>/src/hire-specialists/cli.ts --workspace <workspace>
   ```

9. **Translate the output to the PE:**
   - `OK <repo> <role>` → that persona's `SKILL.md` was written.
   - `MISSING <repo> <role>` → no report file (the agent may have failed or
     timed out). The reports directory is preserved when any pair is
     missing, so re-dispatching just the missing pairs and re-running the
     CLI is safe and won't lose the ones that already succeeded.
   - `STATE specialists=done|pending` → aggregated state.

10. **Report the artifacts.** On `done`, point the PE to `.aipe/personas.yaml`
    (the full roster) and to each `<repo>/.claude/skills/<name>/SKILL.md`.
    Mention that onboarding is now complete — opening a session directly
    inside a repo will load that repo's personas automatically.

## Rules

- Never write `personas.yaml`, `state.yaml`, or any persona `SKILL.md` by
  hand — always through the CLI.
- Always exactly 2 personas per repo (1 dev-fullstack + 1 QA) — never split
  by sub-stack, never skip QA.
- Names must be resolved via `--resolve-names` (step 5) **before** dispatch —
  an agent must be told its final name to write coherent identity prose.
- Each subagent must stay scoped to its own repo when writing persona
  content — no cross-repo file access.
- Re-running `/hire-specialists` after it already reached `done`
  re-resolves names, re-dispatches all 2N agents, and overwrites every
  persona `SKILL.md` + `personas.yaml` from scratch — there's no incremental
  regeneration.
- The hiring brief itself is never written to disk by this skill — only
  documented, in prose, inside each persona's `SKILL.md`. Its concrete shape
  is decided by you (the coordinator) at dispatch time in future work
  sessions.
````

- [ ] **Step 2: Check coherence with the existing pattern**

Run: `cd ~/aipe-worktree-hire-specialists && cat skills/relationship/SKILL.md skills/hire-specialists/SKILL.md | head -100`
Expected: frontmatter (`name`/`description`) in the same format as the other skills; flow uses the same `OK`/`MISSING`/`STATE` line style as `/relationship`.

- [ ] **Step 3: Commit**

```bash
cd ~/aipe-worktree-hire-specialists && git add skills/hire-specialists/SKILL.md
git commit -m "feat: /hire-specialists skill"
```

---

## Task 10: Manual load-order validation + dossier entry

**Files:**
- Create: `docs/dossie/05-hire-specialists.md`
- Modify: `docs/dossie/README.md` (index row + roadmap update)

No new code — this task produces empirical evidence (per design spec §8) and
the dossier entry required by the repo's convention (`docs/dossie/README.md`).

- [ ] **Step 1: Generate one real test persona in a throwaway repo**

Pick (or create) a small local git repo the worktree can write into, e.g.:

```bash
cd ~/aipe-worktree-hire-specialists
TESTREPO=$(mktemp -d) && cd "$TESTREPO" && git init -q && echo '{"name":"toy"}' > package.json && git add -A && git commit -q -m "init"
mkdir -p "$TESTREPO/.claude/skills/testdev"
cat > "$TESTREPO/.claude/skills/testdev/SKILL.md" <<'MD'
---
name: testdev
description: Fullstack specialist for the toy repo (typescript). Dispatched by the coordinator for tasks scoped to toy, or worn directly when a session opens inside this repo.
---

# Testdev

You are Testdev, the fullstack specialist for this repo. When dispatched as a
subagent, stay scoped to this repo and report back through the coordinator.
When a PE opens a session here directly, pair with them as this repo's dev.
MD
```

- [ ] **Step 2: Open a real session inside that repo and invoke a third-party skill**

Manually (interactive, not scripted): open a Claude Code session with
`$TESTREPO` as the working directory (this persona `SKILL.md` is now
present at `.claude/skills/testdev/`), then invoke
`superpowers:brainstorming` (or another installed third-party skill) on a
trivial prompt (e.g. "let's brainstorm a tiny CLI tool"). Observe:
- Does the persona's identity (Testdev, fullstack specialist for `toy`)
  remain visible/referenced by the assistant during and after the
  third-party skill runs?
- Does anything in the third-party skill's instructions conflict with or
  overwrite the persona's framing?

- [ ] **Step 3: Write the findings into the dossier entry**

Create `docs/dossie/05-hire-specialists.md` following the same
structure as `docs/dossie/04-relationship.md` (Purpose, Key decisions from
brainstorming, Plan, Execution & review findings, Final state), and add a
dedicated **"Load-order validation"** section recording exactly what was
observed in Step 2 (persona survived / persona was overridden / partial —
describe precisely, with the actual assistant behavior seen, not a
guess).

- [ ] **Step 4: Update the dossier index**

Edit `docs/dossie/README.md`: add a row `| 5 | /hire-specialists —
persona skills | Merged | [05-hire-specialists.md](05-hire-specialists.md) |`
to the Index table, and remove `/hire-specialists — persona skills`
from the "Roadmap (not yet built)" list (add `/aipe-add-repo` context if it
isn't already the only remaining item).

- [ ] **Step 5: Clean up the throwaway repo**

```bash
rm -rf "$TESTREPO"
```

- [ ] **Step 6: Commit**

```bash
cd ~/aipe-worktree-hire-specialists && git add docs/dossie/05-hire-specialists.md docs/dossie/README.md
git commit -m "docs: dossier entry for /hire-specialists"
```

---

## Self-Review (by the plan's author)

**Spec coverage:**
- §1 purpose/precondition → Task 9 (SKILL.md steps 1-2).
- §2 persona count/roles (always 1 dev-fullstack + 1 qa) → Task 2 (`resolveNames` "exactly 2 personas per repo" test), Global Constraints.
- §3 interactive naming → Task 9 (SKILL.md step 4) + Task 2/Task 8 (`--resolve-names` mode).
- §4 fan-out (2N agents, one batch, per-agent schema, staging files) → Task 9 (SKILL.md steps 6-7).
- §5 deterministic materialization steps 1-7 → Task 4 (`reports.ts` read+validate), Task 3 (`render.ts` frontmatter assembly), Task 5 (`registry.ts`), Task 6 (`state.ts`), Task 7 (`run.ts` ties all of it together, including done-only cleanup).
- §6 hiring brief not persisted → Global Constraints + Task 9 (SKILL.md closing Rule).
- §7 partial failure → Task 7 (`run.test.ts` "a missing (repo, role) report" case) + `.reports/` retention rule in Global Constraints.
- §8 two-mode persona content → Task 9 (SKILL.md step 6 bullet on body sections) + Task 10 (empirical load-order validation).
- §9 file layout → File Structure section + Task 7/8's manual e2e verification path layout match.
- §10 implementation shape → File Structure section matches 1:1 (module names, responsibilities), Task 1 through Task 9 cover every listed file.
- §11 out of scope → not implemented anywhere in this plan (no sub-repo splitting, no hiring-brief template, no `/aipe-add-repo`, no worktree-per-journey wiring).

**Placeholder scan:** no TBD/TODO; every code step has complete code; the SKILL.md has the full literal schema, not a description of one; Task 10's dossier step gives exact section names and file paths rather than "document findings."

**Type consistency:** `PersonaRole`/`PersonaAssignment`/`NamingResult`/`ProvidedNames`/`PersonaReport`/`PersonaRegistryEntry`/`SpecialistsPhase` defined once in Task 1 and reused identically across Tasks 2-8. `resolveNames(brain, provided)` and `dedupeReportsByName(reports, coordinatorName)` signatures identical between Task 2's definition and Task 7's `run.ts` call sites. `personaSlug(name)` and `renderSkillMd(report, stack)` signatures identical between Task 3's definition and Tasks 5/7's call sites. `buildRegistry(brain, reports)`/`renderPersonasYaml(entries)` signatures identical between Task 5's definition and Task 7's call site. `updateSpecialistsPhase(workspaceDir, phase)` signature identical between Task 6's definition and Task 7's call site. `PersonaStatus`/`RunResult`/`ResolveNamesResult` defined in Task 7 and reused identically in Task 8's `cli.ts`.
