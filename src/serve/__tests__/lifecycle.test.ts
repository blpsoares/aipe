import { expect, test } from "bun:test";
import { resolve } from "node:path";
import {
  isHelpRequest,
  serveSubcommand,
  selectForWorkspace,
  statusExitCode,
  stopPlan,
  portHolder,
  NOT_RUNNING_CODE,
} from "../lifecycle";
import type { ServeEntry } from "../../runtime/serve-registry";

function entry(over: Partial<ServeEntry> = {}): ServeEntry {
  return {
    pid: 111,
    port: 4317,
    host: "127.0.0.1",
    workspace: "/home/u/ws",
    version: "1.0.2",
    startedAt: 1_000,
    ...over,
  };
}

test("isHelpRequest catches --help and -h anywhere in the args", () => {
  expect(isHelpRequest(["--help"])).toBe(true);
  expect(isHelpRequest(["-h"])).toBe(true);
  expect(isHelpRequest(["--port", "4317", "--help"])).toBe(true);
  expect(isHelpRequest(["status"])).toBe(false);
  expect(isHelpRequest([])).toBe(false);
});

test("serveSubcommand reads the leading positional only", () => {
  expect(serveSubcommand(["status"])).toBe("status");
  expect(serveSubcommand(["stop", "--workspace", "x"])).toBe("stop");
  // a flag first ⇒ this is the plain `serve` (start) form, no subcommand
  expect(serveSubcommand(["--port", "4317"])).toBeUndefined();
  // an unknown positional is not a subcommand
  expect(serveSubcommand(["frobnicate"])).toBeUndefined();
  expect(serveSubcommand([])).toBeUndefined();
});

test("selectForWorkspace matches on the resolved absolute path", () => {
  const wsAbs = resolve("/home/u/ws");
  const entries = [
    entry({ pid: 1, workspace: "/home/u/ws" }),
    entry({ pid: 2, workspace: "/home/u/other" }),
    entry({ pid: 3, workspace: "/home/u/ws/." }), // same dir, un-normalized
  ];
  const matched = selectForWorkspace(entries, wsAbs);
  expect(matched.map((e) => e.pid).sort()).toEqual([1, 3]);
});

test("statusExitCode distinguishes running from not", () => {
  expect(statusExitCode([entry()])).toBe(0);
  expect(statusExitCode([])).toBe(NOT_RUNNING_CODE);
  expect(NOT_RUNNING_CODE).not.toBe(0);
  // NOT a generic error code (1) — "not running" is a clean answer
  expect(NOT_RUNNING_CODE).not.toBe(1);
});

test("stopPlan returns the pids to kill for this workspace, most-recent-first", () => {
  const wsAbs = resolve("/home/u/ws");
  const entries = [
    entry({ pid: 1, workspace: "/home/u/ws", startedAt: 10 }),
    entry({ pid: 2, workspace: "/home/u/other", startedAt: 20 }),
    entry({ pid: 3, workspace: "/home/u/ws", startedAt: 30 }),
  ];
  expect(stopPlan(entries, wsAbs)).toEqual([3, 1]);
  // idempotent: nothing for this workspace ⇒ empty plan, no throw
  expect(stopPlan([], wsAbs)).toEqual([]);
});

test("portHolder names who holds a busy host:port, preferring an exact host match", () => {
  const entries = [
    entry({ pid: 7, port: 4317, host: "127.0.0.1", workspace: "/a" }),
    entry({ pid: 8, port: 4317, host: "0.0.0.0", workspace: "/b" }),
  ];
  expect(portHolder(entries, 4317, "0.0.0.0")?.pid).toBe(8);
  expect(portHolder(entries, 4317, "127.0.0.1")?.pid).toBe(7);
  // port match with a different host still identifies a likely holder
  expect(portHolder(entries, 4317, "192.168.0.9")?.pid).toBe(7);
  expect(portHolder(entries, 9999, "127.0.0.1")).toBeNull();
});
