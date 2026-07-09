import "./setup";
import { test, expect, afterEach } from "bun:test";
import { render, cleanup } from "@testing-library/preact";
import { route } from "../views/pipeline.view";
import { snapshot, counts, dispatches, openWorkerName } from "../runtime/store";
import { setLang } from "../runtime/i18n";
import { loadFixture } from "./fixtures";

const PipelineView = route.component;
const EMPTY = snapshot.value;
const EMPTY_COUNTS = counts.value;

afterEach(() => {
  cleanup();
  snapshot.value = EMPTY;
  counts.value = EMPTY_COUNTS;
  dispatches.value = [];
  openWorkerName.value = null;
  setLang("en");
});

test("route contract: path/order/icon preserved", () => {
  expect(route.path).toBe("/pipeline");
  expect(route.nav).toEqual({ label: "nav_pipeline", icon: "▦", order: 2 });
});

test("4 lanes in order dispatched/delivered/escalated/merged with correct counts", () => {
  loadFixture();
  const { container } = render(<PipelineView />);
  const lanes = [...container.querySelectorAll(".board .lane")];
  expect(lanes.length).toBe(4);
  const labels = lanes.map((l) => l.querySelector("h4")!.textContent!.replace(/\d+$/, ""));
  expect(labels).toEqual(["Dispatched", "Delivered", "Escalated", "Merged"]);
  // fixture dispatches: dispatched=1 (Ana), delivered=1 (Bruno), escalated=1 (Carla), merged=1 (Bruno)
  const counts_ = lanes.map((l) => l.querySelector("h4 .c")!.textContent);
  expect(counts_).toEqual(["1", "1", "1", "1"]);
});

test("lane dot colors: dispatched=sky, escalated=amber, delivered/merged=accent", () => {
  loadFixture();
  const { container } = render(<PipelineView />);
  const lanes = [...container.querySelectorAll(".board .lane")];
  const dots = lanes.map((l) => (l.querySelector("h4 .d") as HTMLElement).style.background);
  expect(dots).toEqual(["var(--sky)", "var(--accent)", "var(--amber)", "var(--accent)"]);
});

test("empty lane shows a placeholder dash", () => {
  loadFixture();
  // Remove all delivered dispatches so that lane is empty.
  dispatches.value = dispatches.value.filter((d) => d.status !== "delivered");
  const { container } = render(<PipelineView />);
  const lanes = [...container.querySelectorAll(".board .lane")];
  const deliveredLane = lanes[1]!;
  expect(deliveredLane.querySelector(".body .sub")!.textContent).toBe("—");
  expect(deliveredLane.querySelectorAll(".tk").length).toBe(0);
});

test("card click sets openWorkerName to the specialist", () => {
  loadFixture();
  const { container } = render(<PipelineView />);
  const card = container.querySelector(".tk") as HTMLElement;
  expect(card).toBeTruthy();
  card.click();
  expect(openWorkerName.value).toBe(card.querySelector(".who")!.textContent);
});

test("PR link present when d.pr, and clicking it stops propagation (does not open drawer)", () => {
  loadFixture();
  const { container } = render(<PipelineView />);
  // Bruno's delivered dispatch has a pr in the fixture.
  const deliveredLane = [...container.querySelectorAll(".board .lane")][1]!;
  const prLink = deliveredLane.querySelector(".tk a.link") as HTMLAnchorElement;
  expect(prLink).toBeTruthy();
  expect(prLink.textContent).toBe("PR ↗");
  expect(prLink.getAttribute("target")).toBe("_blank");
  expect(prLink.getAttribute("rel")).toBe("noreferrer");
  openWorkerName.value = null;
  prLink.click();
  expect(openWorkerName.value).toBe(null);
});

test("subtitle contains the hardcoded literal 2 (parity quirk) and dispatches.length", () => {
  loadFixture();
  const { container } = render(<PipelineView />);
  const sub = container.querySelector(".between .sub")!.textContent!;
  expect(sub).toContain("2");
  expect(sub).toContain(String(dispatches.value.length));
});

test("Filter button renders without a click handler wired (parity: non-functional)", () => {
  loadFixture();
  const { container } = render(<PipelineView />);
  const btn = [...container.querySelectorAll("button")].find((b) => b.textContent === "Filter");
  expect(btn).toBeTruthy();
});
