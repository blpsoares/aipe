import "./setup";
import { test, expect, afterEach } from "bun:test";
import { render, cleanup, fireEvent, act } from "@testing-library/preact";
import { CommandPalette, commands, cmdList, paletteOpen, closePalette } from "../components/CommandPalette";
import { snapshot, openWorkerName } from "../runtime/store";
import { currentPath, navigate } from "../runtime/router";
import { t } from "../runtime/i18n";

afterEach(() => {
  cleanup();
  closePalette();
  navigate("/");
  openWorkerName.value = null;
  snapshot.value = { ...snapshot.value, workers: [] };
  document.documentElement.removeAttribute("data-theme");
  location.hash = "";
});

test("commands() palette lists the 7 redesign screens (5 primary + 2 footer), order-sorted", () => {
  const list = commands();
  const goto = t("c_goto");
  // The IA: Agora / Quadro / Equipe / Histórico / Relatório (primary) + Glossário / Ajustes (footer).
  const expectedGoto = ["nav_now", "nav_board", "nav_team", "nav_history", "nav_report", "nav_guide", "nav_settings"].map(
    (k) => `${goto} ${t(k)}`,
  );
  const gotoLabels = list.filter((c) => c.g === t("g_views")).map((c) => c.label);
  expect(gotoLabels).toEqual(expectedGoto);

  // The old dead views are gone from the palette (folded into the 5 screens).
  expect(list.some((c) => c.label === `${goto} ${t("nav_toolbox")}`)).toBe(false);
  expect(list.some((c) => c.label.toLowerCase().includes("terminal"))).toBe(false);

  // Action commands still present.
  expect(list.find((c) => c.label === t("c_theme"))).toBeTruthy();
  // The dead "Write orientation spec" no-op was removed (interface-sweep finding):
  // the read-only console authors no specs, so it never presented a control that
  // did nothing.
  expect(list.find((c) => c.label === t("c_writespec"))).toBeFalsy();
});

test("cmdList(q) appends a worker entry per snapshot worker and filters case-insensitively", () => {
  snapshot.value = { ...snapshot.value, workers: [{ name: "Ana", repo: "app", package: "core" }] };
  const all = cmdList("");
  expect(all.some((c) => c.label === "Ana · app/core")).toBe(true);

  const filtered = cmdList("ANA");
  expect(filtered.length).toBe(1);
  expect(filtered[0]!.label).toBe("Ana · app/core");

  const none = cmdList("zzzz-no-match");
  expect(none.length).toBe(0);
});

test("⌘K / Ctrl+K toggles the palette open/closed", () => {
  render(<CommandPalette />);
  expect(paletteOpen.value).toBe(false);

  act(() => {
    fireEvent.keyDown(document, { key: "k", metaKey: true });
  });
  expect(paletteOpen.value).toBe(true);

  act(() => {
    fireEvent.keyDown(document, { key: "k", ctrlKey: true });
  });
  expect(paletteOpen.value).toBe(false);
});

test("Esc closes the open palette", () => {
  const { container } = render(<CommandPalette />);
  act(() => {
    fireEvent.keyDown(document, { key: "k", metaKey: true });
  });
  expect(paletteOpen.value).toBe(true);
  expect(container.querySelector(".palette")).toBeTruthy();

  act(() => {
    fireEvent.keyDown(document, { key: "Escape" });
  });
  expect(paletteOpen.value).toBe(false);
});

test("typing filters the rendered list; no match shows nomatch", () => {
  snapshot.value = { ...snapshot.value, workers: [{ name: "Ana", repo: "app", package: "core" }] };
  const { container } = render(<CommandPalette />);
  act(() => {
    fireEvent.keyDown(document, { key: "k", metaKey: true });
  });

  const input = container.querySelector("input")!;
  act(() => {
    fireEvent.input(input, { target: { value: "ana" } });
  });
  expect(container.textContent).toContain("Ana · app/core");
  expect(container.textContent).not.toContain(t("c_theme"));

  act(() => {
    fireEvent.input(input, { target: { value: "zzzz-nope" } });
  });
  expect(container.textContent).toContain(t("nomatch"));
});

