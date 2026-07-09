// Shared fixture snapshot reused by every view-task test suite. A representative
// slice of the raw payload GET /api/snapshot (+ SSE deltas) produces, shaped to
// match RawSnapshot (runtime/store.ts). Two repos — "web" (single-package) and
// "core" (a monorepo with two packages) — four workers with varied statuses
// (including one "escalated"), a relation between units, journeys whose
// dispatches span every pipeline status (including one delivered dispatch that
// carries a `pr`), toolbox skills+mcps, worktrees and personaCVs.
import { applySnapshot, type RawSnapshot } from "../runtime/store";

export const fixtureSnapshot: RawSnapshot = {
  ok: true,
  context: { name: "aipe-demo", coordinator: "Coordinator" },
  workers: [
    { name: "Coordinator", role: "coordinator", repo: "web", status: "active" },
    { name: "Ana", role: "dev", repo: "web", package: null, status: "active", journey: "j-web-1" },
    { name: "Bruno", role: "dev", repo: "core", package: "api", status: "delivered", journey: "j-core-1", pr: "https://github.com/example/core/pull/12" },
    { name: "Carla", role: "qa", repo: "core", package: "ui", status: "escalated", journey: "j-core-2" },
    { name: "Diego", role: "dev", repo: "web", package: null, status: "available" },
  ],
  repos: ["web", "core"],
  repoInfos: [
    { name: "web", stack: ["ts", "preact"], kind: "service" },
    { name: "core", stack: ["ts"], kind: "monorepo" },
  ],
  packages: [
    { repo: "core", package: "api", implicit: false, stack: ["ts", "node"], kind: "service", group: "api" },
    { repo: "core", package: "ui", implicit: false, stack: ["ts", "preact"], kind: "lib", group: "ui" },
    { repo: "core", package: "gen", implicit: true, stack: [], kind: "" },
  ],
  relations: [
    { from: "core/api", to: "core/ui", type: "depends" },
    { from: "web", to: "core/api", type: "depends" },
  ],
  toolboxDetail: {
    skills: [
      { name: "test-driven-development", whenToUse: "Ao implementar qualquer feature", repos: ["web", "core"] },
      { name: "systematic-debugging", whenToUse: "Ao investigar um bug", repos: ["core"] },
    ],
    mcps: [
      { name: "github", scope: "org" },
      { name: "playwright", scope: "repo" },
    ],
  },
  worktreeRows: [
    { repo: "web", branch: "feat/ana-onboarding" },
    { repo: "core", package: "api", branch: "feat/bruno-api-limits" },
  ],
  journeys: [
    {
      id: "j-web-1",
      dispatches: [
        { repo: "web", package: null, specialist: "Ana", status: "dispatched", journey: "j-web-1" },
      ],
    },
    {
      id: "j-core-1",
      dispatches: [
        { repo: "core", package: "api", specialist: "Bruno", status: "delivered", pr: "https://github.com/example/core/pull/12", journey: "j-core-1" },
        { repo: "core", package: "api", specialist: "Bruno", status: "merged", journey: "j-core-1" },
      ],
    },
    {
      id: "j-core-2",
      dispatches: [
        { repo: "core", package: "ui", specialist: "Carla", status: "escalated", journey: "j-core-2" },
      ],
    },
  ],
  personaCVs: [
    { name: "Ana", title: "Frontend Developer", bio: "Ships Preact UIs.", competences: ["preact", "typescript"] },
    { name: "Bruno", title: "Backend Developer", bio: "Owns the API package.", competences: ["node", "postgres"] },
    { name: "Carla", title: "QA Engineer", bio: "Breaks things on purpose.", competences: ["playwright", "qa"] },
    { name: "Diego", title: "Frontend Developer", bio: "", competences: ["preact"] },
  ],
  counts: { hired: 4, active: 1, delivered: 1, escalated: 1, available: 1 },
};

/** Loads fixtureSnapshot into the store's signals at a fixed `now`. */
export function loadFixture(now = 1_700_000_000_000) {
  return applySnapshot(fixtureSnapshot, now);
}
