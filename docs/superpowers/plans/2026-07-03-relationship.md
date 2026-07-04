# /relationship Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Discover cross-repo relations (code deps, API contracts, shared infra, shared packages) across a context's repos, document them in `.aipe/relations/`, and backfill `stack` into `brain.yaml`.

**Architecture:** Same skill+CLI split as `/make-workspace`, plus a runtime fan-out step. The coordinator (live, at runtime) dispatches one read-only subagent per repo, each returning a schema-forced JSON report (relations found + detected stack), saved to `.aipe/relations/.reports/<repo>.json`. A typed CLI (`src/relationship/cli.ts`) then does everything else deterministically: merges complementary edges reported from both sides of a relation, renders `graph.yaml` (machine source of truth) and `README.md` (derived, human-readable), backfills empty `stack` entries in `brain.yaml`, and updates `state.yaml`.

**Tech Stack:** Bun + TypeScript strict, `bun test`, `yaml` package for YAML files, plain `JSON.parse` for the per-repo report files (the coordinator writes those, not the CLI).

## Global Constraints

- TypeScript **strict** (inherits the repo's `tsconfig.json`); run `bunx tsc --noEmit -p tsconfig.json` before every commit (does not run as part of `bun test`).
- Tests with `bun test` (import `{ expect, test } from "bun:test"`).
- Reuse `BrainFile`, `RepoEntry`, `Phase`, `StateFile` from `src/context-brain/types.ts` and `readBrain` from `src/make-workspace/read.ts` — **do not** redefine or re-implement brain reading/validation.
- Relation `type` is a **closed enum**: `imports | published-by | consumes | exposed-by | shares-infra`. No free text.
- Edge merging is **pure, deterministic code** — no LLM call anywhere past the per-repo agent report.
- Canonicalization convention for merging (this is an implementation decision locked in by this plan, not re-litigated per task): a raw edge `{ from: repo, to, type }` normalizes to a canonical `{ from, to, type }` as follows — `imports` and `consumes` stay as-is; `published-by` becomes `{ from: to, to: from, type: "imports" }`; `exposed-by` becomes `{ from: to, to: from, type: "consumes" }`; `shares-infra` keeps its type but sorts `from`/`to` alphabetically (it's symmetric). Edges with the same canonical `from|to|type` key merge into one `MergedEdge`, keeping every raw report's `{ detail, evidence }` as a `perspectives` entry (never discarding a side's wording).
- `state.phase.relationship` becomes `done` only if **every** repo in `brain.yaml` has a report file; otherwise `pending`.
- `stack` backfill **never overwrites** a non-empty `repos[].stack` the PE already declared.
- `.aipe/relations/.reports/` (transient staging) is deleted **only when the phase reaches `done`** — when `pending`, it's left in place so a coordinator retry can add just the missing repos' reports without losing the ones that already succeeded.
- Messages to the user in **English**; commits in English following Conventional Commits.

---

## File Structure

```
src/relationship/
  ├── types.ts        # RelationType, RawRelation, RepoReport, Perspective, MergedEdge, RelationshipPhase
  ├── merge.ts         # mergeEdges(): pure canonicalization + fold of raw edges into MergedEdge[]
  ├── render.ts         # renderGraphYaml(), renderReadme(): pure string rendering from MergedEdge[]
  ├── backfill.ts       # backfillStack(): pure brain.yaml stack backfill (only fills empty)
  ├── reports.ts        # readReports(): reads + validates .reports/*.json from disk
  ├── state.ts          # updateRelationshipPhase(): updates state.yaml preserving other phases
  ├── run.ts            # runRelationship(): orchestrates read → merge → render → backfill → state → cleanup
  ├── cli.ts            # flag parsing, renderReport (pure), wiring
  └── __tests__/
       ├── merge.test.ts
       ├── render.test.ts
       ├── backfill.test.ts
       ├── reports.test.ts
       ├── state.test.ts
       ├── run.test.ts
       └── cli.test.ts
skills/relationship/SKILL.md
```

---

## Task 1: Types + edge merge (`merge.ts`)

**Files:**
- Create: `src/relationship/types.ts`
- Create: `src/relationship/merge.ts`
- Test: `src/relationship/__tests__/merge.test.ts`

**Interfaces:**
- Consumes: `BrainFile`, `RepoEntry` from `src/context-brain/types.ts` (re-exported).
- Produces:
  - `type RelationType = "imports" | "published-by" | "consumes" | "exposed-by" | "shares-infra"`
  - `interface RawRelation { to: string; type: RelationType; detail: string; evidence: string }`
  - `interface RepoReport { repo: string; stack: string[]; relations: RawRelation[] }`
  - `interface Perspective { detail: string; evidence: string }`
  - `interface MergedEdge { from: string; to: string; type: RelationType; perspectives: Perspective[] }`
  - `type RelationshipPhase = "pending" | "done"`
  - `mergeEdges(reports: RepoReport[]): MergedEdge[]`

- [ ] **Step 1: Write the types**

Create `src/relationship/types.ts`:

```ts
import type { BrainFile, RepoEntry } from "../context-brain/types";

export type { BrainFile, RepoEntry };

export type RelationType = "imports" | "published-by" | "consumes" | "exposed-by" | "shares-infra";

export interface RawRelation {
  to: string;
  type: RelationType;
  detail: string;
  evidence: string;
}

export interface RepoReport {
  repo: string;
  stack: string[];
  relations: RawRelation[];
}

export interface Perspective {
  detail: string;
  evidence: string;
}

export interface MergedEdge {
  from: string;
  to: string;
  type: RelationType;
  perspectives: Perspective[];
}

export type RelationshipPhase = "pending" | "done";
```

- [ ] **Step 2: Write the failing test**

Create `src/relationship/__tests__/merge.test.ts`:

```ts
import { expect, test } from "bun:test";
import { mergeEdges } from "../merge";
import type { RepoReport } from "../types";

test("keeps a one-sided imports edge untouched", () => {
  const reports: RepoReport[] = [
    { repo: "embark", stack: [], relations: [{ to: "shared-ui", type: "imports", detail: "imports Button", evidence: "src/a.ts:1" }] },
  ];
  const edges = mergeEdges(reports);
  expect(edges).toEqual([
    { from: "embark", to: "shared-ui", type: "imports", perspectives: [{ detail: "imports Button", evidence: "src/a.ts:1" }] },
  ]);
});

test("merges consumes + exposed-by reported from both sides into one edge", () => {
  const reports: RepoReport[] = [
    { repo: "embark", stack: [], relations: [{ to: "prontuario", type: "consumes", detail: "calls GET /api/patients", evidence: "src/clients/prontuario.ts:12" }] },
    { repo: "prontuario", stack: [], relations: [{ to: "embark", type: "exposed-by", detail: "exposes /api/patients", evidence: "src/routes/patients.ts:5" }] },
  ];
  const edges = mergeEdges(reports);
  expect(edges).toEqual([
    {
      from: "embark",
      to: "prontuario",
      type: "consumes",
      perspectives: [
        { detail: "calls GET /api/patients", evidence: "src/clients/prontuario.ts:12" },
        { detail: "exposes /api/patients", evidence: "src/routes/patients.ts:5" },
      ],
    },
  ]);
});

test("merges imports + published-by reported from both sides into one edge", () => {
  const reports: RepoReport[] = [
    { repo: "embark", stack: [], relations: [{ to: "shared-ui", type: "imports", detail: "imports Button", evidence: "src/a.ts:1" }] },
    { repo: "shared-ui", stack: [], relations: [{ to: "embark", type: "published-by", detail: "publishes Button, used by embark", evidence: "src/Button.tsx:1" }] },
  ];
  const edges = mergeEdges(reports);
  expect(edges).toEqual([
    {
      from: "embark",
      to: "shared-ui",
      type: "imports",
      perspectives: [
        { detail: "imports Button", evidence: "src/a.ts:1" },
        { detail: "publishes Button, used by embark", evidence: "src/Button.tsx:1" },
      ],
    },
  ]);
});

test("canonicalizes shares-infra direction alphabetically, merging both sides", () => {
  const reports: RepoReport[] = [
    { repo: "prontuario", stack: [], relations: [{ to: "embark", type: "shares-infra", detail: "same Postgres", evidence: "docker-compose.yml:8" }] },
    { repo: "embark", stack: [], relations: [{ to: "prontuario", type: "shares-infra", detail: "same Postgres", evidence: ".env.example:3" }] },
  ];
  const edges = mergeEdges(reports);
  expect(edges).toHaveLength(1);
  expect(edges[0]?.from).toBe("embark");
  expect(edges[0]?.to).toBe("prontuario");
  expect(edges[0]?.perspectives).toHaveLength(2);
});

test("does not merge edges between different repo pairs or different types", () => {
  const reports: RepoReport[] = [
    { repo: "embark", stack: [], relations: [{ to: "prontuario", type: "consumes", detail: "a", evidence: "e1" }] },
    { repo: "embark", stack: [], relations: [{ to: "faturamento", type: "consumes", detail: "b", evidence: "e2" }] },
  ];
  const edges = mergeEdges(reports);
  expect(edges).toHaveLength(2);
});

test("sorts output deterministically by from, then to, then type", () => {
  const reports: RepoReport[] = [
    { repo: "z-repo", stack: [], relations: [{ to: "a-repo", type: "imports", detail: "d", evidence: "e" }] },
    { repo: "a-repo", stack: [], relations: [{ to: "b-repo", type: "consumes", detail: "d", evidence: "e" }] },
  ];
  const edges = mergeEdges(reports);
  expect(edges.map((e) => e.from)).toEqual(["a-repo", "z-repo"]);
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd ~/aipe-worktree-relationship && bun test src/relationship/__tests__/merge.test.ts`
Expected: FAIL — `Cannot find module "../merge"`.

- [ ] **Step 4: Implement `merge.ts`**

Create `src/relationship/merge.ts`:

```ts
import type { MergedEdge, Perspective, RelationType, RepoReport } from "./types";

interface RawEdge {
  from: string;
  to: string;
  type: RelationType;
  detail: string;
  evidence: string;
}

interface Canonical {
  from: string;
  to: string;
  type: RelationType;
}

function toRawEdges(reports: RepoReport[]): RawEdge[] {
  const edges: RawEdge[] = [];
  for (const report of reports) {
    for (const relation of report.relations) {
      edges.push({ from: report.repo, to: relation.to, type: relation.type, detail: relation.detail, evidence: relation.evidence });
    }
  }
  return edges;
}

function canonicalize(edge: RawEdge): Canonical {
  if (edge.type === "published-by") return { from: edge.to, to: edge.from, type: "imports" };
  if (edge.type === "exposed-by") return { from: edge.to, to: edge.from, type: "consumes" };
  if (edge.type === "shares-infra") {
    const [from, to] = [edge.from, edge.to].sort();
    return { from: from as string, to: to as string, type: "shares-infra" };
  }
  return { from: edge.from, to: edge.to, type: edge.type };
}

export function mergeEdges(reports: RepoReport[]): MergedEdge[] {
  const byKey = new Map<string, MergedEdge>();

  for (const edge of toRawEdges(reports)) {
    const canonical = canonicalize(edge);
    const key = `${canonical.from}|${canonical.to}|${canonical.type}`;
    const perspective: Perspective = { detail: edge.detail, evidence: edge.evidence };
    const existing = byKey.get(key);
    if (existing) {
      existing.perspectives.push(perspective);
    } else {
      byKey.set(key, { from: canonical.from, to: canonical.to, type: canonical.type, perspectives: [perspective] });
    }
  }

  return [...byKey.values()].sort((a, b) => {
    if (a.from !== b.from) return a.from.localeCompare(b.from);
    if (a.to !== b.to) return a.to.localeCompare(b.to);
    return a.type.localeCompare(b.type);
  });
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd ~/aipe-worktree-relationship && bun test src/relationship/__tests__/merge.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 6: Commit**

```bash
cd ~/aipe-worktree-relationship && git add src/relationship/types.ts src/relationship/merge.ts src/relationship/__tests__/merge.test.ts
git commit -m "feat: relationship types and deterministic edge merge"
```

---

## Task 2: Rendering (`render.ts`)

**Files:**
- Create: `src/relationship/render.ts`
- Test: `src/relationship/__tests__/render.test.ts`

**Interfaces:**
- Consumes: `MergedEdge` from `./types`.
- Produces:
  - `renderGraphYaml(edges: MergedEdge[]): string`
  - `renderReadme(edges: MergedEdge[], repoNames: string[]): string`

- [ ] **Step 1: Write the failing test**

Create `src/relationship/__tests__/render.test.ts`:

```ts
import { expect, test } from "bun:test";
import { parse } from "yaml";
import { renderGraphYaml, renderReadme } from "../render";
import type { MergedEdge } from "../types";

const edges: MergedEdge[] = [
  {
    from: "embark",
    to: "prontuario",
    type: "consumes",
    perspectives: [{ detail: "calls GET /api/patients", evidence: "src/clients/prontuario.ts:12" }],
  },
];

test("renderGraphYaml produces parseable YAML with the edges list", () => {
  const yaml = renderGraphYaml(edges);
  const parsed = parse(yaml);
  expect(parsed.edges).toHaveLength(1);
  expect(parsed.edges[0].from).toBe("embark");
  expect(parsed.edges[0].perspectives[0].detail).toBe("calls GET /api/patients");
});

test("renderGraphYaml with no edges still produces a valid empty list", () => {
  const parsed = parse(renderGraphYaml([]));
  expect(parsed.edges).toEqual([]);
});

test("renderReadme groups edges under each repo, from and to sides", () => {
  const readme = renderReadme(edges, ["embark", "prontuario"]);
  expect(readme).toContain("## embark");
  expect(readme).toContain("## prontuario");
  expect(readme).toContain("consumes → prontuario");
  expect(readme).toContain("embark → consumes → this repo");
  expect(readme).toContain("calls GET /api/patients (src/clients/prontuario.ts:12)");
});

test("renderReadme notes repos with no known relations", () => {
  const readme = renderReadme([], ["standalone-repo"]);
  expect(readme).toContain("## standalone-repo");
  expect(readme).toContain("_No known relations._");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd ~/aipe-worktree-relationship && bun test src/relationship/__tests__/render.test.ts`
Expected: FAIL — `Cannot find module "../render"`.

- [ ] **Step 3: Implement `render.ts`**

Create `src/relationship/render.ts`:

```ts
import { stringify } from "yaml";
import type { MergedEdge } from "./types";

export function renderGraphYaml(edges: MergedEdge[]): string {
  return stringify({ edges });
}

export function renderReadme(edges: MergedEdge[], repoNames: string[]): string {
  const lines: string[] = ["# Relations", ""];

  for (const repo of [...repoNames].sort()) {
    lines.push(`## ${repo}`, "");
    const related = edges.filter((e) => e.from === repo || e.to === repo);

    if (related.length === 0) {
      lines.push("_No known relations._", "");
      continue;
    }

    for (const edge of related) {
      if (edge.from === repo) {
        lines.push(`- ${edge.type} → ${edge.to}`);
      } else {
        lines.push(`- ${edge.from} → ${edge.type} → this repo`);
      }
      for (const p of edge.perspectives) {
        lines.push(`  - ${p.detail} (${p.evidence})`);
      }
    }
    lines.push("");
  }

  return lines.join("\n");
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd ~/aipe-worktree-relationship && bun test src/relationship/__tests__/render.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
cd ~/aipe-worktree-relationship && git add src/relationship/render.ts src/relationship/__tests__/render.test.ts
git commit -m "feat: graph.yaml and README.md rendering for relationship"
```

---

## Task 3: Stack backfill + report reading (`backfill.ts`, `reports.ts`)

**Files:**
- Create: `src/relationship/backfill.ts`
- Create: `src/relationship/reports.ts`
- Test: `src/relationship/__tests__/backfill.test.ts`
- Test: `src/relationship/__tests__/reports.test.ts`

**Interfaces:**
- Consumes: `BrainFile`, `RepoReport` from `./types`.
- Produces:
  - `backfillStack(brain: BrainFile, reports: RepoReport[]): BrainFile`
  - `readReports(reportsDir: string): Promise<RepoReport[]>`

- [ ] **Step 1: Write the failing tests**

Create `src/relationship/__tests__/backfill.test.ts`:

```ts
import { expect, test } from "bun:test";
import { backfillStack } from "../backfill";
import type { BrainFile, RepoReport } from "../types";

const brain: BrainFile = {
  context: { name: "opvibes", coordinator: "Nicolas" },
  repos: [
    { name: "embark", url: "git@github.com:opvibes/embark.git", path: "./embark" },
    { name: "prontuario", url: "git@github.com:opvibes/prontuario.git", path: "./prontuario", stack: ["python"] },
  ],
};

test("fills stack for a repo with none declared", () => {
  const reports: RepoReport[] = [{ repo: "embark", stack: ["typescript", "bun"], relations: [] }];
  const result = backfillStack(brain, reports);
  expect(result.repos.find((r) => r.name === "embark")?.stack).toEqual(["typescript", "bun"]);
});

test("never overwrites a stack the PE already declared", () => {
  const reports: RepoReport[] = [{ repo: "prontuario", stack: ["typescript"], relations: [] }];
  const result = backfillStack(brain, reports);
  expect(result.repos.find((r) => r.name === "prontuario")?.stack).toEqual(["python"]);
});

test("leaves stack empty when there is no report for that repo", () => {
  const result = backfillStack(brain, []);
  expect(result.repos.find((r) => r.name === "embark")?.stack).toBeUndefined();
});

test("does not mutate the input brain", () => {
  const reports: RepoReport[] = [{ repo: "embark", stack: ["typescript"], relations: [] }];
  backfillStack(brain, reports);
  expect(brain.repos.find((r) => r.name === "embark")?.stack).toBeUndefined();
});
```

Create `src/relationship/__tests__/reports.test.ts`:

```ts
import { expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readReports } from "../reports";

test("reads and parses every valid report json file", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-rel-"));
  try {
    await writeFile(join(dir, "embark.json"), JSON.stringify({ repo: "embark", stack: ["typescript"], relations: [] }));
    await writeFile(join(dir, "prontuario.json"), JSON.stringify({ repo: "prontuario", stack: [], relations: [] }));
    const reports = await readReports(dir);
    expect(reports.map((r) => r.repo).sort()).toEqual(["embark", "prontuario"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("ignores non-json files", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-rel-"));
  try {
    await writeFile(join(dir, "embark.json"), JSON.stringify({ repo: "embark", stack: [], relations: [] }));
    await writeFile(join(dir, "notes.txt"), "hello");
    const reports = await readReports(dir);
    expect(reports).toHaveLength(1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("skips a malformed json file instead of throwing", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-rel-"));
  try {
    await writeFile(join(dir, "embark.json"), JSON.stringify({ repo: "embark", stack: [], relations: [] }));
    await writeFile(join(dir, "broken.json"), "{ not valid json");
    const reports = await readReports(dir);
    expect(reports).toHaveLength(1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("skips a json file missing required fields", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-rel-"));
  try {
    await writeFile(join(dir, "incomplete.json"), JSON.stringify({ repo: "embark" }));
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

Run: `cd ~/aipe-worktree-relationship && bun test src/relationship/__tests__/backfill.test.ts src/relationship/__tests__/reports.test.ts`
Expected: FAIL — `Cannot find module "../backfill"` / `"../reports"`.

- [ ] **Step 3: Implement `backfill.ts`**

Create `src/relationship/backfill.ts`:

```ts
import type { BrainFile, RepoReport } from "./types";

export function backfillStack(brain: BrainFile, reports: RepoReport[]): BrainFile {
  const stackByRepo = new Map(reports.map((r) => [r.repo, r.stack]));

  return {
    ...brain,
    repos: brain.repos.map((repo) => {
      if (repo.stack && repo.stack.length > 0) return repo;
      const detected = stackByRepo.get(repo.name);
      return detected && detected.length > 0 ? { ...repo, stack: detected } : repo;
    }),
  };
}
```

- [ ] **Step 4: Implement `reports.ts`**

Create `src/relationship/reports.ts`:

```ts
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { RepoReport } from "./types";

function isValidReport(value: unknown): value is RepoReport {
  if (typeof value !== "object" || value === null) return false;
  const r = value as Record<string, unknown>;
  return typeof r.repo === "string" && Array.isArray(r.stack) && Array.isArray(r.relations);
}

export async function readReports(reportsDir: string): Promise<RepoReport[]> {
  let files: string[];
  try {
    files = await readdir(reportsDir);
  } catch {
    return [];
  }

  const reports: RepoReport[] = [];
  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    try {
      const raw = await readFile(join(reportsDir, file), "utf8");
      const parsed: unknown = JSON.parse(raw);
      if (isValidReport(parsed)) reports.push(parsed);
    } catch {
      // malformed report file: treated as a missing report for that repo
    }
  }
  return reports;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd ~/aipe-worktree-relationship && bun test src/relationship/__tests__/backfill.test.ts src/relationship/__tests__/reports.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 6: Commit**

```bash
cd ~/aipe-worktree-relationship && git add src/relationship/backfill.ts src/relationship/reports.ts src/relationship/__tests__/backfill.test.ts src/relationship/__tests__/reports.test.ts
git commit -m "feat: stack backfill and report-file reading for relationship"
```

---

## Task 4: `state.yaml` update (`state.ts`)

**Files:**
- Create: `src/relationship/state.ts`
- Test: `src/relationship/__tests__/state.test.ts`

**Interfaces:**
- Consumes: `Phase`, `StateFile` from `../context-brain/types`; `initialState` from `../context-brain/write`.
- Produces: `updateRelationshipPhase(workspaceDir: string, phase: Phase): Promise<string>`.

- [ ] **Step 1: Write the failing test**

Create `src/relationship/__tests__/state.test.ts`:

```ts
import { expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse, stringify } from "yaml";
import { updateRelationshipPhase } from "../state";

test("updates relationship preserving the other phases", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-relst-"));
  try {
    await mkdir(join(dir, ".aipe"), { recursive: true });
    await writeFile(
      join(dir, ".aipe", "state.yaml"),
      stringify({ phase: { brain: "done", workspace: "done", relationship: "pending", generator: "pending" } }),
      "utf8",
    );

    const statePath = await updateRelationshipPhase(dir, "done");
    const parsed = parse(await readFile(statePath, "utf8"));
    expect(parsed.phase.relationship).toBe("done");
    expect(parsed.phase.workspace).toBe("done");
    expect(parsed.phase.generator).toBe("pending");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("creates state from the default if missing", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-relst-"));
  try {
    const statePath = await updateRelationshipPhase(dir, "pending");
    const parsed = parse(await readFile(statePath, "utf8"));
    expect(parsed.phase.brain).toBe("done");
    expect(parsed.phase.relationship).toBe("pending");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd ~/aipe-worktree-relationship && bun test src/relationship/__tests__/state.test.ts`
Expected: FAIL — `Cannot find module "../state"`.

- [ ] **Step 3: Implement `state.ts`**

Create `src/relationship/state.ts`:

```ts
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parse, stringify } from "yaml";
import type { Phase, StateFile } from "../context-brain/types";
import { initialState } from "../context-brain/write";

export async function updateRelationshipPhase(workspaceDir: string, phase: Phase): Promise<string> {
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

  state.phase.relationship = phase;
  await mkdir(aipeDir, { recursive: true });
  await writeFile(statePath, stringify(state), "utf8");
  return statePath;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd ~/aipe-worktree-relationship && bun test src/relationship/__tests__/state.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
cd ~/aipe-worktree-relationship && git add src/relationship/state.ts src/relationship/__tests__/state.test.ts
git commit -m "feat: relationship phase update in state.yaml"
```

---

## Task 5: Orchestration (`run.ts`)

**Files:**
- Create: `src/relationship/run.ts`
- Test: `src/relationship/__tests__/run.test.ts`

**Interfaces:**
- Consumes: `readBrain` (`../make-workspace/read`), `readReports` (`./reports`), `mergeEdges` (`./merge`), `renderGraphYaml`/`renderReadme` (`./render`), `backfillStack` (`./backfill`), `updateRelationshipPhase` (`./state`), `RelationshipPhase` (`./types`).
- Produces:
  - `interface RepoRelationshipStatus { name: string; status: "ok" | "missing" }`
  - `type RunResult = { ok: true; results: RepoRelationshipStatus[]; phase: RelationshipPhase } | { ok: false; error: string }`
  - `runRelationship(workspaceDir: string): Promise<RunResult>`

- [ ] **Step 1: Write the failing test**

Create `src/relationship/__tests__/run.test.ts`:

```ts
import { expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile, readFile, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse, stringify } from "yaml";
import { runRelationship } from "../run";
import type { BrainFile } from "../types";

const brain: BrainFile = {
  context: { name: "opvibes", coordinator: "Nicolas" },
  repos: [
    { name: "embark", url: "git@github.com:opvibes/embark.git", path: "./embark" },
    { name: "prontuario", url: "git@github.com:opvibes/prontuario.git", path: "./prontuario" },
  ],
};

async function ws(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "aipe-rel-run-"));
  await mkdir(join(dir, ".aipe"), { recursive: true });
  await writeFile(join(dir, ".aipe", "brain.yaml"), stringify(brain), "utf8");
  await writeFile(
    join(dir, ".aipe", "state.yaml"),
    stringify({ phase: { brain: "done", workspace: "done", relationship: "pending", generator: "pending" } }),
    "utf8",
  );
  return dir;
}

async function putReport(dir: string, repo: string, content: unknown): Promise<void> {
  const reportsDir = join(dir, ".aipe", "relations", ".reports");
  await mkdir(reportsDir, { recursive: true });
  await writeFile(join(reportsDir, `${repo}.json`), JSON.stringify(content), "utf8");
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

test("all repos reported → phase done, graph/readme written, reports dir cleaned up", async () => {
  const dir = await ws();
  try {
    await putReport(dir, "embark", { repo: "embark", stack: ["typescript"], relations: [{ to: "prontuario", type: "consumes", detail: "d", evidence: "e" }] });
    await putReport(dir, "prontuario", { repo: "prontuario", stack: ["python"], relations: [] });

    const result = await runRelationship(dir);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.phase).toBe("done");
      expect(result.results.every((r) => r.status === "ok")).toBe(true);
    }

    const graph = parse(await readFile(join(dir, ".aipe", "relations", "graph.yaml"), "utf8"));
    expect(graph.edges).toHaveLength(1);

    const readme = await readFile(join(dir, ".aipe", "relations", "README.md"), "utf8");
    expect(readme).toContain("## embark");

    const updatedBrain = parse(await readFile(join(dir, ".aipe", "brain.yaml"), "utf8"));
    expect(updatedBrain.repos.find((r: { name: string }) => r.name === "embark").stack).toEqual(["typescript"]);

    const state = parse(await readFile(join(dir, ".aipe", "state.yaml"), "utf8"));
    expect(state.phase.relationship).toBe("done");

    expect(await exists(join(dir, ".aipe", "relations", ".reports"))).toBe(false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a missing report → phase pending, reports dir kept for retry", async () => {
  const dir = await ws();
  try {
    await putReport(dir, "embark", { repo: "embark", stack: [], relations: [] });

    const result = await runRelationship(dir);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.phase).toBe("pending");
      expect(result.results.find((r) => r.name === "prontuario")?.status).toBe("missing");
      expect(result.results.find((r) => r.name === "embark")?.status).toBe("ok");
    }

    const state = parse(await readFile(join(dir, ".aipe", "state.yaml"), "utf8"));
    expect(state.phase.relationship).toBe("pending");

    expect(await exists(join(dir, ".aipe", "relations", ".reports", "embark.json"))).toBe(true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("missing brain → ok:false, nothing written", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-rel-run-"));
  try {
    const result = await runRelationship(dir);
    expect(result.ok).toBe(false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("never overwrites a stack already declared in brain.yaml", async () => {
  const dir = await ws();
  try {
    const brainWithStack: BrainFile = {
      ...brain,
      repos: brain.repos.map((r) => (r.name === "embark" ? { ...r, stack: ["ruby"] } : r)),
    };
    await writeFile(join(dir, ".aipe", "brain.yaml"), stringify(brainWithStack), "utf8");
    await putReport(dir, "embark", { repo: "embark", stack: ["typescript"], relations: [] });
    await putReport(dir, "prontuario", { repo: "prontuario", stack: [], relations: [] });

    await runRelationship(dir);

    const updatedBrain = parse(await readFile(join(dir, ".aipe", "brain.yaml"), "utf8"));
    expect(updatedBrain.repos.find((r: { name: string }) => r.name === "embark").stack).toEqual(["ruby"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd ~/aipe-worktree-relationship && bun test src/relationship/__tests__/run.test.ts`
Expected: FAIL — `Cannot find module "../run"`.

- [ ] **Step 3: Implement `run.ts`**

Create `src/relationship/run.ts`:

```ts
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { stringify } from "yaml";
import { readBrain } from "../make-workspace/read";
import { backfillStack } from "./backfill";
import { mergeEdges } from "./merge";
import { readReports } from "./reports";
import { renderGraphYaml, renderReadme } from "./render";
import { updateRelationshipPhase } from "./state";
import type { RelationshipPhase } from "./types";

export interface RepoRelationshipStatus {
  name: string;
  status: "ok" | "missing";
}

export type RunResult =
  | { ok: true; results: RepoRelationshipStatus[]; phase: RelationshipPhase }
  | { ok: false; error: string };

export async function runRelationship(workspaceDir: string): Promise<RunResult> {
  const brainResult = await readBrain(workspaceDir);
  if (!brainResult.ok) return { ok: false, error: brainResult.error };
  const brain = brainResult.brain;

  const relationsDir = join(workspaceDir, ".aipe", "relations");
  const reportsDir = join(relationsDir, ".reports");
  const reports = await readReports(reportsDir);
  const reportedNames = new Set(reports.map((r) => r.repo));

  const results: RepoRelationshipStatus[] = brain.repos.map((repo) => ({
    name: repo.name,
    status: reportedNames.has(repo.name) ? "ok" : "missing",
  }));
  const phase: RelationshipPhase = results.every((r) => r.status === "ok") ? "done" : "pending";

  const edges = mergeEdges(reports);
  await mkdir(relationsDir, { recursive: true });
  await writeFile(join(relationsDir, "graph.yaml"), renderGraphYaml(edges), "utf8");
  await writeFile(
    join(relationsDir, "README.md"),
    renderReadme(edges, brain.repos.map((r) => r.name)),
    "utf8",
  );

  const backfilledBrain = backfillStack(brain, reports);
  await writeFile(join(workspaceDir, ".aipe", "brain.yaml"), stringify(backfilledBrain), "utf8");

  await updateRelationshipPhase(workspaceDir, phase);

  if (phase === "done") {
    await rm(reportsDir, { recursive: true, force: true });
  }

  return { ok: true, results, phase };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd ~/aipe-worktree-relationship && bun test src/relationship/__tests__/run.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
cd ~/aipe-worktree-relationship && git add src/relationship/run.ts src/relationship/__tests__/run.test.ts
git commit -m "feat: runRelationship orchestration"
```

---

## Task 6: CLI + manual end-to-end verification

**Files:**
- Create: `src/relationship/cli.ts`
- Test: `src/relationship/__tests__/cli.test.ts`

**Interfaces:**
- Consumes: `runRelationship` (`./run`), `RepoRelationshipStatus`/`RunResult` (`./run`), `RelationshipPhase` (`./types`).
- Produces: `renderReport(results: RepoRelationshipStatus[], phase: RelationshipPhase): string[]` (pure, testable).

- [ ] **Step 1: Write the failing test**

Create `src/relationship/__tests__/cli.test.ts`:

```ts
import { expect, test } from "bun:test";
import { renderReport } from "../cli";

test("renderReport formats each repo and the STATE line when done", () => {
  const lines = renderReport(
    [
      { name: "embark", status: "ok" },
      { name: "prontuario", status: "ok" },
    ],
    "done",
  );
  expect(lines).toContain("OK embark");
  expect(lines).toContain("OK prontuario");
  expect(lines.some((l) => l.startsWith("STATE relationship=done"))).toBe(true);
});

test("renderReport lists missing repos and marks pending", () => {
  const lines = renderReport(
    [
      { name: "embark", status: "ok" },
      { name: "prontuario", status: "missing" },
    ],
    "pending",
  );
  expect(lines).toContain("MISSING prontuario");
  expect(lines.some((l) => l.startsWith("STATE relationship=pending"))).toBe(true);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd ~/aipe-worktree-relationship && bun test src/relationship/__tests__/cli.test.ts`
Expected: FAIL — `Cannot find module "../cli"` (or `renderReport` undefined).

- [ ] **Step 3: Implement `cli.ts`**

Create `src/relationship/cli.ts`:

```ts
#!/usr/bin/env bun
import { runRelationship, type RepoRelationshipStatus } from "./run";
import type { RelationshipPhase } from "./types";

function getFlag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const value = args[i + 1];
  if (value === undefined || value.startsWith("--")) return undefined;
  return value;
}

export function renderReport(results: RepoRelationshipStatus[], phase: RelationshipPhase): string[] {
  const lines: string[] = [];
  for (const r of results) {
    lines.push(r.status === "ok" ? `OK ${r.name}` : `MISSING ${r.name}`);
  }
  const missing = results.filter((r) => r.status === "missing").length;
  const suffix = missing > 0 ? ` (${missing} missing report(s) of ${results.length} repos)` : "";
  lines.push(`STATE relationship=${phase}${suffix}`);
  return lines;
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const workspace = getFlag(args, "--workspace") ?? process.cwd();

  const result = await runRelationship(workspace);
  if (!result.ok) {
    console.log(`ERROR brain: ${result.error}`);
    return 1;
  }

  for (const line of renderReport(result.results, result.phase)) {
    console.log(line);
  }
  return result.phase === "done" ? 0 : 1;
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

Run: `cd ~/aipe-worktree-relationship && bun test src/relationship/__tests__/cli.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Manual end-to-end verification (no live agents needed — simulate their output)**

```bash
cd ~/aipe-worktree-relationship && RW=$(mktemp -d) && mkdir -p "$RW/.aipe/relations/.reports" && cat > "$RW/.aipe/brain.yaml" <<'YAML'
context:
  name: teste
  coordinator: Nicolas
repos:
  - name: embark
    url: git@github.com:opvibes/embark.git
    path: ./embark
  - name: prontuario
    url: git@github.com:opvibes/prontuario.git
    path: ./prontuario
YAML
cat > "$RW/.aipe/state.yaml" <<'YAML'
phase:
  brain: done
  workspace: done
  relationship: pending
  generator: pending
YAML
cat > "$RW/.aipe/relations/.reports/embark.json" <<'JSON'
{"repo":"embark","stack":["typescript","bun"],"relations":[{"to":"prontuario","type":"consumes","detail":"calls GET /api/patients","evidence":"src/clients/prontuario.ts:12"}]}
JSON
cat > "$RW/.aipe/relations/.reports/prontuario.json" <<'JSON'
{"repo":"prontuario","stack":["python"],"relations":[{"to":"embark","type":"exposed-by","detail":"exposes /api/patients","evidence":"src/routes/patients.ts:5"}]}
JSON
bun src/relationship/cli.ts --workspace "$RW"; echo "exit=$?"
cat "$RW/.aipe/relations/graph.yaml"
cat "$RW/.aipe/relations/README.md"
cat "$RW/.aipe/brain.yaml"
ls "$RW/.aipe/relations" # .reports/ must be gone
rm -rf "$RW"
```
Expected: `OK embark`, `OK prontuario`, `STATE relationship=done` (exit 0). `graph.yaml` has one merged edge (`consumes`, two perspectives). `brain.yaml` has `stack: [typescript, bun]` for embark and `stack: [python]` for prontuario. `.reports/` no longer exists.

- [ ] **Step 6: Run the full suite and type-check**

Run: `cd ~/aipe-worktree-relationship && bun test && bunx tsc --noEmit -p tsconfig.json`
Expected: all tests PASS, 0 type errors.

- [ ] **Step 7: Commit**

```bash
cd ~/aipe-worktree-relationship && git add src/relationship/cli.ts src/relationship/__tests__/cli.test.ts
git commit -m "feat: relationship CLI"
```

---

## Task 7: `/relationship` skill

**Files:**
- Create: `skills/relationship/SKILL.md`

**Interfaces:**
- Consumes: `src/relationship/cli.ts` (via `bun`), `<workspace>/.aipe/brain.yaml` and `state.yaml`.
- Produces: no code symbol — the conversational interface plus the exact `Agent()` schema the coordinator forces per repo.

- [ ] **Step 1: Write the skill**

Create `skills/relationship/SKILL.md`:

````markdown
---
name: relationship
description: Use in step 3 of AIPe onboarding to discover cross-repo relations (code deps, API contracts, shared infra, shared packages) once all repos are cloned, and to backfill the stack field in brain.yaml. Dispatches one read-only subagent per repo, then hands the structured results to a deterministic CLI.
---

# /relationship

Discovers how the repos in a context relate to each other, and documents that in
`.aipe/relations/`. Unlike `/context-brain` and `/make-workspace`, this skill needs
you (the coordinator) to dispatch subagents that actually read code — the merge,
rendering, and state update that follow are handled by a deterministic CLI, same as
the earlier onboarding steps.

## Flow

1. **Confirm the workspace.** By default the current directory (must be an
   `aipe-<context>` folder with `.aipe/brain.yaml`).

2. **Check the precondition.** Read `.aipe/state.yaml`. If `phase.workspace` is not
   `done`, stop and guide the PE to run `/make-workspace` first — there's nothing to
   read yet.

3. **Read `brain.yaml`** to get the repo list (`name`, `path`, and any already-known
   `stack`).

4. **Dispatch one subagent per repo, in parallel.** For each repo, launch a
   read-only agent (Explore or general-purpose) scoped to that repo's directory
   only. Give it:
   - Its own repo name and path.
   - The full list of the *other* repos in the context (name + known stack, if
     any), so it knows what names/URLs/packages to look for.
   - Instructions to report **every** relation type it finds — code imports of
     another context repo's package, API calls to/from another context repo,
     shared infrastructure (same DB/queue/bucket/env), or packages it publishes
     that another context repo imports — plus the stack it detects for its own
     repo (from manifest files: `package.json`, `Cargo.toml`, etc.).
   - A forced structured output matching exactly this shape:
     ```json
     {
       "repo": "<repo-name>",
       "stack": ["typescript", "bun"],
       "relations": [
         {
           "to": "<other-repo-name>",
           "type": "imports | published-by | consumes | exposed-by | shares-infra",
           "detail": "one sentence describing the relation",
           "evidence": "path/to/file.ts:line"
         }
       ]
     }
     ```
     `relations` may be an empty array. `type` must be exactly one of the five
     listed values — nothing else.

5. **Save each result** to `<workspace>/.aipe/relations/.reports/<repo-name>.json`
   (create the directory if needed). One file per repo, exactly as the agent
   returned it.

6. **Run the CLI:**
   ```bash
   bun <plugin-path>/src/relationship/cli.ts --workspace <workspace>
   ```

7. **Translate the output to the PE:**
   - `OK <repo>` → a report was found and merged in.
   - `MISSING <repo>` → no report file for that repo (the agent may have failed or
     timed out). The reports directory is preserved when any repo is missing, so
     re-dispatching just the missing repos' agents and re-running the CLI is safe
     and won't lose the ones that already succeeded.
   - `STATE relationship=done|pending` → aggregated state.

8. **Report the artifacts.** On `done`, point the PE to
   `.aipe/relations/graph.yaml` (machine-readable source of truth) and
   `.aipe/relations/README.md` (human-readable summary), and mention that
   `brain.yaml` may now have `stack` filled in for repos that didn't declare one.

9. **Next step:** once `relationship=done`, the context is ready for
   `/hire-specialists`.

## Rules

- Never write `graph.yaml`, `README.md`, `brain.yaml`, or `state.yaml` by hand —
  always through the CLI.
- Each subagent must stay scoped to its own repo — no cross-repo file access. The
  CLI is what reconciles perspectives from different repos, not the agents
  themselves.
- Re-running `/relationship` after it already reached `done` re-dispatches all N
  agents and overwrites `graph.yaml`/`README.md`/backfilled `stack` from scratch —
  there's no incremental merge across full runs.
- `stack` backfill never overwrites a value the PE already declared in `brain.yaml`.
````

- [ ] **Step 2: Check coherence with the existing pattern**

Run: `cd ~/aipe-worktree-relationship && cat skills/make-workspace/SKILL.md skills/relationship/SKILL.md | head -80`
Expected: frontmatter (`name`/`description`) in the same format as the other skills; flow uses the same `OK`/`MISSING`/`STATE` line style as `/make-workspace`'s `OK`/`SKIP`/`ERROR`/`STATE`.

- [ ] **Step 3: Commit**

```bash
cd ~/aipe-worktree-relationship && git add skills/relationship/SKILL.md
git commit -m "feat: /relationship skill"
```

---

## Self-Review (by the plan's author)

**Spec coverage:**
- §2 scope of relation types (closed enum) → Task 1 (`RelationType` + `merge.ts` canonicalization tests).
- §3 fan-out architecture (1 agent/repo, schema, staging files) → Task 7 (SKILL.md flow steps 3-5).
- §5 deterministic merge steps 1-7 (read reports, merge, graph.yaml, README.md, backfill, state, cleanup) → Task 3 (`reports.ts`, `backfill.ts`), Task 1 (`merge.ts`), Task 2 (`render.ts`), Task 4 (`state.ts`), Task 5 (`run.ts` ties all of it together, including the done-only cleanup rule from Global Constraints).
- §4 precondition + coordinator flow → Task 7 (SKILL.md steps 1-9).
- §6 partial failure (no abort, `pending` state, retry only missing) → Task 5 (`run.test.ts` "a missing report" case) + the `.reports/` retention-on-pending rule in Global Constraints.
- §7 file layout → File Structure section matches 1:1.
- §8 implementation shape → File Structure section matches 1:1 (module names, responsibilities).

**Placeholder scan:** no TBD/TODO; every code step has complete code; the SKILL.md has the full literal schema, not a description of one.

**Type consistency:** `RepoReport`/`RawRelation`/`MergedEdge`/`Perspective`/`RelationType`/`RelationshipPhase` defined once in Task 1 and reused identically across Tasks 2-6. `RepoRelationshipStatus`/`RunResult` defined in Task 5 and reused identically in Task 6's `cli.ts`. `updateRelationshipPhase(workspaceDir, phase)` signature identical between Task 4's `state.ts` and its Task 5 `run.ts` call site. `backfillStack(brain, reports)` and `mergeEdges(reports)` signatures identical between their defining tasks (1, 3) and their Task 5 call sites.
