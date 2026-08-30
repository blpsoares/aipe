import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type CoordinatorEntry,
  claimCoordinator,
  coordinatorsDir,
  entryKey,
  isEntryLive,
  livenessOf,
  liveCoordinators,
  parseCoordinatorEntry,
  releaseCoordinator,
  renderCoordinatorAwareness,
} from "../coordinator";

let ws: string;
beforeEach(async () => {
  ws = await mkdtemp(join(tmpdir(), "aipe-coord-"));
});
afterEach(async () => {
  await rm(ws, { recursive: true, force: true });
});

const alive = (_pid: number) => true;
const dead = (_pid: number) => false;
const NOW = "2026-08-29T12:00:00.000Z";

// ── parse ────────────────────────────────────────────────────────────────────
test("parseCoordinatorEntry accepts a well-formed record and rejects junk", () => {
  const raw = `name: Heisenberg\nsessionName: COORDENADOR\npid: 4242\nclaimedAt: ${NOW}\n`;
  expect(parseCoordinatorEntry(raw)).toEqual({
    name: "Heisenberg",
    sessionName: "COORDENADOR",
    pid: 4242,
    claimedAt: NOW,
  });
  expect(parseCoordinatorEntry("not: [valid")).toBeNull(); // malformed yaml
  expect(parseCoordinatorEntry("sessionName: x")).toBeNull(); // no name
});

test("parseCoordinatorEntry defaults a missing/invalid pid to 0 (unverifiable) and tolerates no sessionName", () => {
  const e = parseCoordinatorEntry(`name: Gus\nclaimedAt: ${NOW}\n`);
  expect(e).toEqual({ name: "Gus", sessionName: "", pid: 0, claimedAt: NOW });
});

// ── liveness: the safe-inverse principle (items 3 & 5) ────────────────────────
test("a verifiable pid decides liveness; a dead pid is dead", () => {
  const e: CoordinatorEntry = { name: "H", sessionName: "C", pid: 10, claimedAt: NOW };
  expect(livenessOf(e, alive)).toBe("alive");
  expect(livenessOf(e, dead)).toBe("dead");
});

test("an unverifiable owner (pid 0) is UNVERIFIABLE and treated as LIVE, never silently dead", () => {
  const e: CoordinatorEntry = { name: "H", sessionName: "C", pid: 0, claimedAt: NOW };
  expect(livenessOf(e, dead)).toBe("unverifiable");
  // the whole point: on doubt we keep it, so a rival warns instead of stomping.
  expect(isEntryLive(e, dead)).toBe(true);
});

test("entryKey is the pid when verifiable, else the session name, so one session owns one entry", () => {
  expect(entryKey({ name: "H", sessionName: "C", pid: 7, claimedAt: NOW })).toBe("pid-7");
  expect(entryKey({ name: "H", sessionName: "COORDENADOR", pid: 0, claimedAt: NOW })).toBe("name-COORDENADOR");
  expect(entryKey({ name: "Heisenberg", sessionName: "", pid: 0, claimedAt: NOW })).toBe("name-Heisenberg");
});

// ── claim + detection ─────────────────────────────────────────────────────────
test("claimCoordinator registers this session and reports no other coordinator on an empty workspace", async () => {
  const res = await claimCoordinator(ws, {
    name: "Heisenberg",
    sessionName: "COORDENADOR",
    pid: 111,
    now: () => NOW,
    isAlive: alive,
  });
  expect(res.mine.name).toBe("Heisenberg");
  expect(res.others).toHaveLength(0);
  expect(res.reconnected).toBe(false);
  const files = await readdir(coordinatorsDir(ws));
  expect(files).toHaveLength(1);
});

test("a SECOND live coordinator is detected — with who and since when (item 3)", async () => {
  await claimCoordinator(ws, {
    name: "Heisenberg",
    sessionName: "COORDENADOR",
    pid: 111,
    now: () => "2026-08-29T09:00:00.000Z",
    isAlive: alive,
  });
  const second = await claimCoordinator(ws, {
    name: "Gus",
    sessionName: "COORD-2",
    pid: 222,
    now: () => "2026-08-29T10:00:00.000Z",
    isAlive: alive,
  });
  expect(second.others.map((o) => o.name)).toEqual(["Heisenberg"]);
  expect(second.others[0]!.claimedAt).toBe("2026-08-29T09:00:00.000Z");
});

test("re-claiming from the same session updates in place and preserves the original claimedAt (since-when is stable)", async () => {
  await claimCoordinator(ws, { name: "H", sessionName: "C", pid: 111, now: () => "2026-08-29T09:00:00.000Z", isAlive: alive });
  const again = await claimCoordinator(ws, { name: "H", sessionName: "C", pid: 111, now: () => "2026-08-29T11:00:00.000Z", isAlive: alive });
  expect(again.others).toHaveLength(0);
  expect(again.mine.claimedAt).toBe("2026-08-29T09:00:00.000Z"); // not moved forward
  expect(await readdir(coordinatorsDir(ws))).toHaveLength(1);
});

