import { expect, test } from "bun:test";
import { assemble } from "../assemble";
import type { LiveSessions } from "../liveness";
import { DEFAULT_STATUS_PREF } from "../types";
import type { JourneyLedger } from "../../journey/types";
import type { PersonaRegistryEntry } from "../../hire-specialists/types";
import type { ModelPolicy } from "../../model/types";

const policy: ModelPolicy = { default: "standard", authorizationTiers: ["frontier"], reasoningNotifyMaxDispatches: 8 };
const roster: PersonaRegistryEntry[] = [
  { name: "Jesse", role: "dev-fullstack", repo: "aipe", path: null },
  { name: "Mike", role: "qa", repo: "aipe", path: null },
];

function reliableLive(ids: string[]): LiveSessions {
  return { source: "agentop", reliable: true, ids: new Set(ids) };
}

const base = {
  workspace: "/ws",
  contextName: "blpsoares",
  scope: "all" as const,
  roster,
  policy,
  pref: DEFAULT_STATUS_PREF,
  elision: null,
};

test("a unit carries persona role, fqid, branch, pr and ledger status (item 2)", () => {
  const ledgers: JourneyLedger[] = [
    {
      id: "j1",
      dispatches: [
        {
          repo: "aipe",
          task: "status-cli",
          specialist: "Jesse",
          branch: "aipe/j1/jesse__status-cli",
          worktree: "/w",
          pr: "https://github.com/blpsoares/aipe/pull/29",
          status: "delivered",
          mode: "session",
          sessionId: "s-1",
          tier: "reasoning",
          evidence: { by: "dev", commands: ["bun test"], summary: "green" },
        },
      ],
    },
  ];
  const report = assemble({ ...base, ledgers, live: reliableLive(["s-1"]) });
  const u = report.units[0]!;
  expect(u.fqid).toBe("aipe");
  expect(u.role).toBe("dev-fullstack");
  expect(u.task).toBe("status-cli");
  expect(u.pr).toBe("https://github.com/blpsoares/aipe/pull/29");
  expect(u.status).toBe("delivered");
  expect(u.hasEvidence).toBe(true);
});

test("role is null when the roster does not name the specialist (reported, not guessed)", () => {
  const ledgers: JourneyLedger[] = [
    { id: "j1", dispatches: [{ repo: "aipe", specialist: "Ghost", branch: "b", worktree: "w", status: "dispatched" }] },
  ];
  const report = assemble({ ...base, ledgers, live: reliableLive([]) });
  expect(report.units[0]!.role).toBeNull();
});

test("role matches case-insensitively (the ledger records both Viola and viola)", () => {
  const ledgers: JourneyLedger[] = [
    { id: "j1", dispatches: [{ repo: "aipe", specialist: "jesse", branch: "b", worktree: "w", status: "dispatched" }] },
  ];
  const report = assemble({ ...base, ledgers, live: reliableLive([]) });
  expect(report.units[0]!.role).toBe("dev-fullstack");
});

test("session liveness: alive vs silent vs unknown, never guessed (item 5)", () => {
  const mk = (id: string, sessionId: string): JourneyLedger => ({
    id,
    dispatches: [{ repo: "aipe", specialist: "Jesse", branch: "b", worktree: "w", status: "dispatched", mode: "session", sessionId }],
  });
  const alive = assemble({ ...base, ledgers: [mk("j1", "s-1")], live: reliableLive(["s-1"]) });
  expect(alive.units[0]!.liveness).toBe("running");
  const silent = assemble({ ...base, ledgers: [mk("j2", "s-2")], live: reliableLive(["other"]) });
  expect(silent.units[0]!.liveness).toBe("dead-silent");
  const unknown = assemble({ ...base, ledgers: [mk("j3", "s-3")], live: { source: "agentop", reliable: false, ids: new Set() } });
  expect(unknown.units[0]!.liveness).toBe("unknown");
});

