// Curated kit registry — the frameworks AIPe knows how to install by name, so
// `aipe skill add <kit> --repo <r>` "just works" without a JSON payload. Each
// kit carries its catalog metadata (description/objective/whenToUse/routing) and
// its SKILL.md content, embedded here so the compiled binary is self-contained
// (no network, no external runtime). Custom skills still go through --input.
import type { SkillRouting } from "./types";

export interface CuratedKit {
  name: string;
  description: string;
  objective: string;
  whenToUse: string;
  routing?: SkillRouting;
  content: string; // the SKILL.md body installed into each repo
}

// The always-on floor: spec + evidence even for small tasks, no heavy runtime.
const SDD_LITE = `---
name: sdd-lite
description: Lightweight spec-first floor for a task — a short spec, evidence, and a task doc, committed in the PR. Always available; use it for any change that is not covered by the full spec-kit flow.
---

# sdd-lite — the spec-first floor

Even a small change keeps a paper trail. Before touching code, write a **short
spec** in the PR/worktree, then work against it, then attach **evidence**.

## 1. Mini-spec (a few lines, not a document)
- **Problem** — what is being changed and why (1–2 sentences).
- **Scope** — the exact files/behaviour in; what is explicitly out.
- **Acceptance** — how we know it's done (observable checks).

## 2. Build against it
Make the change. If it grows beyond "small" (new contract, cross-package impact,
migration), stop and escalate — that task wants the full **spec-kit** flow.

## 3. Evidence (this is the point)
Commit, alongside the change, objective proof it works:
- test output / a new characterization test,
- a screenshot or captured command output for anything user-visible,
- a one-paragraph task doc: what changed, how it was verified, what was left out.

No commits are authored without the PE's go; evidence travels in the PR.
`;

// The full/heavy tier — GitHub Spec Kit, routed only to non-trivial tasks.
const SPEC_KIT = `---
name: spec-kit
description: Full spec-driven development (GitHub Spec Kit) for non-trivial tasks — /speckit.specify → plan → tasks → implement, scoped to your package, committed in the PR.
---

# spec-kit — full spec-driven development

For a **non-trivial** task (a new contract, a new package/service, a migration,
anything the router sends here), run the Spec Kit flow **scoped to your package**:

1. **/speckit.specify** — the *what* and *why*, focused on your package's slice.
2. **/speckit.plan** — tech approach and architecture.
3. **/speckit.tasks** — the actionable breakdown.
4. **/speckit.implement** — build against the plan, TDD.

Commit the generated spec/plan/tasks **into your PR**. The Spec Kit templates and
commands are materialized in this repo (\`.specify/\` + the \`/speckit.*\` commands)
so no external CLI/runtime is needed. Do not run the full flow on a trivial edit —
that is what **sdd-lite** is for.
`;

// The PE's parity framework — routed to migration/rewrite/port tasks only.
const PDD = `---
name: pdd
description: Parity-Driven Development for legacy refactor/rewrite/port — track behavioral parity against a reference system with objective, gated evidence. Use only for migration/parity tasks, not greenfield.
---

# pdd — parity-driven development

Use this **only** when the task is migrating, rewriting, or porting against a
**reference (legacy) system** and behavioral parity must be proven. It is a gated,
evidence-first cycle whose state lives in \`.audit/\` (not in model context):

- Every reference behavior becomes a tracked **finding** to investigate, fix, and
  **prove** with parity evidence before it reaches \`main\`.
- **The AI never authors commits**; push / PR / merge happen only after an explicit
  human "yes". **Merge is 100% human**, after QA approves.

Install the plugin per-project (\`blpsoares/parity-driven-development\`). For a
greenfield feature there is nothing to track parity against — use sdd-lite / spec-kit.
`;

export const KITS: Record<string, CuratedKit> = {
  "sdd-lite": {
    name: "sdd-lite",
    description: "Lightweight spec-first floor: short spec + evidence + task doc.",
    objective: "Keep every change spec-first with objective evidence, cheaply.",
    whenToUse: "Any task not routed to the full spec-kit flow — the default floor.",
    content: SDD_LITE,
  },
  "spec-kit": {
    name: "spec-kit",
    description: "GitHub Spec Kit — full spec-driven development (/speckit.*).",
    objective: "Drive non-trivial tasks from an executable spec to implementation.",
    whenToUse: "Non-trivial tasks: new contracts, new packages/services, migrations.",
    routing: { skipFor: ["styling", "copy", "one-liner", "chore"], minSize: "medium" },
    content: SPEC_KIT,
  },
  pdd: {
    name: "pdd",
    description: "Parity-Driven Development — tracked behavioral parity for migrations.",
    objective: "Prove a rewrite/port behaves like its reference, with gated evidence.",
    whenToUse: "Migration/rewrite/port tasks with a legacy reference — never greenfield.",
    routing: { taskTypes: ["migration", "refactor", "port", "rewrite"] },
    content: PDD,
  },
};

export function resolveKit(name: string): CuratedKit | undefined {
  return KITS[name.toLowerCase()];
}

export function kitNames(): string[] {
  return Object.keys(KITS);
}