test("a coordinator that DIED without releasing does not block the next — its entry is reconciled away (item: orphan)", async () => {
  await claimCoordinator(ws, { name: "Dead", sessionName: "OLD", pid: 999, now: () => "2026-08-29T08:00:00.000Z", isAlive: alive });
  // new session opens; the old pid is now dead
  const isAlive = (pid: number) => pid === 222;
  const res = await claimCoordinator(ws, { name: "New", sessionName: "OLD", pid: 222, now: () => NOW, isAlive });
  expect(res.others).toHaveLength(0); // the dead one was pruned, not warned about
  expect(res.reconnected).toBe(true); // adopted the registered identity name "OLD"
  // only the live entry survives on disk
  const live = await liveCoordinators(ws, isAlive);
  expect(live.map((e) => e.name)).toEqual(["New"]);
});

test("an UNVERIFIABLE prior owner (pid 0) is NOT pruned — a possible coordinator is kept and warned about, never silently dropped", async () => {
  await writeFile(
    join(coordinatorsDir(ws), "name-COORDENADOR.yaml"),
    `name: Ghost\nsessionName: COORDENADOR\npid: 0\nclaimedAt: 2026-08-29T08:00:00.000Z\n`,
  ).catch(async () => {
    // dir may not exist yet
    const { mkdir } = await import("node:fs/promises");
    await mkdir(coordinatorsDir(ws), { recursive: true });
    await writeFile(
      join(coordinatorsDir(ws), "name-COORDENADOR.yaml"),
      `name: Ghost\nsessionName: COORDENADOR\npid: 0\nclaimedAt: 2026-08-29T08:00:00.000Z\n`,
    );
  });
  const res = await claimCoordinator(ws, { name: "New", sessionName: "OTHER", pid: 222, now: () => NOW, isAlive: (p) => p === 222 });
  expect(res.others.map((o) => o.name)).toEqual(["Ghost"]); // kept + surfaced
});

// ── awareness rendering (actionable, item 3 & 1) ──────────────────────────────
test("renderCoordinatorAwareness names who else is active, since when, and what to do", () => {
  const mine: CoordinatorEntry = { name: "Gus", sessionName: "COORD-2", pid: 222, claimedAt: NOW };
  const others: CoordinatorEntry[] = [
    { name: "Heisenberg", sessionName: "COORDENADOR", pid: 111, claimedAt: "2026-08-29T09:00:00.000Z" },
  ];
  const txt = renderCoordinatorAwareness({ mine, others, reconnected: false });
  expect(txt).toContain("Heisenberg");
  expect(txt).toContain("COORDENADOR");
  expect(txt).toContain("2026-08-29T09:00:00.000Z");
  expect(txt.toLowerCase()).toContain("attach"); // the actionable "what to do"
});

test("renderCoordinatorAwareness is HONEST about an unverifiable other (pid 0): flags liveness cannot be verified, never asserts a possibly-dead session is alive", () => {
  const mine: CoordinatorEntry = { name: "Gus", sessionName: "COORD-2", pid: 0, claimedAt: NOW };
  const others: CoordinatorEntry[] = [
    { name: "Heisenberg", sessionName: "COORDENADOR", pid: 0, claimedAt: "2026-08-29T09:00:00.000Z" },
  ];
  const txt = renderCoordinatorAwareness({ mine, others, reconnected: false });
  expect(txt).toContain("Heisenberg"); // who
  expect(txt).toContain("2026-08-29T09:00:00.000Z"); // since when
  expect(txt.toLowerCase()).toContain("attach"); // still actionable
  // The load-bearing honesty: a pid-0 owner may have crashed; the warning must
  // NOT present it as a confirmed-live session you can attach to.
  expect(txt.toLowerCase()).toContain("cannot verify");
});

test("renderCoordinatorAwareness does NOT add the unverifiable caveat when the other is verifiably alive (pid > 0)", () => {
  const mine: CoordinatorEntry = { name: "Gus", sessionName: "COORD-2", pid: 222, claimedAt: NOW };
  const others: CoordinatorEntry[] = [
    { name: "Heisenberg", sessionName: "COORDENADOR", pid: 111, claimedAt: "2026-08-29T09:00:00.000Z" },
  ];
  const txt = renderCoordinatorAwareness({ mine, others, reconnected: false });
  expect(txt.toLowerCase()).not.toContain("cannot verify");
});

test("renderCoordinatorAwareness on a clean solo claim says you hold the identity and since when", () => {
  const mine: CoordinatorEntry = { name: "Heisenberg", sessionName: "COORDENADOR", pid: 111, claimedAt: NOW };
  const txt = renderCoordinatorAwareness({ mine, others: [], reconnected: false });
  expect(txt).toContain("COORDENADOR");
  expect(txt).toContain(NOW);
  expect(txt).not.toContain("second"); // no false alarm
});

test("renderCoordinatorAwareness on a reconnect explains the orphaned-watch limit and names the agentop boundary", () => {
  const mine: CoordinatorEntry = { name: "New", sessionName: "COORDENADOR", pid: 222, claimedAt: NOW };
  const txt = renderCoordinatorAwareness({ mine, others: [], reconnected: true });
  expect(txt.toLowerCase()).toContain("watch"); // orphaned watches explained
  expect(txt.toLowerCase()).toContain("rename"); // the actionable reconnect
});

test("releaseCoordinator removes only this session's entry, idempotently", async () => {
  await claimCoordinator(ws, { name: "H", sessionName: "C", pid: 111, now: () => NOW, isAlive: alive });
  await releaseCoordinator(ws, { pid: 111, sessionName: "C" });
  expect(await liveCoordinators(ws, alive)).toHaveLength(0);
  await releaseCoordinator(ws, { pid: 111, sessionName: "C" }); // twice is fine
});
