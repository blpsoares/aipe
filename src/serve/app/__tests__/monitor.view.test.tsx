import "./setup";
import { test, expect, afterEach, beforeEach } from "bun:test";
import { render, cleanup } from "@testing-library/preact";
import { route } from "../views/monitor.view";
import { monPush, showAll, __resetMonitorStore } from "../runtime/monitor-store";
import { setLang } from "../runtime/i18n";

const MonitorView = route.component;

class FakeES {
  onerror: any;
  listeners: Record<string, (m: any) => void> = {};
  constructor(public url: string) {}
  addEventListener(ev: string, fn: (m: any) => void) {
    this.listeners[ev] = fn;
  }
  emit(ev: string, data: string) {
    this.listeners[ev]?.({ data });
  }
}

beforeEach(() => {
  __resetMonitorStore();
  // avoid a real EventSource("api/monitor") attempt inside jsdom during mount
  (globalThis as any).EventSource = FakeES;
});

afterEach(() => {
  cleanup();
  __resetMonitorStore();
  setLang("en");
});

test("route contract: path/order/icon preserved", () => {
  expect(route.path).toBe("/monitor");
  expect(route.nav).toEqual({ label: "nav_monitor", icon: "◉", order: 6 });
});

test("header: translated title/sub + live conn badge", () => {
  const { container } = render(<MonitorView />);
  expect(container.querySelector("h1.view-h")!.textContent).toBe("Monitor");
  expect(container.querySelector(".sub")!.textContent).toBe("What each active specialist is doing, live — one lane per specialist");
  const conn = container.querySelector("#monConn")!;
  expect(conn.querySelector(".dot")).not.toBeNull();
  expect(conn.textContent).toBe("live");
});

test("empty state: no agents at all -> no toolbar, mon_empty text, no hidden link", () => {
  const { container } = render(<MonitorView />);
  expect(container.querySelector(".mon-toolbar")).toBeNull();
  const empty = container.querySelector(".mon-empty")!;
  expect(empty.textContent).toContain("No specialist is active right now.");
  expect(empty.querySelector("a")).toBeNull();
});

test("with active specialists: toolbar + one lane per visible agent", () => {
  monPush({ kind: "agent", agent: "s1", persona: "Ana", agentType: "Backend", active: true });
  monPush({ kind: "agent", agent: "s2", persona: "Bea", agentType: "Frontend", active: true });
  const { container } = render(<MonitorView />);
  expect(container.querySelector(".mon-toolbar")).not.toBeNull();
  expect(container.querySelectorAll(".mon-lane").length).toBe(2);
});

test("toolbar active-only chip is 'on' by default; clicking 'all' reveals showAll and flips chip state", () => {
  monPush({ kind: "agent", agent: "s1", persona: "Ana", agentType: "Backend", active: true });
  const { container } = render(<MonitorView />);
  const [activeOnly, all] = container.querySelectorAll(".mon-chip");
  expect(activeOnly!.classList.contains("on")).toBe(true);
  expect(all!.classList.contains("on")).toBe(false);
  (all as HTMLButtonElement).click();
  expect(showAll.value).toBe(true);
});

test("tool event renders a .mon-line.tool with $cmd body; reasoning renders .mon-line.say", () => {
  monPush({ kind: "agent", agent: "s1", persona: "Ana", agentType: "Backend", active: true });
  monPush({ kind: "tool", agent: "s1", cmd: "bun test" });
  monPush({ kind: "say", agent: "s1", text: "thinking about it" });
  const { container } = render(<MonitorView />);
  const lines = container.querySelectorAll(".mon-line");
  expect(lines.length).toBe(2);
  expect(lines[0]!.classList.contains("tool")).toBe(true);
  expect(lines[0]!.querySelector(".mtx")!.textContent).toBe("$ bun test");
  expect(lines[1]!.classList.contains("say")).toBe(true);
  expect(lines[1]!.querySelector(".mtx")!.textContent).toBe("thinking about it");
});

test("files render reversed (most recent first)", () => {
  monPush({ kind: "agent", agent: "s1", persona: "Ana", agentType: "Backend", active: true });
  monPush({ kind: "file", agent: "s1", tool: "edit", file: "a.ts" });
  monPush({ kind: "file", agent: "s1", tool: "write", file: "b.ts" });
  const { container } = render(<MonitorView />);
  const files = container.querySelectorAll(".mon-file");
  expect(files.length).toBe(2);
  expect(files[0]!.querySelector(".fp2")!.textContent).toBe("b.ts");
  expect(files[1]!.querySelector(".fp2")!.textContent).toBe("a.ts");
});

test("hidden link appears when specialists are inactive and showAll is off, navigating toggles it", () => {
  monPush({ kind: "agent", agent: "s1", persona: "Ana", agentType: "Backend", active: false });
  const { container } = render(<MonitorView />);
  expect(container.querySelectorAll(".mon-lane").length).toBe(0);
  const link = container.querySelector(".mon-empty a")!;
  expect(link.textContent).toBe("1 finished — show all");
  (link as HTMLAnchorElement).click();
  expect(showAll.value).toBe(true);
});

test("idle lane gets .idle class and 'idle' live label; active lane doesn't", () => {
  monPush({ kind: "agent", agent: "s1", persona: "Ana", agentType: "Backend", active: true });
  showAll.value = true;
  monPush({ kind: "agent", agent: "s2", persona: "Bea", agentType: "Backend", active: false });
  const { container } = render(<MonitorView />);
  const lanes = container.querySelectorAll(".mon-lane");
  expect(lanes[0]!.classList.contains("idle")).toBe(false);
  expect(lanes[0]!.querySelector(".mon-live")!.textContent).toContain("active");
  expect(lanes[1]!.classList.contains("idle")).toBe(true);
  expect(lanes[1]!.querySelector(".mon-live")!.textContent).toContain("idle");
});

test("Explore agentType is hidden from the roster unless showAll", () => {
  monPush({ kind: "agent", agent: "e1", persona: "Explorer", agentType: "Explore", active: true });
  const { container } = render(<MonitorView />);
  expect(container.querySelectorAll(".mon-lane").length).toBe(0);
});
