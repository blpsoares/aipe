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
  counts.value = { hired: 0, active: 0, delivered: 0, escalated: 0, idle: 0, journeys: 0, repos: 0 };
  navigate("/overview");
  document.documentElement.removeAttribute("data-theme");
  location.hash = "";
});

test("routes.generated.ts has all 8 view stubs, order-sorted, no terminal", () => {
  expect(appRoutes.map((r) => r.path)).toEqual([
    "/overview",
    "/org",
    "/pipeline",
    "/team",
    "/toolbox",
    "/activity",
    "/monitor",
    "/settings",
  ]);
  expect(appRoutes.some((r) => r.path === "/terminal")).toBe(false);
});

test("Sidebar renders one nav-i per route.nav, in nav.order — settings in the footer, not the main list", () => {
  const { container } = render(<Sidebar />);
  const mainLabels = [...container.querySelectorAll(".sidebar > .nav-i")].map((b) => b.textContent);
  const nonSettings = appRoutes.filter((r) => r.path !== "/settings");
  expect(mainLabels).toEqual(nonSettings.map((r) => r.nav.icon + t(r.nav.label)));
  // Settings lives in .sb-foot, alongside Collapse.
  const footButtons = [...container.querySelectorAll(".sb-foot > button")];
  expect(footButtons.length).toBe(2);
  expect(footButtons[0]!.textContent).toContain(t("nav_settings"));
  expect(container.querySelector("#collapseBtn")).toBeTruthy();
});

test("Sidebar marks the active route with .on", () => {
  navigate("/pipeline");
  const { container } = render(<Sidebar />);
  const on = container.querySelector(".nav-i.on");
  expect(on).toBeTruthy();
  expect(on!.textContent).toContain(t("nav_pipeline"));
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

test("BottomNav lists only overview/pipeline/team/activity/monitor, in that order", () => {
  const { container } = render(<BottomNav />);
  const labels = [...container.querySelectorAll("#tabbar button")].map((b) => b.textContent);
  const expected = ["overview", "pipeline", "team", "activity", "monitor"].map((p) => {
    const r = appRoutes.find((x) => x.path === "/" + p)!;
    return r.nav.icon + t(r.nav.label);
  });
  expect(labels).toEqual(expected);
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
  expect(container.querySelector(".nav-i")!.textContent).toContain("Overview");

  const langEl = render(<LangSwitch />).container;
  fireEvent.click(langEl.querySelector('[data-lang="pt"]')!);
  expect(lang.value).toBe("pt");

  // No rerender() call: @preact/signals re-renders the already-mounted Sidebar
  // because its render body reads t()/lang.value. If reactivity were broken this
  // assertion would fail (label would still read "Overview").
  expect(container.querySelector(".nav-i")!.textContent).toContain("Visão geral");
  expect(t("nav_overview")).toBe("Visão geral");
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
  expect(container.querySelector("#tbTitle")!.textContent).toBe(t("nav_overview"));

  location.hash = "#/monitor";
  window.dispatchEvent(new Event("hashchange"));
  expect(currentPath.value).toBe("/monitor");

  rerender(<Topbar />);
  expect(container.querySelector("#tbTitle")!.textContent).toBe(t("nav_monitor"));
});

test("navigate() persists to localStorage and mirrors into location.hash", () => {
  navigate("/toolbox");
  expect(localStorage.getItem("aipe-view")).toBe("toolbox");
  expect(location.hash).toBe("#/toolbox");
});

test("navigate() falls back to /overview for an unknown path", () => {
  navigate("/does-not-exist");
  expect(currentPath.value).toBe("/overview");
});

test("<App> switches the rendered #view content when navigate() changes the route", () => {
  navigate("/overview");
  const { container } = render(<App />);
  const view = container.querySelector("#view")!;
  expect(view).toBeTruthy();
  // Overview is a real view (Task 11): it renders a `.hero`, not the
  // `.view-h` stub heading. Pipeline is still a stub (no `.hero`/`.kpis`).
  expect(view.querySelector(".hero")).toBeTruthy();
  expect(view.querySelector(".kpis")).toBeTruthy();

  // act() flushes the signal-scheduled re-render (a bare navigate() only marks
  // the currentPath signal dirty; the batched re-render lands on the next tick).
  act(() => navigate("/pipeline"));

  // The view area actually re-rendered a different component — overview content
  // is gone, pipeline content is now mounted (not just currentPath/highlight).
  expect(view.querySelector(".hero")).toBeNull();
  expect(view.querySelector(".view-h")!.textContent).toBe(t("nav_pipeline"));
  expect(view.textContent).toContain(t("nav_pipeline"));
});
