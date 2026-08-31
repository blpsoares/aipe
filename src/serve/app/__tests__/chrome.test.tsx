import "./setup";
import { test, expect, afterEach } from "bun:test";
import { render, cleanup, fireEvent, act } from "@testing-library/preact";
import { App } from "../main";
import { Sidebar } from "../components/Sidebar";
import { BottomNav } from "../components/BottomNav";
import { Topbar } from "../components/Topbar";
import { LangSwitch } from "../components/LangSwitch";
import { ThemeToggle } from "../components/ThemeToggle";
import { routes } from "../routes.generated";
import type { Route } from "../route-types";
import { lang, setLang, t } from "../runtime/i18n";
import { counts, snapshot } from "../runtime/store";
import { navigate, currentPath } from "../runtime/router";

const appRoutes = routes as Route[];

afterEach(() => {
  cleanup();
  setLang("en");
  counts.value = { hired: 0, active: 0, delivered: 0, escalated: 0, redirected: 0, idle: 0, journeys: 0, repos: 0 };
  navigate("/");
  document.documentElement.removeAttribute("data-theme");
  location.hash = "";
});

test("routes.generated.ts: 5 primary screens + 2 footer, order-sorted, Agora first, no terminal", () => {
  expect(appRoutes.map((r) => r.path)).toEqual([
    "/", // Agora — the landing (nav.order 0)
    "/board", // Quadro — the board's own page (j-20260830-sk)
    "/team", // Equipe
    "/history", // Histórico
    "/report", // Relatório (j-20260829-c8) — its own house in the aside
    "/guide", // Glossário (footer)
    "/settings", // Ajustes (footer)
  ]);
  // "/activity" is a redirect (→ /board), never a route of its own.
  expect(appRoutes.some((r) => r.path === "/activity")).toBe(false);
  expect(appRoutes.some((r) => r.path === "/terminal")).toBe(false);
});

test("Sidebar renders the primary nav in order; Glossary + Settings in the footer", () => {
  const { container } = render(<Sidebar />);
  const mainLabels = [...container.querySelectorAll(".sidebar > .nav-i")].map((b) => b.textContent);
  const primary = appRoutes.filter((r) => r.nav.group !== "footer");
  expect(mainLabels).toEqual(primary.map((r) => t(r.nav.label)));
  // Icons are inline SVGs now (5.2) — every nav item carries one with an accessible name.
  for (const btn of container.querySelectorAll(".sidebar > .nav-i")) {
    const svg = btn.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg!.getAttribute("aria-label")).toBeTruthy();
  }
  // Footer = Glossary + Settings + Collapse.
  const footButtons = [...container.querySelectorAll(".sb-foot > button")];
  expect(footButtons.length).toBe(3);
  expect(footButtons[0]!.textContent).toContain(t("nav_guide"));
  expect(footButtons[1]!.textContent).toContain(t("nav_settings"));
  expect(container.querySelector("#collapseBtn")).toBeTruthy();
});

test("Sidebar marks the active route with .on", () => {
  navigate("/team");
  const { container } = render(<Sidebar />);
  const on = container.querySelector(".nav-i.on");
  expect(on).toBeTruthy();
  expect(on!.textContent).toContain(t("nav_team"));
});

test("Sidebar shows the attention badge on Activity only when there is attention; crit when any critical", () => {
  snapshot.value = { ...snapshot.value, attention: [] };
  const { container, unmount } = render(<Sidebar />);
  expect(container.querySelector("#navBadge")).toBeNull();
  unmount();

  snapshot.value = {
    ...snapshot.value,
    attention: [
      { kind: "qa-failed", severity: "critical", unit: "a", specialist: "x", journey: "j", detail: "d" },
      { kind: "escalated", severity: "warning", unit: "b", specialist: "y", journey: "j", detail: "d" },
      { kind: "no-evidence", severity: "warning", unit: "c", specialist: "z", journey: "j", detail: "d" },
    ],
  };
  const { container: c2 } = render(<Sidebar />);
  const badge = c2.querySelector("#navBadge");
  expect(badge).toBeTruthy();
  expect(badge!.textContent).toBe("3");
  expect(badge!.classList.contains("crit")).toBe(true);
});

