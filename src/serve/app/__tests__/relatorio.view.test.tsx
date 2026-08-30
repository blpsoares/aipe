import "./setup";
import { test, expect, afterEach } from "bun:test";
import { render, cleanup, fireEvent } from "@testing-library/preact";
import { route } from "../views/relatorio.view";
import { snapshot, applySnapshot, type RawSnapshot } from "../runtime/store";
import { setLang, t, interpolate } from "../runtime/i18n";
import { navigate } from "../runtime/router";

const RelatorioView = route.component;
const EMPTY = snapshot.value;

// A messy slice: a unit delivered across 3 rows (double-count trap), a persona
// case duplicate (Ken/ken), a legacy row with no envelope, and a still-open PR.
const RAW: RawSnapshot = {
  ok: true,
  journeys: [
    {
      id: "j-20260801-aa",
      dispatches: [
        { repo: "aipe", task: "t1", specialist: "Ken", status: "delivered", pr: "PR1", model: "claude-opus-4-8" },
        { repo: "aipe", task: "t1", specialist: "ken", status: "merged", pr: "PR1", model: "claude-opus-4-8" },
      ],
    },
    {
      id: "j-20260802-bb",
      dispatches: [{ repo: "core", task: "t2", specialist: "Ana", status: "dispatched", pr: "PR2" }],
    },
  ],
};

afterEach(() => {
  cleanup();
  snapshot.value = EMPTY;
  setLang("en");
  navigate("/");
});

test("route contract: Report is a primary nav screen (/report), not in the footer", () => {
  expect(route.path).toBe("/report");
  expect(route.nav.label).toBe("nav_report");
  expect(route.nav.group).toBeUndefined();
});

test("heading + governing-question subtitle (comprehension: what is this screen)", () => {
  applySnapshot(RAW, 1);
  const { container } = render(<RelatorioView />);
  expect(container.querySelector(".view-h")!.textContent).toBe(t("nav_report"));
  expect(container.textContent).toContain(t("rep_sub"));
});

test("each metric shows its number AND the question it answers (no number without a question)", () => {
  applySnapshot(RAW, 1);
  const { container } = render(<RelatorioView />);
  const txt = container.textContent!;
  // deliveries = 1 (the 3-row unit counts once), and the question is on screen
  expect(txt).toContain(t("rep_q_deliveries"));
  expect(txt).toContain(t("rep_q_merged"));
  const tiles = container.querySelectorAll(".metric-tile");
  expect(tiles.length).toBeGreaterThanOrEqual(4);
});

test("delivery count does not double-count the unit spread across rows", () => {
  applySnapshot(RAW, 1);
  const { container } = render(<RelatorioView />);
  const del = container.querySelector('[data-metric="deliveries"] .mt-n')!;
  expect(del.textContent).toBe("1");
});

test("honesty: persona duplicates are surfaced (Ken/ken as one person)", () => {
  applySnapshot(RAW, 1);
  const { container } = render(<RelatorioView />);
  const honesty = container.querySelector(".rep-honesty")!;
  expect(honesty.textContent).toContain("Ken");
  expect(honesty.textContent).toContain("ken");
});

test("honesty: no-envelope records are reported as absence, not zero", () => {
  applySnapshot(RAW, 1);
  const { container } = render(<RelatorioView />);
  const honesty = container.querySelector(".rep-honesty")!;
  expect(honesty.textContent).toContain(interpolate(t("rep_h_noenv"), { n: 1 }));
});

test("grouping by repo renders one row per repo", () => {
  applySnapshot(RAW, 1);
  const { container, getByText } = render(<RelatorioView />);
  fireEvent.click(getByText(t("rep_by_repo")));
  const rows = container.querySelectorAll(".rep-grow");
  const labels = [...rows].map((r) => r.textContent);
  expect(labels.some((l) => l!.includes("aipe"))).toBe(true);
  expect(labels.some((l) => l!.includes("core"))).toBe(true);
});

test("empty snapshot says 'nada aqui', does not crash", () => {
  applySnapshot({ ok: true, journeys: [] }, 1);
  const { container } = render(<RelatorioView />);
  expect(container.textContent).toContain(t("rep_empty"));
});

// ── v2: filters, activity chart, publication ────────────────────────────────

test("filters combine: persona + status narrow the metrics together", () => {
  applySnapshot(RAW, 1);
  const { container } = render(<RelatorioView />);
  const sel = () => container.querySelectorAll(".rep-filters select");
  // Filter to Ken → only the aipe unit (1 delivery)
  fireEvent.change(sel()[0]!, { target: { value: "Ken" } });
  expect(container.querySelector('[data-metric="deliveries"] .mt-n')!.textContent).toBe("1");
  // Add status=dispatched → Ken has no dispatched row → the COMBINED slice is
  // empty, and the honest empty state shows (not a fabricated zero tile).
  fireEvent.change(sel()[1]!, { target: { value: "dispatched" } });
  expect(container.querySelector('[data-metric="deliveries"]')).toBeNull();
  expect(container.textContent).toContain(t("rep_empty"));
});

test("activity chart renders one bar per day with activity, labelled — no bar for an empty day", () => {
  applySnapshot(RAW, 1);
  const { container } = render(<RelatorioView />);
  const bars = container.querySelectorAll(".rep-bar-col");
  // Two journeys on two distinct days → two bars
  expect(bars.length).toBe(2);
  const labels = [...bars].map((b) => b.querySelector(".rep-bar-lbl")!.textContent);
  expect(labels).toContain("08-01");
  expect(labels).toContain("08-02");
});

test("publication is consumed from the payload; 'checking' shows as verifying, not a false state", () => {
  applySnapshot(
    { ...RAW, publication: { aipe: { state: "merged-unpublished", latestReleaseTag: "v1.5.0", reason: "6 commits beyond" }, core: { state: "checking", latestReleaseTag: null, reason: "verificando…" } } },
    1,
  );
  const { container } = render(<RelatorioView />);
  const chips = container.querySelectorAll(".rep-pub-chip");
  const txt = [...chips].map((c) => c.textContent).join(" | ");
  expect(txt).toContain(t("rep_pub_merged"));
  expect(txt).toContain(t("rep_pub_checking"));
  // the checking repo carries the dashed 'checking' chip, not an established state
  expect(container.querySelector(".rep-pub-chip.is-checking")).toBeTruthy();
  expect(container.querySelector(".rep-pub-chip.is-merged")).toBeTruthy();
  // nothing is falsely 'published' in this slice
  expect(container.querySelector(".rep-pub-chip.is-pub")).toBeNull();
});
