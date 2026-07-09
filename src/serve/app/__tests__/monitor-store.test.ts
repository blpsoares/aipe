import "./setup";
import { test, expect, afterEach, beforeEach } from "bun:test";
import {
  monPush,
  monMeta,
  monLane,
  isSpecialist,
  monVisibleAgents,
  monHiddenCount,
  monToggle,
  monAgentCount,
  monStreamEntries,
  monFileEntries,
  showAll,
  monVersion,
  monConnDown,
  connectMonitorStream,
  MON_MAX,
  __resetMonitorStore,
  type MonStreamEvent,
} from "../runtime/monitor-store";

beforeEach(() => __resetMonitorStore());
afterEach(() => __resetMonitorStore());

test("monPush kind=agent: updates roster (persona/agentType/active) and ensures a lane", () => {
  monPush({ kind: "agent", agent: "a1", persona: "Ana", agentType: "Backend", active: true });
  const m = monMeta("a1");
  expect(m).toEqual({ persona: "Ana", agentType: "Backend", active: true });
  expect(monLane("a1")).toEqual({ stream: [], files: [] });
});

test("monPush kind=agent: active defaults false unless ev.active===true", () => {
  monPush({ kind: "agent", agent: "a1" });
  expect(monMeta("a1").active).toBe(false);
  monPush({ kind: "agent", agent: "a1", active: "yes" as any });
  expect(monMeta("a1").active).toBe(false);
});

test("monPush kind=agent: only overwrites persona/agentType when present", () => {
  monPush({ kind: "agent", agent: "a1", persona: "Ana", agentType: "Backend", active: true });
  monPush({ kind: "agent", agent: "a1", active: true });
  expect(monMeta("a1").persona).toBe("Ana");
  expect(monMeta("a1").agentType).toBe("Backend");
});

test("monPush kind=file: pushes to lane.files, not stream; refreshes persona/agentType if present", () => {
  monPush({ kind: "agent", agent: "a1", persona: "Ana", agentType: "Backend", active: true });
  monPush({ kind: "file", agent: "a1", persona: "Ana2", tool: "edit", file: "src/x.ts" });
  const l = monLane("a1");
  expect(l.files).toEqual([{ kind: "file", agent: "a1", persona: "Ana2", tool: "edit", file: "src/x.ts" }]);
  expect(l.stream).toEqual([]);
  expect(monMeta("a1").persona).toBe("Ana2");
});

test("monPush kind=tool (or any non-agent/file kind): pushes to lane.stream", () => {
  monPush({ kind: "tool", agent: "a1", cmd: "bun test" });
  monPush({ kind: "say", agent: "a1", text: "thinking" });
  const l = monLane("a1");
  expect(l.stream.length).toBe(2);
  expect(l.files).toEqual([]);
});

test("lane stream/files cap at MON_MAX, oldest shifted out", () => {
  for (let i = 0; i < MON_MAX + 5; i++) monPush({ kind: "tool", agent: "a1", cmd: `cmd${i}` });
  const l = monLane("a1");
  expect(l.stream.length).toBe(MON_MAX);
  expect(l.stream[0]!.cmd).toBe(`cmd5`);
  expect(l.stream[l.stream.length - 1]!.cmd).toBe(`cmd${MON_MAX + 4}`);

  for (let i = 0; i < MON_MAX + 3; i++) monPush({ kind: "file", agent: "a1", file: `f${i}.ts` });
  expect(l.files.length).toBe(MON_MAX);
  expect(l.files[0]!.file).toBe(`f3.ts`);
});

test("monPush bumps monVersion on every call", () => {
  expect(monVersion.value).toBe(0);
  monPush({ kind: "tool", agent: "a1", cmd: "x" });
  expect(monVersion.value).toBe(1);
  monPush({ kind: "file", agent: "a1", file: "y" });
  expect(monVersion.value).toBe(2);
});

test("isSpecialist: false only for agentType==='Explore'", () => {
  expect(isSpecialist({ persona: "x", agentType: "Explore", active: true })).toBe(false);
  expect(isSpecialist({ persona: "x", agentType: "Backend", active: true })).toBe(true);
  expect(isSpecialist({ persona: "x", agentType: "", active: true })).toBe(true);
});

