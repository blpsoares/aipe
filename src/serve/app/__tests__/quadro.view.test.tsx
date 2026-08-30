// The board (o quadro) is now its own primary screen with a dedicated route
// (j-20260830-sk), no longer a collapsible section folded into Agora. These tests
// assert the CONSEQUENCE the PE cares about — a person reaching the page SEES the
// board (its state columns and cards on screen), full-width, with no control to
// discover — not merely that a route object exists.
import "./setup";
import { test, expect, afterEach } from "bun:test";
import { render, cleanup } from "@testing-library/preact";
import { route } from "../views/quadro.view";
import { snapshot, applySnapshot } from "../runtime/store";
import { setLang, t } from "../runtime/i18n";
import { navigate } from "../runtime/router";
import { resetBoardConfig, BOARD_CONFIG_KEY, boardConfig, readConfig } from "../runtime/activity";
import { fixtureSnapshot, loadFixture } from "./fixtures";
import type { RawSnapshot } from "../runtime/store";

const QuadroView = route.component;
const EMPTY = snapshot.value;

afterEach(() => {
  cleanup();
  snapshot.value = EMPTY;
  setLang("en");
  navigate("/");
  resetBoardConfig();
});

test("route contract: Quadro is a primary screen at /board (its own page in the nav)", () => {
  expect(route.path).toBe("/board");
  expect(route.nav.label).toBe("nav_board");
  expect(route.nav.group).not.toBe("footer"); // primary, not a footer utility
  expect(typeof route.nav.order).toBe("number");
});

test("arriving at the board page, the board itself is on screen — columns and cards, no toggle to discover", () => {
  loadFixture();
  const { container } = render(<QuadroView />);
  // The consequence that matters: the board's state columns are rendered NOW.
  expect(container.querySelector(".aboard")).toBeTruthy();
  expect(container.querySelector(".acol")).toBeTruthy();
  // And there is NO collapse control gating the board (the "born hidden" defect).
  expect(container.querySelector(".board-toggle")).toBeNull();
});

test("the page heading names the board", () => {
  loadFixture();
  const { container } = render(<QuadroView />);
  expect(container.querySelector(".view-h")!.textContent).toBe(t("nav_board"));
});

test("the board page uses the full viewport width (view-wide, not the 1180px reading column)", () => {
  loadFixture();
  const { container } = render(<QuadroView />);
  // The container opts out of the centered .view-in max-width via .view-wide.
  const wrap = container.querySelector(".view-in.view-wide");
  expect(wrap).toBeTruthy();
});

test("the merge-truth Integrados column is still reachable here (no s9/r5 regression)", () => {
  const snap: RawSnapshot = {
    ...fixtureSnapshot,
    journeys: [
      {
        id: "j-1",
        dispatches: [
          { repo: "aipe", specialist: "Eli", task: "done-thing", branch: "b", worktree: "/wt", status: "verified", liveness: "landed", integrated: true },
        ] as unknown[],
      },
    ],
  } as RawSnapshot;
  applySnapshot(snap, 1_700_000_000_000);
  // show-completed reveals Integrados; drive the config directly (the control is the WorkBoard's).
  try { localStorage.removeItem(BOARD_CONFIG_KEY); } catch {}
  boardConfig.value = { ...readConfig(), showCompleted: true };
  const { container } = render(<QuadroView />);
  expect(container.querySelector(".bcol-integrated")).not.toBeNull();
  expect(container.querySelector(".bcol-integrated")!.textContent).toContain("Eli");
});
