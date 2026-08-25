import "./setup";
import { test, expect, afterEach } from "bun:test";
import { readFileSync } from "node:fs";
import { render, cleanup } from "@testing-library/preact";
import { Sidebar } from "../components/Sidebar";
import { collapsed } from "../runtime/ui";

const BASE_CSS = readFileSync(new URL("../styles/base.css", import.meta.url), "utf8");

afterEach(() => {
  cleanup();
  collapsed.value = false;
  document.querySelectorAll("style[data-test-css]").forEach((n) => n.remove());
});

function injectBaseCss() {
  const style = document.createElement("style");
  style.setAttribute("data-test-css", "1");
  style.textContent = BASE_CSS;
  document.head.appendChild(style);
}

// Regression guard for 5.1: the collapse rule must hide LABELS, never the icon.
// The whole point of collapsing is icon-only navigation, so an empty rail is a
// critical regression.

test("base.css collapse rule excludes the icon span (never hides .ic)", () => {
  // The buggy rule hid every span in .nav-i, including the icon (.ic).
  expect(BASE_CSS).toContain(".app.collapsed .nav-i span:not(.ic)");
  // The old, greedy form must be gone.
  expect(BASE_CSS).not.toMatch(/\.app\.collapsed \.nav-i span\s*,/);
  expect(BASE_CSS).not.toMatch(/\.app\.collapsed \.nav-i span\s*\{/);
});

test("a collapsed sidebar still renders an icon in every nav item", () => {
  collapsed.value = true;
  const { container } = render(
    <div class="app collapsed">
      <Sidebar />
    </div>,
  );
  const items = [...container.querySelectorAll(".nav-i")];
  expect(items.length).toBeGreaterThan(0);
  for (const it of items) {
    expect(it.querySelector(".ic")).not.toBeNull(); // an icon element is always present
  }
});

test("with base.css applied, the collapsed icon stays visible while its label is hidden", () => {
  injectBaseCss();
  collapsed.value = true;
  const { container } = render(
    <div class="app collapsed">
      <Sidebar />
    </div>,
  );
  const navItem = container.querySelector(".nav-i")!;
  const icon = navItem.querySelector(".ic") as HTMLElement;
  const label = navItem.querySelector("span:not(.ic)") as HTMLElement | null;
  // The icon is NOT display:none…
  expect(getComputedStyle(icon).display).not.toBe("none");
  // …while a label span, if present, IS hidden.
  if (label) expect(getComputedStyle(label).display).toBe("none");
});
