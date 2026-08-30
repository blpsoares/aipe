import { test, expect, describe } from "bun:test";
import { computeReport, type ReportJourney } from "../compute";

// A representative slice of the messy real ledger: status progression + fix
// loops (double-count trap), persona case duplicates, stacked PRs, and legacy
// rows with no envelope. Journey ids carry parseable dates (j-AAAAMMDD-xx).
const JOURNEYS: ReportJourney[] = [
  {
    id: "j-20260801-aa",
    dispatches: [
      // one unit, three rows (delivered → verified → merged) — MUST count once
      { repo: "aipe", task: "t1", specialist: "Jesse", status: "delivered", pr: "PR1", model: "claude-opus-4-8", harness: "claude-code", tier: "reasoning" },
      { repo: "aipe", task: "t1", specialist: "Jesse", status: "verified", pr: "PR1", model: "claude-opus-4-8", harness: "claude-code", tier: "reasoning" },
      { repo: "aipe", task: "t1", specialist: "jesse", status: "merged", pr: "PR1", model: "claude-opus-4-8", harness: "claude-code", tier: "reasoning" },
    ],
  },
  {
    id: "j-20260802-bb",
    dispatches: [
      // fix loop on one unit: delivered → failed → delivered — one delivery
      { repo: "aipe", task: "t2", specialist: "Mike", status: "delivered", pr: "PR2", model: "claude-sonnet-5" },
      { repo: "aipe", task: "t2", specialist: "Mike", status: "failed", pr: "PR2", model: "claude-sonnet-5" },
      { repo: "aipe", task: "t2", specialist: "Mike", status: "delivered", pr: "PR2", model: "claude-sonnet-5" },
    ],
  },
  {
    id: "j-20260803-cc",
    dispatches: [
      // legacy: no envelope at all, still in flight (open PR)
      { repo: "agentistics", task: "t3", specialist: "Viola", status: "dispatched", pr: "PR3" },
      // integrated-by-git but ledger not merged → derived merge
      { repo: "agentistics", task: "t4", specialist: "Viola", status: "verified", pr: "PR4", integrated: true, model: "claude-opus-4-8" },
    ],
  },
];

describe("counting model (no double count)", () => {
  test("a unit delivered across delivered/verified/merged rows counts as ONE delivery", () => {
    const r = computeReport(JOURNEYS);
    // units that reached a done state: t1, t2, t4  (t3 is still dispatched)
    expect(r.overall.deliveries).toBe(3);
  });

  test("Jesse and jesse are the SAME person — persona duplicates are recorded", () => {
    const r = computeReport(JOURNEYS);
    const dup = r.honesty.personaDuplicates.find((d) => d.canonical.toLowerCase() === "jesse");
    expect(dup).toBeTruthy();
    expect(dup!.variants.sort()).toEqual(["Jesse", "jesse"]);
    expect(dup!.canonical).toBe("Jesse"); // capitalised variant wins
  });

  test("qaVerified counts distinct verified/merged units (t1, t4), not the dispatched t3", () => {
    const r = computeReport(JOURNEYS);
    expect(r.overall.qaVerified).toBe(2);
  });

  test("stacked PR counted once; merged measured vs integration derived", () => {
    const r = computeReport(JOURNEYS);
    expect(r.overall.prsMerged).toBe(1); // PR1 (status merged)
    expect(r.overall.prsMergedDerived).toBe(1); // PR4 (integrated by git, not ledger-merged)
    expect(r.overall.prsOpen).toBe(2); // PR2 (delivered) + PR3 (dispatched)
  });
});

describe("honesty about the data", () => {
  test("records with no envelope are counted as absence, reported, not zero", () => {
    const r = computeReport(JOURNEYS);
    expect(r.honesty.noEnvelope).toBe(1); // only PR3 row lacks harness+model+tier
  });

  test("grouping by model puts envelope-less rows in their OWN bucket, never folded into a real model", () => {
    const r = computeReport(JOURNEYS, { groupBy: ["model"] });
    const keys = r.groups.map((g) => g.key.model);
    expect(keys).toContain("claude-opus-4-8");
    expect(keys).toContain("— sem modelo —");
    // the sem-modelo bucket holds the PR3 row and is NOT part of opus
    const opus = r.groups.find((g) => g.key.model === "claude-opus-4-8")!;
    const none = r.groups.find((g) => g.key.model === "— sem modelo —")!;
    expect(none.dispatches).toBe(1);
    expect(opus.dispatches).toBe(4); // 3 rows of t1 + 1 row of t4
  });

  test("derived notes spell out what is derived (integration + period)", () => {
    const r = computeReport(JOURNEYS, { groupBy: ["period"] });
    expect(r.honesty.derivedNotes.join(" ")).toContain("git");
    expect(r.honesty.derivedNotes.join(" ").toLowerCase()).toContain("período");
  });
});

