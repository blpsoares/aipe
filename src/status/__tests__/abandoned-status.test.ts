// D4 (j-20260830-w0) — "failed sem evidência é indistinguível de reprovação".
// A QA rejection (`failed`, now WITH evidence) and a session that died before
// ever forming a verdict (`abandoned`) must render visibly differently in
// `aipe status` — the exact gap that let the coordinator read Tyrus's dead
// session as a QA rejection until they opened the YAML by hand.
import { expect, test } from "bun:test";
import { assemble } from "../assemble";
import { renderTable, supportsColor } from "../render";
import type { LiveSessions } from "../liveness";
import { DEFAULT_STATUS_PREF } from "../types";
import type { JourneyLedger } from "../../journey/types";
import type { PersonaRegistryEntry } from "../../hire-specialists/types";
import type { ModelPolicy } from "../../model/types";
import type { RepoReleaseState } from "../../release/types";

const policy: ModelPolicy = { default: "standard", authorizationTiers: ["frontier"], reasoningNotifyMaxDispatches: 8 };
const roster: PersonaRegistryEntry[] = [{ name: "Tyrus", role: "qa", repo: "agentistics", path: null }];
const noLive: LiveSessions = { source: "none", reliable: false, sessions: new Map() };

const base = {
  workspace: "/ws",
  contextName: "blpsoares",
  scope: "all" as const,
  roster,
  policy,
  pref: DEFAULT_STATUS_PREF,
  elision: null,
  releaseStates: new Map<string, RepoReleaseState>(),
};

function ledgerWith(status: "failed" | "abandoned", extra: Record<string, unknown> = {}): JourneyLedger[] {
  return [
    {
      id: "j1",
      dispatches: [
        {
          repo: "agentistics",
          specialist: "Tyrus",
          branch: "aipe/j1/web--tyrus",
          worktree: "/w",
          status,
          ...extra,
        } as JourneyLedger["dispatches"][number],
      ],
    },
  ];
}

test("a real QA rejection (failed, with evidence) and a dead session with no verdict (abandoned) carry DIFFERENT status words", () => {
  const failedReport = assemble({
    ...base,
    ledgers: ledgerWith("failed", { evidence: { by: "qa", commands: ["bun test"], summary: "3 broke" } }),
    live: noLive,
  });
  const abandonedReport = assemble({
    ...base,
    ledgers: ledgerWith("abandoned", { abandonedReason: "agentop reports the session gone; no ledger record was ever written" }),
    live: noLive,
  });

  expect(failedReport.units[0]!.status).toBe("failed");
  expect(abandonedReport.units[0]!.status).toBe("abandoned");
  expect(failedReport.units[0]!.status).not.toBe(abandonedReport.units[0]!.status);
});

test("the rendered status table prints them as visibly distinct words, never both as \"failed\"", () => {
  const failedReport = assemble({
    ...base,
    ledgers: ledgerWith("failed", { evidence: { by: "qa", commands: ["bun test"], summary: "3 broke" } }),
    live: noLive,
  });
  const abandonedReport = assemble({
    ...base,
    ledgers: ledgerWith("abandoned", { abandonedReason: "session died mid-gate" }),
    live: noLive,
  });

  // Over the whole render: the specialist's name is in table 1 and the status
  // word in table 2, so a single line can no longer carry both.
  const failedLine = renderTable(failedReport, "detailed", false).join("\n");
  const abandonedLine = renderTable(abandonedReport, "detailed", false).join("\n");

  // The glossary's words, not the ledger's — that is the point of the column.
  expect(failedLine).toContain("Reprovado");
  expect(abandonedLine).toContain("Abandonado");
  expect(abandonedLine).not.toContain("Reprovado");
});

test("only abandoned surfaces as WAITING ON YOU with its reason — a QA-rejected unit is dev's turn, not the coordinator's", () => {
  const report = assemble({
    ...base,
    ledgers: ledgerWith("abandoned", { abandonedReason: "agentop reports the session gone; no ledger record was ever written" }),
    live: noLive,
  });
  const item = report.waiting.find((w) => w.kind === "abandoned");
  expect(item).toBeDefined();
  expect(item!.detail).toContain("agentop reports the session gone");
});

test("abandoned counts as OPEN work in the journey tally, same as failed", () => {
  const report = assemble({
    ...base,
    ledgers: ledgerWith("abandoned", { abandonedReason: "x" }),
    live: noLive,
  });
  expect(report.journeys[0]!.open).toBe(1);
  expect(report.journeys[0]!.done).toBe(0);
});

test("color mode never collapses the two into the same painted string either", () => {
  const failedReport = assemble({
    ...base,
    ledgers: ledgerWith("failed", { evidence: { by: "qa", commands: ["bun test"], summary: "3 broke" } }),
    live: noLive,
  });
  const abandonedReport = assemble({
    ...base,
    ledgers: ledgerWith("abandoned", { abandonedReason: "x" }),
    live: noLive,
  });
  const color = supportsColor({ isTTY: true }, {});
  // The status word lives in table 2 and the specialist's name in table 1, so
  // the assertion is over the whole render: the two states must never collapse
  // into the same word, which is the defect this test exists for.
  const failedLine = renderTable(failedReport, "detailed", color).join("\n");
  const abandonedLine = renderTable(abandonedReport, "detailed", color).join("\n");
  expect(failedLine).not.toBe(abandonedLine);
});
