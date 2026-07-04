import { expect, test } from "bun:test";
import { classifyKey, reduceNav, renderMenu, type NavState } from "../prompt";

const start: NavState = { index: 0, done: false, cancelled: false };

test("classifyKey maps arrows, enter, and cancel", () => {
  expect(classifyKey("\x1b[A")).toBe("up");
  expect(classifyKey("\x1b[B")).toBe("down");
  expect(classifyKey("k")).toBe("up");
  expect(classifyKey("j")).toBe("down");
  expect(classifyKey("\r")).toBe("enter");
  expect(classifyKey("\x03")).toBe("cancel");
  expect(classifyKey("x")).toBe("other");
});

test("reduceNav wraps around and marks done", () => {
  expect(reduceNav(start, "down", 3).index).toBe(1);
  expect(reduceNav(start, "up", 3).index).toBe(2); // wrap to last
  expect(reduceNav({ ...start, index: 2 }, "down", 3).index).toBe(0); // wrap to first
  expect(reduceNav(start, "enter", 3).done).toBe(true);
  const cancelled = reduceNav(start, "cancel", 3);
  expect(cancelled.done).toBe(true);
  expect(cancelled.cancelled).toBe(true);
});

test("renderMenu points at the selected row and tags disabled ones", () => {
  const menu = renderMenu("Pick:", [{ label: "Claude Code" }, { label: "Cursor", disabled: true }], 0);
  const lines = menu.split("\n");
  expect(lines[0]).toBe("Pick:");
  expect(lines[1]).toContain("❯ Claude Code");
  expect(lines[2]).toContain("Cursor  (coming soon)");
  expect(menu).toContain("Enter to select");
});
