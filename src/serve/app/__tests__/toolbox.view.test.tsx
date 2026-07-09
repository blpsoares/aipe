import "./setup";
import { test, expect, afterEach } from "bun:test";
import { render, cleanup } from "@testing-library/preact";
import { route } from "../views/toolbox.view";
import { snapshot } from "../runtime/store";
import { setLang } from "../runtime/i18n";
import { loadFixture } from "./fixtures";

const ToolboxView = route.component;
const EMPTY = snapshot.value;

afterEach(() => {
  cleanup();
  snapshot.value = EMPTY;
  setLang("en");
});

test("route contract: path/order/icon preserved", () => {
  expect(route.path).toBe("/toolbox");
  expect(route.nav).toEqual({ label: "nav_toolbox", icon: "⬡", order: 4 });
});

test("header: translated title/sub, no .between wrapper, no action buttons", () => {
  loadFixture();
  const { container } = render(<ToolboxView />);
  expect(container.querySelector("h1.view-h")!.textContent).toBe("Toolbox");
  expect(container.querySelector(".sub")!.textContent).toBe("Frameworks & MCP servers the team can reach for");
  expect(container.querySelector("h1.view-h")!.closest(".between")).toBeNull();
  expect(container.querySelectorAll(".view-in > .grid.cols-2 button").length).toBe(0);
});

test("two .card.pad in a .grid.cols-2, with translated eyebrows", () => {
  loadFixture();
  const { container } = render(<ToolboxView />);
  const cards = [...container.querySelectorAll(".grid.cols-2 .card.pad")];
  expect(cards.length).toBe(2);
  expect(cards[0]!.querySelector(".eyebrow")!.textContent).toBe("Skill packages");
  expect(cards[1]!.querySelector(".eyebrow")!.textContent).toBe("MCP servers");
});

test("skill rows: one per skill, showing name/when/repos joined", () => {
  loadFixture();
  const { container } = render(<ToolboxView />);
  const cards = [...container.querySelectorAll(".grid.cols-2 .card.pad")];
  const rows = [...cards[0]!.querySelectorAll(".between")];
  expect(rows.length).toBe(snapshot.value.toolbox.skills.length);
  const first = snapshot.value.toolbox.skills[0]!;
  expect(rows[0]!.querySelector("b")!.textContent).toBe(first.name);
  expect(rows[0]!.querySelector(".sub")!.textContent).toBe(first.when ?? "");
  expect(rows[0]!.querySelector(".tag")!.textContent).toBe(first.repos.join(", "));
});

test("mcp rows: one per mcp, chip always class 'chip idle' with scope as text", () => {
  loadFixture();
  const { container } = render(<ToolboxView />);
  const cards = [...container.querySelectorAll(".grid.cols-2 .card.pad")];
  const rows = [...cards[1]!.querySelectorAll(".between")];
  expect(rows.length).toBe(snapshot.value.toolbox.mcps.length);
  snapshot.value.toolbox.mcps.forEach((m, i) => {
    expect(rows[i]!.querySelector("b")!.textContent).toBe(m.name);
    const chip = rows[i]!.querySelector(".chip")!;
    expect(chip.className).toBe("chip idle");
    expect(chip.textContent).toBe(m.scope ?? "");
  });
});

test("row border-top style applied to every row including the first", () => {
  loadFixture();
  const { container } = render(<ToolboxView />);
  const rows = [...container.querySelectorAll(".grid.cols-2 .card.pad .between")];
  expect(rows.length).toBeGreaterThan(0);
  rows.forEach((r) => {
    // happy-dom mis-splits the "1px solid var(--line)" shorthand when a CSS
    // custom property is involved, so assert on the raw attribute value
    // rather than the parsed longhand (which real browsers handle fine).
    const styleAttr = (r as HTMLElement).getAttribute("style") || "";
    expect(styleAttr).toContain("border-top");
    expect(styleAttr).toContain("padding: 10px 0");
  });
});

test("empty skills/mcps: card renders only its eyebrow, zero rows, no empty-state text", () => {
  loadFixture();
  snapshot.value = { ...snapshot.value, toolbox: { skills: [], mcps: [] } };
  const { container } = render(<ToolboxView />);
  const cards = [...container.querySelectorAll(".grid.cols-2 .card.pad")];
  expect(cards[0]!.querySelectorAll(".between").length).toBe(0);
  expect(cards[0]!.textContent).toBe("Skill packages");
  expect(cards[1]!.querySelectorAll(".between").length).toBe(0);
  expect(cards[1]!.textContent).toBe("MCP servers");
});