test("ArrowDown moves selection and Enter runs the selected command (navigates)", () => {
  const { container } = render(<CommandPalette />);
  act(() => {
    fireEvent.keyDown(document, { key: "k", metaKey: true });
  });

  const input = container.querySelector("input")!;
  act(() => {
    fireEvent.input(input, { target: { value: t("nav_team") } });
  });

  // Only one goto match for "team" — Enter should navigate to /team.
  act(() => {
    fireEvent.keyDown(document, { key: "Enter" });
  });
  expect(currentPath.value).toBe("/team");
  // interface-sweep finding: the palette must dismiss after a goto/action, not linger.
  expect(paletteOpen.value).toBe(false);
});

test("clicking a goto command navigates AND closes the palette (interface-sweep finding)", () => {
  const { container } = render(<CommandPalette />);
  act(() => {
    fireEvent.keyDown(document, { key: "k", metaKey: true });
  });
  const input = container.querySelector("input")!;
  act(() => {
    fireEvent.input(input, { target: { value: t("nav_history") } });
  });
  const opt = [...container.querySelectorAll(".opt")].find((el) => el.textContent?.includes(t("nav_history")))!;
  act(() => {
    fireEvent.click(opt);
  });
  expect(currentPath.value).toBe("/history");
  expect(paletteOpen.value).toBe(false);
});

test("running the theme command closes the palette too (no action leaves it open)", () => {
  const { container } = render(<CommandPalette />);
  act(() => {
    fireEvent.keyDown(document, { key: "k", metaKey: true });
  });
  const input = container.querySelector("input")!;
  act(() => {
    fireEvent.input(input, { target: { value: t("c_theme") } });
  });
  act(() => {
    fireEvent.keyDown(document, { key: "Enter" });
  });
  expect(paletteOpen.value).toBe(false);
});

test("ArrowDown/ArrowUp clamp selection within list bounds", () => {
  snapshot.value = { ...snapshot.value, workers: [] };
  const { container } = render(<CommandPalette />);
  act(() => {
    fireEvent.keyDown(document, { key: "k", metaKey: true });
  });
  const input = container.querySelector("input")!;
  act(() => {
    fireEvent.input(input, { target: { value: t("nav_team") } });
  });

  // A single match: pressing ArrowDown repeatedly must not move past it.
  act(() => {
    fireEvent.keyDown(document, { key: "ArrowDown" });
  });
  act(() => {
    fireEvent.keyDown(document, { key: "ArrowDown" });
  });
  const sel = container.querySelectorAll(".opt.sel");
  expect(sel.length).toBe(1);
  expect(sel[0]!.textContent).toContain(t("nav_team"));

  act(() => {
    fireEvent.keyDown(document, { key: "ArrowUp" });
  });
  act(() => {
    fireEvent.keyDown(document, { key: "ArrowUp" });
  });
  const sel2 = container.querySelectorAll(".opt.sel");
  expect(sel2.length).toBe(1);
});

test("clicking a worker entry sets openWorkerName and closes the palette", () => {
  snapshot.value = { ...snapshot.value, workers: [{ name: "Ana", repo: "app", package: "core" }] };
  const { container } = render(<CommandPalette />);
  act(() => {
    fireEvent.keyDown(document, { key: "k", metaKey: true });
  });

  const input = container.querySelector("input")!;
  act(() => {
    fireEvent.input(input, { target: { value: "Ana" } });
  });

  const workerOpt = [...container.querySelectorAll(".opt")].find((el) => el.textContent?.includes("Ana"))!;
  act(() => {
    fireEvent.click(workerOpt);
  });

  expect(openWorkerName.value).toBe("Ana");
  expect(paletteOpen.value).toBe(false);
});

test("no terminal command is present anywhere in the rendered palette", () => {
  const { container } = render(<CommandPalette />);
  act(() => {
    fireEvent.keyDown(document, { key: "k", metaKey: true });
  });
  expect(container.textContent?.toLowerCase()).not.toContain("terminal");
});