test("BottomNav lists the 5 primary screens (Agora / Quadro / Equipe / Histórico / Relatório), in order", () => {
  const { container } = render(<BottomNav />);
  const labels = [...container.querySelectorAll("#tabbar button")].map((b) => b.textContent);
  const expected = appRoutes.filter((r) => r.nav.group !== "footer").map((r) => t(r.nav.label));
  expect(labels).toEqual(expected);
  expect(labels).toEqual([t("nav_now"), t("nav_board"), t("nav_team"), t("nav_history"), t("nav_report")]);
});

test("BottomNav shows the attention dot on Activity only when there is attention", () => {
  snapshot.value = {
    ...snapshot.value,
    attention: [{ kind: "escalated", severity: "warning", unit: "b", specialist: "y", journey: "j", detail: "d" }],
  };
  const { container } = render(<BottomNav />);
  expect(container.querySelector("#tabbar .tbadge")).toBeTruthy();
});

test("LangSwitch reads the lang signal and calls setLang; Sidebar labels update reactively (no manual re-render)", () => {
  const { container } = render(<Sidebar />);
  const navLabels = () => [...container.querySelectorAll(".nav-i")].map((b) => b.textContent).join("|");
  expect(navLabels()).toContain("Now");

  const langEl = render(<LangSwitch />).container;
  fireEvent.click(langEl.querySelector('[data-lang="pt"]')!);
  expect(lang.value).toBe("pt");

  // No rerender() call: @preact/signals re-renders the already-mounted Sidebar
  // because its render body reads t()/lang.value. If reactivity were broken this
  // assertion would fail (the "Now" label would still read "Now").
  expect(navLabels()).toContain("Agora");
  expect(t("nav_now")).toBe("Agora");
});

test("LangSwitch marks the active language button", () => {
  const { container } = render(<LangSwitch />);
  expect(container.querySelector('[data-lang="en"]')!.classList.contains("on")).toBe(true);
  fireEvent.click(container.querySelector('[data-lang="pt"]')!);
  expect(container.querySelector('[data-lang="pt"]')!.classList.contains("on")).toBe(true);
  expect(container.querySelector('[data-lang="en"]')!.classList.contains("on")).toBe(false);
});

test("ThemeToggle cycles data-theme dark -> light -> auto -> dark", () => {
  const { container } = render(<ThemeToggle />);
  const btn = container.querySelector("#themeBtn")!;
  expect(document.documentElement.getAttribute("data-theme")).toBeNull();

  fireEvent.click(btn);
  expect(document.documentElement.getAttribute("data-theme")).toBe("dark");

  fireEvent.click(btn);
  expect(document.documentElement.getAttribute("data-theme")).toBe("light");

  fireEvent.click(btn);
  expect(document.documentElement.getAttribute("data-theme")).toBeNull();

  fireEvent.click(btn);
  expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
});

test("Topbar title reflects the current route, navigated by hash", () => {
  const { container, rerender } = render(<Topbar />);
  expect(container.querySelector("#tbTitle")!.textContent).toBe(t("nav_now"));

  location.hash = "#/team";
  window.dispatchEvent(new Event("hashchange"));
  expect(currentPath.value).toBe("/team");

  rerender(<Topbar />);
  expect(container.querySelector("#tbTitle")!.textContent).toBe(t("nav_team"));
});

test("navigate() persists to localStorage and mirrors into location.hash", () => {
  navigate("/team");
  expect(localStorage.getItem("aipe-view")).toBe("team");
  expect(location.hash).toBe("#/team");
});

test("navigate() falls back to Agora (/) for an unknown path", () => {
  navigate("/does-not-exist");
  expect(currentPath.value).toBe("/");
});

