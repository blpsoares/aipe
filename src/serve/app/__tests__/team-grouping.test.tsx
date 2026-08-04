import "./setup";
import { test, expect, afterEach } from "bun:test";
import { render, cleanup, fireEvent } from "@testing-library/preact";
import { route } from "../views/team.view";
import { snapshot, openWorkerName } from "../runtime/store";
import { loadFixture } from "./fixtures";

const TeamView = route.component;
const EMPTY = snapshot.value;

afterEach(() => {
  cleanup();
  snapshot.value = EMPTY;
  openWorkerName.value = null;
});

// #4 — Team grouped by project / activity / specialty; the dead "+Dispatch"
// button is removed (the serve console is read-only by design).
test("no dead +Dispatch / All buttons anymore", () => {
  loadFixture();
  const { container } = render(<TeamView />);
  const btns = [...container.querySelectorAll("button")].map((b) => b.textContent);
  expect(btns).not.toContain("+ Dispatch");
  expect(btns).not.toContain("All");
});

test("group-by segmented control has project/activity/specialty", () => {
  loadFixture();
  const { container } = render(<TeamView />);
  const seg = container.querySelector(".team-groupby")!;
  expect(seg).not.toBeNull();
  const labels = [...seg.querySelectorAll("button")].map((b) => b.textContent);
  expect(labels).toEqual(["Project", "Activity", "Specialty"]);
});

test("default groups by project: a group per repo/package, all workers present", () => {
  loadFixture();
  const { container } = render(<TeamView />);
  const groupHeads = [...container.querySelectorAll(".team-group .eyebrow")].map((n) => n.textContent);
  // fixture: web (Ana, Diego), core/api (Bruno), core/ui (Carla)
  expect(groupHeads).toContain("web");
  expect(groupHeads).toContain("core/api");
  expect(groupHeads).toContain("core/ui");
  // every worker (minus coordinator) is still rendered exactly once
  expect(container.querySelectorAll(".cvcard").length).toBe(4);
});

test("switching to Specialty groups by role", () => {
  loadFixture();
  const { container } = render(<TeamView />);
  const specBtn = [...container.querySelectorAll(".team-groupby button")].find((b) => b.textContent === "Specialty")!;
  fireEvent.click(specBtn);
  const groupHeads = [...container.querySelectorAll(".team-group .eyebrow")].map((n) => n.textContent);
  // fixture roles: dev (Ana, Bruno, Diego), qa (Carla)
  expect(groupHeads).toContain("dev");
  expect(groupHeads).toContain("qa");
  expect(container.querySelectorAll(".cvcard").length).toBe(4);
});