test("subagent units have null liveness — there is no session to describe", () => {
  const ledgers: JourneyLedger[] = [
    { id: "j1", dispatches: [{ repo: "aipe", specialist: "Jesse", branch: "b", worktree: "w", status: "dispatched", mode: "subagent" }] },
  ];
  const report = assemble({ ...base, ledgers, live: reliableLive([]) });
  expect(report.units[0]!.liveness).toBeNull();
});

test("waiting-on-the-PE derives gated, escalated, redirected, blocked, no-evidence (item 2)", () => {
  const ledgers: JourneyLedger[] = [
    {
      id: "j1",
      dispatches: [
        { repo: "aipe", specialist: "Jesse", branch: "b1", worktree: "w", status: "dispatched", tier: "frontier" },
        { repo: "aipe", package: "x", specialist: "Jesse", branch: "b2", worktree: "w", status: "escalated" },
        { repo: "aipe", package: "y", specialist: "Jesse", branch: "b3", worktree: "w", status: "redirected", redirectReason: "PE changed scope" },
        { repo: "aipe", package: "z", specialist: "Jesse", branch: "b4", worktree: "w", status: "blocked", blockedReason: "needs a secret" },
        { repo: "aipe", package: "q", specialist: "Jesse", branch: "b5", worktree: "w", status: "delivered" },
      ],
    },
  ];
  const report = assemble({ ...base, ledgers, live: reliableLive([]) });
  const kinds = report.waiting.map((w) => w.kind).sort();
  expect(kinds).toEqual(["blocked", "escalated", "gated", "no-evidence", "redirected"]);
  expect(report.waiting.find((w) => w.kind === "redirected")!.detail).toBe("PE changed scope");
});

test("a gated tier already authorized is NOT waiting", () => {
  const ledgers: JourneyLedger[] = [
    {
      id: "j1",
      dispatches: [{ repo: "aipe", specialist: "Jesse", branch: "b", worktree: "w", status: "dispatched", tier: "frontier" }],
      authorizations: [{ tier: "frontier", grantedBy: "PE" }],
    },
  ];
  const report = assemble({ ...base, ledgers, live: reliableLive([]) });
  expect(report.waiting.filter((w) => w.kind === "gated")).toHaveLength(0);
});

test("journey row counts open vs done and reads the spec approval", () => {
  const ledgers: JourneyLedger[] = [
    {
      id: "j1",
      spec: { path: "p", version: 3, approved: true },
      dispatches: [
        { repo: "aipe", specialist: "Jesse", branch: "b1", worktree: "w", status: "dispatched" },
        { repo: "aipe", package: "x", specialist: "Mike", branch: "b2", worktree: "w", status: "merged" },
        { repo: "aipe", package: "y", specialist: "Mike", branch: "b3", worktree: "w", status: "verified" },
      ],
    },
  ];
  const report = assemble({ ...base, ledgers, live: reliableLive([]) });
  const j = report.journeys[0]!;
  expect(j).toMatchObject({ specApproved: true, specVersion: 3, open: 1, done: 2, total: 3 });
});

test("liveness note is honest when agentop is absent but sessions exist (item 6)", () => {
  const ledgers: JourneyLedger[] = [
    { id: "j1", dispatches: [{ repo: "aipe", specialist: "Jesse", branch: "b", worktree: "w", status: "dispatched", mode: "session", sessionId: "s" }] },
  ];
  const report = assemble({ ...base, ledgers, live: { source: "none", reliable: false, ids: new Set() } });
  expect(report.units[0]!.liveness).toBe("unknown");
  expect(report.liveness.note).toContain("agentop not installed");
});

test("no session-mode units → liveness note says so, not a false 'alive'", () => {
  const ledgers: JourneyLedger[] = [
    { id: "j1", dispatches: [{ repo: "aipe", specialist: "Jesse", branch: "b", worktree: "w", status: "merged", mode: "subagent" }] },
  ];
  const report = assemble({ ...base, ledgers, live: reliableLive([]) });
  expect(report.liveness.note).toContain("not applicable");
});
