import "./setup";
import { test, expect, afterEach } from "bun:test";
import { render, cleanup } from "@testing-library/preact";
import { route } from "../views/overview.view";
import { snapshot, counts, dispatches, activity, applySnapshot } from "../runtime/store";
import { currentPath, navigate } from "../runtime/router";
import { setLang } from "../runtime/i18n";
import { loadFixture } from "./fixtures";

const OverviewView = route.component;
const EMPTY = snapshot.value;
const EMPTY_COUNTS = counts.value;

afterEach(() => {
  cleanup();
  snapshot.value = EMPTY;
  counts.value = EMPTY_COUNTS;
  dispatches.value = [];
  activity.value = [];
  setLang("en");
  navigate("/overview");
});

test("route contract: path/order/icon preserved", () => {
  expect(route.path).toBe("/overview");
  expect(route.nav).toEqual({ label: "nav_overview", icon: "◎", order: 0 });
});

test("hero warn: counts.escalated>0 with a matching escalated worker", () => {
  loadFixture();
  const { container } = render(<OverviewView />);
  const hero = container.querySelector(".hero")!;
  expect(hero.classList.contains("warn")).toBe(true);
  expect(hero.classList.contains("ok")).toBe(false);
  expect(hero.querySelector(".orb")!.textContent).toBe("⚠");
  expect(hero.querySelector("h2")!.textContent).toBe("1 escalation needs you");
  // fixture's escalated worker is Carla, in core/ui
  expect(hero.querySelector("p")!.textContent).toBe("Carla escalated a change on core/ui — review and approve the next wave.");
  expect(hero.querySelector(".cta button")!.textContent).toBe("Review escalation →");
});

test("hero warn fallback: escalated>0 but no worker has status escalated -> warn_p0", () => {
  loadFixture();
  // Flip the workers so none carries status "escalated" while counts still report one.
  snapshot.value = {
    ...snapshot.value,
    workers: snapshot.value.workers.map((w) => (w.status === "escalated" ? { ...w, status: "active" } : w)),
  };
  const { container } = render(<OverviewView />);
  const hero = container.querySelector(".hero")!;
  expect(hero.classList.contains("warn")).toBe(true);
  expect(hero.querySelector("p")!.textContent).toBe("A specialist raised an escalation — review it and approve the next wave.");
});

test("hero ok: counts.escalated===0", () => {
  loadFixture();
  snapshot.value = { ...snapshot.value, workers: snapshot.value.workers.map((w) => ({ ...w, status: w.status === "escalated" ? "active" : w.status })) };
  // counts is a derived signal set by applySnapshot from raw counts; override directly to simulate zero-escalation state.
  const prevCounts = counts.value;
  counts.value = { ...prevCounts, escalated: 0 };
  const { container } = render(<OverviewView />);
  const hero = container.querySelector(".hero")!;
  expect(hero.classList.contains("ok")).toBe(true);
  expect(hero.classList.contains("warn")).toBe(false);
  expect(hero.querySelector(".orb")!.textContent).toBe("✓");
  expect(hero.querySelector("h2")!.textContent).toBe("All systems nominal");
  expect(hero.querySelector("p")!.textContent).toBe("Every dispatch is progressing. Nothing is blocked.");
  expect(hero.querySelector(".cta button")!.textContent).toBe("View activity →");
  counts.value = prevCounts;
});

test("KpiRow: exactly 6 tiles in order hired/active/delivered/escalated/journeys/repos with classes", () => {
  loadFixture();
  const { container } = render(<OverviewView />);
  const tiles = [...container.querySelectorAll(".kpis .kpi")];
  expect(tiles.length).toBe(6);
  const expectedClasses: string[] = ["", "sky", "acc", "amber", "", ""];
  const expectedLabels: string[] = ["specialists", "active", "delivered", "escalated", "journeys", "repos"];
  tiles.forEach((tile, i) => {
    const cls = [...tile.classList].filter((c) => c !== "kpi").join(" ");
    expect(cls).toBe(expectedClasses[i]!);
    expect(tile.querySelector(".k")!.textContent).toBe(expectedLabels[i]!);
  });
  // values: fixture counts = hired 4, active 1, delivered 1, escalated 1, journeys 3, repos 2
  const nums = tiles.map((tile) => tile.querySelector(".n")!.textContent);
  expect(nums).toEqual(["4", "1", "1", "1", "3", "2"]);
});

test("MiniPipeline: 4 stages count dispatches by status", () => {
  loadFixture();
  const { container } = render(<OverviewView />);
  const cells = [...container.querySelectorAll(".card.pad")[0]!.querySelectorAll(".grid > div")];
  expect(cells.length).toBe(4);
  const labels = cells.map((c) => c.querySelector(".k")!.textContent);
  expect(labels).toEqual(["Dispatched", "Delivered", "Escalated", "Merged"]);
  // fixture dispatches: dispatched=1 (Ana), delivered=1 (Bruno), escalated=1 (Carla), merged=1 (Bruno)
  const nums = cells.map((c) => c.querySelector(".num")!.textContent);
  expect(nums).toEqual(["1", "1", "1", "1"]);
});

test("live activity feed limits to 5 events", () => {
  // Build a fixture-derived scenario with >5 activity events by loading many
  // successive dispatch snapshots (mirrors store.test.ts's activity cap test).
  applySnapshot({ ok: true, journeys: [] }, 0);
  for (let i = 0; i < 8; i++) {
    applySnapshot(
      { ok: true, journeys: [{ id: "j", dispatches: [{ repo: "a", specialist: "S" + i, status: "dispatched" }] }] },
      1000 + i,
    );
  }
  const { container } = render(<OverviewView />);
  const feed = container.querySelector(".card.pad:nth-of-type(2) .feed") || container.querySelectorAll(".feed")[0]!;
  expect(feed.querySelectorAll(".ev").length).toBe(5);
});

test("CTA click navigates: warn hero -> /activity, pipeline card -> /pipeline", () => {
  loadFixture();
  const { container } = render(<OverviewView />);
  currentPath.value = "/overview";
  (container.querySelector(".hero .cta button") as HTMLButtonElement).click();
  expect(currentPath.value).toBe("/activity");

  currentPath.value = "/overview";
  (container.querySelector(".card.pad .between button") as HTMLButtonElement).click();
  expect(currentPath.value).toBe("/pipeline");
});

test("ok hero CTA also navigates to /activity", () => {
  loadFixture();
  const prevCounts = counts.value;
  counts.value = { ...prevCounts, escalated: 0 };
  const { container } = render(<OverviewView />);
  currentPath.value = "/overview";
  (container.querySelector(".hero .cta button") as HTMLButtonElement).click();
  expect(currentPath.value).toBe("/activity");
  counts.value = prevCounts;
});
