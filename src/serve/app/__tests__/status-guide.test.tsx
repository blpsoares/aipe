import "./setup";
import { test, expect, afterEach } from "bun:test";
import { render, cleanup } from "@testing-library/preact";
import { Chip } from "../components/Chip";
import { StatusLegend } from "../components/StatusLegend";
import { StatusIcon } from "../components/StatusIcon";
import { setLang } from "../runtime/i18n";

afterEach(() => {
  cleanup();
  setLang("en");
});

test("Chip carries a plain-language tooltip + aria-label, keeps its text and class, and has an icon", () => {
  const { container } = render(<Chip status="verified" />);
  const chip = container.querySelector(".chip")!;
  // class + text contract preserved (icon is an SVG → no textContent)
  expect(chip.className).toBe("chip verified");
  expect(chip.textContent).toBe("verified");
  // accessible description
  expect(chip.getAttribute("title")).toContain("QA checked it against the diff");
  expect(chip.getAttribute("aria-label")).toContain("verified");
  expect(chip.querySelector("svg.sic")).toBeTruthy();
});

test("every status resolves an icon (no crash on unknown → fallback)", () => {
  for (const s of ["dispatched", "delivered", "verified", "failed", "escalated", "merged", "removed", "active", "available", "idle", "weird"]) {
    const { container } = render(<StatusIcon k={s} />);
    expect(container.querySelector("svg.sic")).toBeTruthy();
    cleanup();
  }
});

test("StatusLegend lists all six stages with plain-language descriptions", () => {
  const { container } = render(<StatusLegend />);
  const items = container.querySelectorAll(".legend-item");
  expect(items.length).toBe(6);
  const labels = [...items].map((i) => i.querySelector(".chip")!.textContent);
  expect(labels).toEqual(["dispatched", "delivered", "verified", "QA failed", "escalated", "merged"]);
  expect(container.querySelector(".legend-desc")!.textContent!.length).toBeGreaterThan(10);
  // each item has an icon
  expect(container.querySelectorAll(".legend-item svg.sic").length).toBe(6);
});