test("<App> clicking the old '#/activity' hash while already on /board keeps the board on screen (no desync to Agora)", () => {
  // Brief item 3 / gate blocker: the failure was NOT that the redirect function
  // is missing — hashTarget('#/activity') already returns '/board'. It was that
  // firing the real `hashchange` EVENT while ALREADY on /board left the URL and
  // the view disagreeing: the listener's `p !== currentPath.value` guard saw the
  // canonical target (/board) already equal to currentPath, skipped navigate(),
  // and the hash was stranded at '#/activity' — an inconsistent state on screen
  // (URL says activity, view/nav say board). This test exercises the real event,
  // not the pure hashTarget()/navigate() the router unit tests call directly.
  act(() => navigate("/board"));
  const { container } = render(<App />);
  const view = container.querySelector("#view")!;
  expect(view.querySelector(".aboard")).toBeTruthy(); // the board is on screen
  expect(view.querySelector(".zone-needs")).toBeNull(); // Agora is NOT on screen

  // The old link/bookmark is clicked while we are already sitting on /board.
  act(() => {
    location.hash = "#/activity";
    window.dispatchEvent(new Event("hashchange"));
  });

  // Consequence: the person still sees the board, and the URL was rewritten to
  // the canonical '#/board' — URL and view agree, no strand at '#/activity'.
  expect(currentPath.value).toBe("/board");
  expect(location.hash).toBe("#/board");
  expect(view.querySelector(".aboard")).toBeTruthy();
  expect(view.querySelector(".zone-needs")).toBeNull();
});

// #84, the other half: a popstate that lands on the ALREADY-current route (a
// real browser fires one for a raw `<a href="#/board">` clicked while already
// on /board — the previous test's hashchange-guard fix does nothing here,
// because the hash string never actually changes, so hashchange never even
// fires). preact-iso's LocationProvider (main.tsx) listens for popstate
// globally and recomputes its own internal route from
// `location.pathname + search` — always "/", since the server only answers
// GET / (see runtime/router.ts). Because the target equals the current route,
// currentPath.value never changes, so a fix that only remounts on a
// currentPath.value change never fires here — this is exactly the case
// runtime/router.ts's navEpoch/popstate listener covers.
test("#84: a same-route popstate does not strand the view on the Floor/Agora", () => {
  act(() => navigate("/board"));
  const { container } = render(<App />);
  const view = container.querySelector("#view")!;
  expect(view.querySelector(".aboard")).toBeTruthy();

  act(() => {
    window.dispatchEvent(new PopStateEvent("popstate"));
  });

  // currentPath/location.hash were never wrong — only the LocationProvider's
  // internal reducer state was. Both assertions must hold: the signal was
  // already fine, and now the DOM has to match it too.
  expect(currentPath.value).toBe("/board");
  expect(view.querySelector(".zone-needs")).toBeNull(); // did NOT fall back to Agora
  expect(view.querySelector(".aboard")).toBeTruthy();
});

test("<App> switches the rendered #view content when navigate() changes the route", () => {
  navigate("/");
  const { container } = render(<App />);
  const view = container.querySelector("#view")!;
  expect(view).toBeTruthy();
  // Agora renders its urgency zones (the "Needs you" zone) and its own heading.
  expect(view.querySelector(".zone-needs")).toBeTruthy();
  expect(view.querySelector(".view-h")!.textContent).toBe(t("nav_now"));

  // act() flushes the signal-scheduled re-render (a bare navigate() only marks
  // the currentPath signal dirty; the batched re-render lands on the next tick).
  act(() => navigate("/team"));

  // The view area actually re-rendered a different component — Agora's zones are
  // gone, Equipe's org section is now mounted (not just currentPath/highlight).
  expect(view.querySelector(".zone-needs")).toBeNull();
  expect(view.querySelector(".org-stage")).toBeTruthy();
  expect(view.querySelector(".view-h")!.textContent).toBe(t("nav_team"));
});
