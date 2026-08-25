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

test("looksLikeWorkspace asks for a .aipe directory", () => {
  const seen: string[] = [];
  expect(looksLikeWorkspace("/w", (p) => (seen.push(p), true))).toBe(true);
  expect(seen).toEqual(["/w/.aipe"]);
  expect(looksLikeWorkspace("/w", () => false)).toBe(false);
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
