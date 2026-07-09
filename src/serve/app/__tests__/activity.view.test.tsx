import "./setup";
import { test, expect, afterEach } from "bun:test";
import { render, cleanup } from "@testing-library/preact";
import { route } from "../views/activity.view";
import { snapshot, activity } from "../runtime/store";
import { setLang } from "../runtime/i18n";
import { loadFixture } from "./fixtures";

const ActivityView = route.component;
const EMPTY = snapshot.value;

afterEach(() => {
  cleanup();
  snapshot.value = EMPTY;
  activity.value = [];
  setLang("en");
});

test("route contract: path/order/icon/badge preserved", () => {
  expect(route.path).toBe("/activity");
  expect(route.nav).toEqual({ label: "nav_activity", icon: "⧗", order: 5, badge: "escalation" });
});

test("header: translated title/sub + static streaming indicator", () => {
  loadFixture();
  const { container } = render(<ActivityView />);
  expect(container.querySelector("h1.view-h")!.textContent).toBe("Activity");
  expect(container.querySelector(".sub")!.textContent).toBe("Every state change, live");
  const conn = container.querySelector(".conn")!;
  expect(conn.querySelector(".dot")).not.toBeNull();
  expect(conn.textContent).toBe("streaming");
});

test("full feed: renders one .ev row per activity event (not sliced to 5)", () => {
  activity.value = [
    { w: "Ana", status: "dispatched", m: "started", at: 1_700_000_000_000 },
    { w: "Bruno", status: "delivered", m: "shipped", at: 1_700_000_000_000 },
    { w: "Carla", status: "escalated", m: "blocked", at: 1_700_000_000_000 },
    { w: "Diego", status: "merged", m: "merged pr", at: 1_700_000_000_000 },
    { w: "Elis", status: "removed", m: "left", at: 1_700_000_000_000 },
    { w: "Fabio", status: "dispatched", m: "started again", at: 1_700_000_000_000 },
  ];
  const { container } = render(<ActivityView />);
  expect(container.querySelectorAll(".ev").length).toBe(6);
});

test("unknown status falls back to dot d-active (ActivityFeed behavior)", () => {
  activity.value = [{ w: "Zeta", status: "mystery-status", m: "did a thing", at: 1_700_000_000_000 }];
  const { container } = render(<ActivityView />);
  const dot = container.querySelector(".ev .d")!;
  expect(dot.classList.contains("d-active")).toBe(true);
});

test("empty activity: no .ev rows and no empty-state text", () => {
  activity.value = [];
  const { container } = render(<ActivityView />);
  expect(container.querySelectorAll(".ev").length).toBe(0);
  const card = container.querySelector(".card.pad")!;
  expect(card.textContent).toBe("");
});