describe("filters (combinable)", () => {
  test("filter by repo narrows the row set", () => {
    const r = computeReport(JOURNEYS, { filter: { repo: ["agentistics"] } });
    expect(r.totalDispatches).toBe(2);
    expect(r.overall.deliveries).toBe(1); // only t4 reached done in agentistics
  });

  test("persona filter is case-insensitive (jesse matches Jesse)", () => {
    const r = computeReport(JOURNEYS, { filter: { persona: ["jesse"] } });
    expect(r.totalDispatches).toBe(3); // all three t1 rows, incl the 'jesse' one
    expect(r.overall.deliveries).toBe(1);
  });

  test("status filter + period filter combine", () => {
    const r = computeReport(JOURNEYS, { filter: { status: ["merged"], since: "2026-08-01", until: "2026-08-01" } });
    expect(r.totalDispatches).toBe(1); // only the j-20260801 merged row
  });

  test("empty combination says 'nada aqui' (empty:true), does not throw", () => {
    const r = computeReport(JOURNEYS, { filter: { repo: ["does-not-exist"] } });
    expect(r.empty).toBe(true);
    expect(r.totalDispatches).toBe(0);
    expect(r.overall.deliveries).toBe(0);
    expect(r.groups).toEqual([]);
  });
});

describe("grouping", () => {
  test("group by repo yields one group per repo with its own metrics", () => {
    const r = computeReport(JOURNEYS, { groupBy: ["repo"] });
    const aipe = r.groups.find((g) => g.key.repo === "aipe")!;
    const agent = r.groups.find((g) => g.key.repo === "agentistics")!;
    expect(aipe.metrics.deliveries).toBe(2); // t1, t2
    expect(agent.metrics.deliveries).toBe(1); // t4
  });

  test("multi-dimension group by (repo + period) makes a composite key", () => {
    const r = computeReport(JOURNEYS, { groupBy: ["repo", "period"] });
    const g = r.groups.find((x) => x.key.repo === "aipe" && x.key.period === "2026-08-01");
    expect(g).toBeTruthy();
    expect(g!.metrics.deliveries).toBe(1); // t1 only, on that day
  });

  test("grouping by persona collapses case-duplicates into ONE canonical row (agrees with deliveries dedup)", () => {
    const r = computeReport(JOURNEYS, { groupBy: ["persona"] });
    const personaKeys = r.groups.map((g) => g.key.persona);
    // Jesse and jesse are ONE person → a single "Jesse" row, no separate "jesse"
    expect(personaKeys.filter((k) => k!.toLowerCase() === "jesse")).toEqual(["Jesse"]);
    const jesse = r.groups.find((g) => g.key.persona === "Jesse")!;
    expect(jesse.dispatches).toBe(3); // all three t1 rows, both spellings
    expect(jesse.metrics.deliveries).toBe(1); // the one unit, not double-counted
  });

  test("period grouping derives the date from the journey id", () => {
    const r = computeReport(JOURNEYS, { groupBy: ["period"] });
    expect(r.groups.map((g) => g.key.period)).toContain("2026-08-01");
  });
});

describe("publication (merged ≠ published) — consumes src/release, never re-derives", () => {
  test("a repo's provided publication state passes through, keyed by repo", () => {
    const r = computeReport(JOURNEYS, {
      publication: {
        aipe: { state: "published", latestReleaseTag: "v1.12.1", reason: "at latest tag" },
        agentistics: { state: "merged-unpublished", latestReleaseTag: "v0.9.0", reason: "2 commits beyond the tag" },
      },
    });
    expect(r.publication.aipe!.state).toBe("published");
    expect(r.publication.agentistics!.state).toBe("merged-unpublished");
  });

  test("a repo with rows but NO provided state is 'unknown' — not assumed published, not zero", () => {
    const r = computeReport(JOURNEYS, { publication: { aipe: { state: "published", latestReleaseTag: "v1", reason: "" } } });
    // agentistics has rows but no state provided → unknown, explicitly
    expect(r.publication.agentistics!.state).toBe("unknown");
    expect(r.publication.agentistics!.reason.toLowerCase()).toContain("não");
  });

  test("with no publication input at all, every repo is unknown (honest absence)", () => {
    const r = computeReport(JOURNEYS);
    expect(r.publication.aipe!.state).toBe("unknown");
    expect(r.publication.agentistics!.state).toBe("unknown");
  });
});

test("unparseable journey id falls into '— sem data —', never crashes period grouping", () => {
  const r = computeReport([{ id: "j-web-1", dispatches: [{ repo: "web", task: "x", specialist: "Ana", status: "merged", pr: "P" }] }], { groupBy: ["period"] });
  expect(r.groups[0]!.key.period).toBe("— sem data —");
});