test("monVisibleAgents: showAll=false shows only active specialists, hides Explore and inactive", () => {
  monPush({ kind: "agent", agent: "s1", persona: "Zed", agentType: "Backend", active: true });
  monPush({ kind: "agent", agent: "s2", persona: "Amy", agentType: "Backend", active: false });
  monPush({ kind: "agent", agent: "e1", persona: "Explorer", agentType: "Explore", active: true });
  expect(monVisibleAgents()).toEqual(["s1"]);
});

test("monVisibleAgents: showAll=true shows everyone (specialists and Explore, active and not)", () => {
  monPush({ kind: "agent", agent: "s1", persona: "Zed", agentType: "Backend", active: true });
  monPush({ kind: "agent", agent: "s2", persona: "Amy", agentType: "Backend", active: false });
  monPush({ kind: "agent", agent: "e1", persona: "Explorer", agentType: "Explore", active: true });
  showAll.value = true;
  const ids = monVisibleAgents();
  expect(ids.sort()).toEqual(["e1", "s1", "s2"].sort());
});

test("monVisibleAgents: sorted active-first, then persona localeCompare", () => {
  monPush({ kind: "agent", agent: "s1", persona: "Zed", agentType: "Backend", active: true });
  monPush({ kind: "agent", agent: "s2", persona: "Amy", agentType: "Backend", active: true });
  showAll.value = true;
  monPush({ kind: "agent", agent: "s3", persona: "Bea", agentType: "Backend", active: false });
  expect(monVisibleAgents()).toEqual(["s2", "s1", "s3"]);
});

test("monHiddenCount: counts inactive specialists only (not Explore)", () => {
  monPush({ kind: "agent", agent: "s1", persona: "Zed", agentType: "Backend", active: false });
  monPush({ kind: "agent", agent: "s2", persona: "Amy", agentType: "Backend", active: true });
  monPush({ kind: "agent", agent: "e1", persona: "Explorer", agentType: "Explore", active: false });
  expect(monHiddenCount()).toBe(1);
});

test("monToggle flips showAll", () => {
  expect(showAll.value).toBe(false);
  monToggle();
  expect(showAll.value).toBe(true);
  monToggle();
  expect(showAll.value).toBe(false);
});

test("monAgentCount reflects roster size", () => {
  expect(monAgentCount()).toBe(0);
  monPush({ kind: "agent", agent: "s1", persona: "Zed", agentType: "Backend", active: true });
  expect(monAgentCount()).toBe(1);
});

test("monStreamEntries: last 100, not reversed", () => {
  for (let i = 0; i < 105; i++) monPush({ kind: "tool", agent: "a1", cmd: `c${i}` });
  const entries = monStreamEntries(monLane("a1"));
  expect(entries.length).toBe(100);
  expect(entries[0]!.cmd).toBe("c5");
  expect(entries[99]!.cmd).toBe("c104");
});

test("monFileEntries: last 100, reversed (most recent first)", () => {
  for (let i = 0; i < 105; i++) monPush({ kind: "file", agent: "a1", file: `f${i}` });
  const entries = monFileEntries(monLane("a1"));
  expect(entries.length).toBe(100);
  expect(entries[0]!.file).toBe("f104");
  expect(entries[99]!.file).toBe("f5");
});

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

test("connectMonitorStream: connects once, feeds monPush off the named 'monitor' event", () => {
  const es = connectMonitorStream(FakeES as any) as unknown as FakeES;
  expect(es.url).toBe("api/monitor");
  const ev: MonStreamEvent = { kind: "agent", agent: "a1", persona: "Ana", agentType: "Backend", active: true };
  es.emit("monitor", JSON.stringify(ev));
  expect(monMeta("a1").persona).toBe("Ana");
});

test("connectMonitorStream: subsequent calls reuse the same connection (single shared EventSource)", () => {
  let constructed = 0;
  class CountingES extends FakeES {
    constructor(url: string) {
      super(url);
      constructed++;
    }
  }
  connectMonitorStream(CountingES as any);
  connectMonitorStream(CountingES as any);
  connectMonitorStream(CountingES as any);
  expect(constructed).toBe(1);
});

test("connectMonitorStream: onerror marks monConnDown", () => {
  const es = connectMonitorStream(FakeES as any) as unknown as FakeES;
  expect(monConnDown.value).toBe(false);
  es.onerror();
  expect(monConnDown.value).toBe(true);
});

test("connectMonitorStream: degrades to down if the constructor throws", () => {
  class ThrowingES {
    constructor() {
      throw new Error("boom");
    }
  }
  const es = connectMonitorStream(ThrowingES as any);
  expect(es).toBeNull();
  expect(monConnDown.value).toBe(true);
});
