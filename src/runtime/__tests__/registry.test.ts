import { expect, test } from "bun:test";
import {
  MAX_WORKSPACES,
  RECORD_THROTTLE_MS,
  looksLikeWorkspace,
  mergeWorkspace,
  needsRecord,
  parseWorkspaceRegistry,
} from "../workspaces";
import { parseServeEntry } from "../serve-registry";
import { aipeStateDir } from "../state";

const NOW = 1_000_000_000_000;

test("aipeStateDir defaults under HOME and honours AIPE_HOME", () => {
  expect(aipeStateDir({}, "/home/u")).toBe("/home/u/.aipe");
  expect(aipeStateDir({ AIPE_HOME: "/tmp/x" }, "/home/u")).toBe("/tmp/x");
});

test("mergeWorkspace dedupes by path and keeps the newest first", () => {
  const list = [
    { path: "/a", lastSeen: 1 },
    { path: "/b", lastSeen: 2 },
  ];
  const next = mergeWorkspace(list, "/a", NOW);
  expect(next.map((e) => e.path)).toEqual(["/a", "/b"]);
  expect(next).toHaveLength(2); // moved up, not appended a second time
  expect(next[0]!.lastSeen).toBe(NOW);
});

test("the registry is capped so it cannot grow without bound", () => {
  const many = Array.from({ length: MAX_WORKSPACES + 10 }, (_, i) => ({ path: `/w${i}`, lastSeen: i }));
  expect(mergeWorkspace(many, "/new", NOW)).toHaveLength(MAX_WORKSPACES);
});

test("re-recording the same workspace inside the throttle window writes nothing", () => {
  // Hooks fire this on every session event; a disk write each time buys nothing.
  const list = [{ path: "/a", lastSeen: NOW }];
  expect(needsRecord(list, "/a", NOW + 1)).toBe(false);
  expect(needsRecord(list, "/a", NOW + RECORD_THROTTLE_MS)).toBe(true);
  expect(needsRecord(list, "/b", NOW + 1)).toBe(true); // a different workspace
  expect(needsRecord([], "/a", NOW)).toBe(true);
});

test("parseWorkspaceRegistry drops junk entries instead of throwing", () => {
  expect(parseWorkspaceRegistry("not json")).toEqual([]);
  expect(parseWorkspaceRegistry('{"workspaces":"nope"}')).toEqual([]);
  expect(parseWorkspaceRegistry('{"workspaces":[{"path":"/a","lastSeen":1},{"path":""},{"lastSeen":2}]}')).toEqual([
    { path: "/a", lastSeen: 1 },
  ]);
});

test("looksLikeWorkspace asks for a workspace MARKER, not a bare .aipe/", () => {
  // The bare-directory check is what let $HOME through — see the state-dir
  // test below.
  expect(looksLikeWorkspace("/w", () => true, "/home/u/.aipe")).toBe(true);
  expect(looksLikeWorkspace("/w", () => false, "/home/u/.aipe")).toBe(false);
});

test("parseServeEntry needs a pid and a workspace, and fills the rest in", () => {
  expect(parseServeEntry("{")).toBeNull();
  expect(parseServeEntry('{"pid":0,"workspace":"/w"}')).toBeNull();
  expect(parseServeEntry('{"pid":7}')).toBeNull();
  expect(parseServeEntry('{"pid":7,"workspace":"/w"}')).toEqual({
    pid: 7,
    port: 0,
    host: "127.0.0.1",
    workspace: "/w",
    version: "",
    startedAt: 0,
  });
});

test("the machine state dir is never mistaken for a workspace", () => {
  // ~/.aipe IS the state dir, and it is also literally a `.aipe` directory.
  // Treating $HOME as a workspace made the next upgrade rehydrate it, writing
  // AIPe's flow-skills into ~/.claude/skills/ — the user's GLOBAL harness
  // config, loaded by every session on the machine.
  const home = "/home/u";
  const stateDir = "/home/u/.aipe";
  // Even if something inside it happens to match a marker name, it is excluded.
  expect(looksLikeWorkspace(home, () => true, stateDir)).toBe(false);
});

test("a directory with a bare .aipe/ and no marker is not a workspace", () => {
  const seen: string[] = [];
  const exists = (p: string) => (seen.push(p), false);
  expect(looksLikeWorkspace("/w", exists, "/home/u/.aipe")).toBe(false);
  // It looked for the markers, not for the bare directory.
  expect(seen).toEqual(["/w/.aipe/harness", "/w/.aipe/brain.yaml"]);
});

test("either marker is enough — start writes one, context-brain the other", () => {
  const only = (marker: string) => (p: string) => p.endsWith(marker);
  // `aipe start` has written .aipe/harness but onboarding has not run yet.
  expect(looksLikeWorkspace("/w", only("harness"), "/home/u/.aipe")).toBe(true);
  // An older workspace predating the harness file still has its brain.
  expect(looksLikeWorkspace("/w", only("brain.yaml"), "/home/u/.aipe")).toBe(true);
});
