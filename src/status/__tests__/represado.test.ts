import { expect, test } from "bun:test";
import type { JourneyLedger } from "../../journey/types";
import type { PersonaRegistryEntry } from "../../hire-specialists/types";
import type { ModelPolicy } from "../../model/types";
import type { RepoReleaseState } from "../../release/types";
import { assemble } from "../assemble";
import type { LiveSessions } from "../liveness";
import { renderJson, renderTable } from "../render";
import { DEFAULT_STATUS_PREF } from "../types";

const policy: ModelPolicy = { default: "standard", authorizationTiers: ["frontier"], reasoningNotifyMaxDispatches: 8 };
const roster: PersonaRegistryEntry[] = [{ name: "Jesse", role: "dev-fullstack", repo: "aipe", path: null }];
const live: LiveSessions = { source: "none", reliable: false, sessions: new Map() };

const rel = (repo: string, over: Partial<RepoReleaseState>): RepoReleaseState => ({
  repo,
  flow: "dev-then-main",
  state: "published",
  latestReleaseTag: "v1.11.0",
  unreleasedOnMain: 0,
  unpromotedOnDev: 0,
  reason: "",
  ...over,
});

function build(dispatches: JourneyLedger["dispatches"], releaseStates: Map<string, RepoReleaseState>) {
  return assemble({
    workspace: "/ws",
    contextName: "blpsoares",
    scope: "all",
    ledgers: [{ id: "j1", dispatches }],
    roster,
    policy,
    live,
    pref: DEFAULT_STATUS_PREF,
    elision: null,
    releaseStates,
  });
}

const merged = { repo: "aipe", specialist: "Jesse", branch: "b", worktree: "w", status: "merged" as const };

test("a merged unit inherits its repo's publication state; a non-merged unit does not", () => {
  const states = new Map([["aipe", rel("aipe", { state: "merged-unpublished", unpromotedOnDev: 3, reason: "3 commit(s) merged into dev not yet in main" })]]);
  const report = build(
    [merged, { repo: "aipe", specialist: "Jesse", branch: "b2", worktree: "w2", status: "delivered", evidence: { by: "dev", commands: ["x"], summary: "ok" } }],
    states,
  );
  expect(report.units[0]!.publishState).toBe("merged-unpublished");
  expect(report.units[1]!.publishState).toBeNull(); // delivered → no publication question
});

test("release states with no resolution leave publishState null (no guessed verdict)", () => {
  const report = build([merged], new Map());
  expect(report.units[0]!.publishState).toBeNull();
  expect(report.releases).toHaveLength(0);
});

test("the represado section lists unpublished + unknown repos, and is silent on published", () => {
  const states = new Map([
    ["aipe", rel("aipe", { state: "merged-unpublished", reason: "2 commit(s) on main beyond v1.11.0" })],
  ]);
  const report = build([merged], states);
  const table = renderTable(report, "detailed", false).join("\n");
  expect(table).toContain("REPRESADO");
  expect(table).toContain("aipe");
  expect(table).toContain("merged-unpublished");
  // A published repo raises no represado row.
  const clean = build([merged], new Map([["aipe", rel("aipe", { state: "published" })]]));
  const cleanRows = renderTable(clean, "detailed", false).join("\n");
  // The header always shows (item 2 shouts), but there is no aipe row under it —
  // the section renders "(none)".
  expect(cleanRows).toContain("REPRESADO");
  expect(cleanRows).toMatch(/REPRESADO[^]*?\(none\)/);
});

test("the merged unit's status cell is decorated for unpublished, plain for published", () => {
  const unpub = build([merged], new Map([["aipe", rel("aipe", { state: "merged-unpublished", reason: "x" })]]));
  expect(renderTable(unpub, "compact", false).join("\n")).toContain("merged·unpublished");
  const pub = build([merged], new Map([["aipe", rel("aipe", { state: "published" })]]));
  const pubTable = renderTable(pub, "compact", false).join("\n");
  expect(pubTable).not.toContain("merged·unpublished");
});

test("the JSON carries releases and per-unit publishState for the coordinator's chat table", () => {
  const states = new Map([["aipe", rel("aipe", { state: "merged-unpublished", reason: "x" })]]);
  const json = JSON.parse(renderJson(build([merged], states)));
  expect(json.releases[0].state).toBe("merged-unpublished");
  expect(json.units[0].publishState).toBe("merged-unpublished");
});
