import { signal, type Signal } from "@preact/signals";

// ── Live specialist monitor store ───────────────────────────────────────────
// Ported from src/serve/app.html:1080-1154 (MON state, monPush reducer,
// monVisibleAgents/monHiddenCount selectors, monToggle, initMonitor).
//
// The monolith kept `MON.agents`/`MON.lanes` as plain Maps mutated in place,
// then called renderMonitor() imperatively. Preact signals compare by
// reference, so mutating a Map in place and reassigning the SAME reference to
// a signal would never notify subscribers. Rather than clone two Maps (which
// can hold many lanes of up to MON_MAX=200 events each) on every SSE tick, we
// keep the Maps as plain module state and expose a cheap `monVersion` counter
// signal that's bumped on every monPush — components read `monVersion.value`
// (plus `showAll.value`) to subscribe, then call the plain selector functions
// below to read current Map contents. This is the "version signal" option
// called out in the task brief.

export interface MonStreamEvent {
  kind?: string;
  agent: string;
  persona?: string;
  agentType?: string;
  active?: boolean;
  cmd?: string;
  tool?: string;
  text?: string;
  file?: string;
  [key: string]: unknown;
}

export interface MonAgentMeta {
  persona: string;
  agentType: string;
  active: boolean;
}

export interface MonLaneState {
  stream: MonStreamEvent[];
  files: MonStreamEvent[];
}

export const MON_MAX = 200;

const agents = new Map<string, MonAgentMeta>();
const lanes = new Map<string, MonLaneState>();

export const showAll: Signal<boolean> = signal(false);
export const monVersion: Signal<number> = signal(0);
export const monConnDown: Signal<boolean> = signal(false);

// app.html:1083
export function monLane(id: string): MonLaneState {
  let l = lanes.get(id);
  if (!l) {
    l = { stream: [], files: [] };
    lanes.set(id, l);
  }
  return l;
}

// app.html:1084
export function monMeta(id: string): MonAgentMeta {
  let m = agents.get(id);
  if (!m) {
    m = { persona: id, agentType: "", active: true };
    agents.set(id, m);
  }
  return m;
}

// app.html:1086 — a specialist earns a lane by default; the coordinator's
// exploratory helpers do not.
export function isSpecialist(m: MonAgentMeta): boolean {
  return (m.agentType || "") !== "Explore";
}

// app.html:1087-1091
export function monVisibleAgents(): string[] {
  const ids = [...agents.keys()].filter((id) => {
    const m = agents.get(id)!;
    if (!isSpecialist(m)) return showAll.value;
    return showAll.value || m.active;
  });
  // active first, then by label
  return ids.sort((a, b) => {
    const ma = agents.get(a)!;
    const mb = agents.get(b)!;
    if (ma.active !== mb.active) return ma.active ? -1 : 1;
    return String(ma.persona).localeCompare(String(mb.persona));
  });
}

// app.html:1092
export function monHiddenCount(): number {
  let n = 0;
  for (const [, m] of agents) if (isSpecialist(m) && !m.active) n++;
  return n;
}

export function monAgentCount(): number {
  return agents.size;
}

// app.html:1093-1104
export function monPush(ev: MonStreamEvent): void {
  if (ev.kind === "agent") {
    const m = monMeta(ev.agent);
    if (ev.persona) m.persona = ev.persona;
    if (ev.agentType !== undefined) m.agentType = ev.agentType;
    m.active = ev.active === true;
    monLane(ev.agent);
  } else {
    const m = monMeta(ev.agent);
    if (ev.persona) m.persona = ev.persona;
    if (ev.agentType !== undefined) m.agentType = ev.agentType;
    const l = monLane(ev.agent);
    if (ev.kind === "file") {
      l.files.push(ev);
      if (l.files.length > MON_MAX) l.files.shift();
    } else {
      l.stream.push(ev);
      if (l.stream.length > MON_MAX) l.stream.shift();
    }
  }
  monVersion.value++;
}

// app.html:1105-1112, extracted pure (last 100, unreversed).
export function monStreamEntries(lane: MonLaneState): MonStreamEvent[] {
  return lane.stream.slice(-100);
}

// app.html:1113-1117, extracted pure (last 100, most-recent-first).
export function monFileEntries(lane: MonLaneState): MonStreamEvent[] {
  return lane.files.slice(-100).reverse();
}

// app.html:1130
export function monToggle(): void {
  showAll.value = !showAll.value;
}

// ── SSE connection (app.html:1146-1154) ─────────────────────────────────────
// One shared EventSource for the whole session — navigating away from /monitor
// and back must NOT reopen it (the store is global and keeps accumulating
// regardless of which view is active).
let monEs: EventSource | null = null;

export function connectMonitorStream(ES: typeof EventSource = globalThis.EventSource): EventSource | null {
  if (monEs) return monEs;
  try {
    const es = new ES("api/monitor");
    es.addEventListener("monitor", (m: any) => {
      if (!m.data) return;
      let ev: MonStreamEvent;
      try {
        ev = JSON.parse(m.data);
      } catch {
        return;
      }
      monPush(ev);
    });
    es.onerror = () => {
      monConnDown.value = true;
    };
    monEs = es;
    return es;
  } catch {
    monConnDown.value = true;
    return null;
  }
}

// Test-only reset — clears the Maps/signals and the shared connection guard
// so each test starts from a clean MON state.
export function __resetMonitorStore(): void {
  agents.clear();
  lanes.clear();
  showAll.value = false;
  monVersion.value = 0;
  monConnDown.value = false;
  monEs = null;
}
