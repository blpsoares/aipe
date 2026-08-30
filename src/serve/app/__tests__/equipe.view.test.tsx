import "./setup";
import { test, expect, afterEach } from "bun:test";
import { render, cleanup, fireEvent } from "@testing-library/preact";
import { route } from "../views/equipe.view";
import { snapshot, openWorkerName } from "../runtime/store";
import { orgQuery, orgTransform } from "../runtime/org";
import { setLang, t } from "../runtime/i18n";
import { navigate } from "../runtime/router";
import { loadFixture } from "./fixtures";

const EquipeView = route.component;
const EMPTY = snapshot.value;

afterEach(() => {
  cleanup();
  snapshot.value = EMPTY;
  orgQuery.value = "";
  orgTransform.value = { s: 1, x: 0, y: 0 };
  openWorkerName.value = null;
  setLang("en");
  navigate("/");
});

test("route contract: Equipe at /team, order 2 (after Agora and the board's own page)", () => {
  expect(route.path).toBe("/team");
  expect(route.nav.label).toBe("nav_team");
  expect(route.nav.order).toBe(2);
});

test("one screen consolidates org chart + roster + toolbox (decision B)", () => {
  loadFixture();
  const { container } = render(<EquipeView />);
  expect(container.querySelector(".view-h")!.textContent).toBe(t("nav_team"));
  // Org section (with its fit-aware chart) + toolbar with 4 controls.
  expect(container.querySelector(".org-stage")).toBeTruthy();
  expect(container.querySelectorAll(".org-ctrls button").length).toBe(4);
  // Roster: a card per hired specialist (coordinator filtered out upstream).
  const names = [...container.querySelectorAll(".cvcard .cvname")].map((n) => n.textContent);
  expect(names.sort()).toEqual(["Ana", "Bruno", "Carla", "Diego"]);
  // Toolbox as a capability section — the team's skills.
  expect(container.textContent).toContain(t("team_sec_toolbox"));
  expect(container.textContent).toContain("test-driven-development");
});

test("org reset button re-frames (degenerate viewport in the test DOM → identity)", () => {
  loadFixture();
  orgTransform.value = { s: 2.4, x: 30, y: 40 };
  const { container } = render(<EquipeView />);
  const reset = [...container.querySelectorAll(".org-ctrls button")][2] as HTMLButtonElement;
  reset.click();
  // The wrap has no layout in happy-dom (0×0) → fit collapses to identity; the
  // point is that reset went through fitToView, not a blind reset. Real re-frame
  // math is covered in org.test.ts.
  expect(orgTransform.value).toEqual({ s: 1, x: 0, y: 0 });
});

test("clicking a specialist node in the org chart opens their drawer", () => {
  loadFixture();
  const { container } = render(<EquipeView />);
  const node = [...container.querySelectorAll('.orgwrap svg .onode[role="button"]')].find((g) =>
    (g.getAttribute("aria-label") || "").startsWith("Ana "),
  )!;
  fireEvent.click(node);
  expect(openWorkerName.value).toBe("Ana");
});

test("pointerdown on a clickable specialist node does NOT start a pan", () => {
  loadFixture();
  const { container } = render(<EquipeView />);
  const node = [...container.querySelectorAll('.orgwrap svg .onode[role="button"]')].find((g) =>
    (g.getAttribute("aria-label") || "").startsWith("Ana "),
  )!;
  const before = orgTransform.value;
  fireEvent.pointerDown(node, { clientX: 50, clientY: 50, pointerId: 1 });
  fireEvent.pointerMove(container.querySelector(".orgwrap")!, { clientX: 90, clientY: 90, pointerId: 1 });
  expect(orgTransform.value).toBe(before);
});
