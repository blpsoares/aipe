import { expect, test } from "bun:test";
import { applyUpgrade, rehydrateCommand, serveRestartCommand, type ApplyDeps } from "../apply";
import type { ServeEntry } from "../../runtime/serve-registry";

const BIN = "/home/u/.local/bin/aipe";

function serve(over: Partial<ServeEntry> = {}): ServeEntry {
  return { pid: 111, port: 4317, host: "127.0.0.1", workspace: "/w/one", version: "1.0.0", startedAt: 1, ...over };
}

function deps(over: Partial<ApplyDeps> = {}): ApplyDeps {
  return {
    workspaces: async () => [],
    serves: async () => [],
    run: async () => 0,
    spawnDetached: () => 999,
    stop: () => true,
    log: () => {},
    wait: async () => {},
    ...over,
  };
}

test("the restart reproduces the server's workspace, port and host", () => {
  expect(serveRestartCommand(BIN, serve({ port: 5000, host: "0.0.0.0" }))).toEqual([
    BIN, "serve", "--workspace", "/w/one", "--port", "5000", "--host", "0.0.0.0",
  ]);
  expect(rehydrateCommand(BIN, "/w/two")).toEqual([BIN, "rehydrate", "--workspace", "/w/two"]);
});

test("every known workspace is rehydrated through the NEW binary", async () => {
  const ran: string[][] = [];
  const out = await applyUpgrade(
    BIN,
    deps({ workspaces: async () => ["/w/one", "/w/two"], run: async (cmd) => (ran.push(cmd), 0) }),
  );
  expect(ran).toEqual([rehydrateCommand(BIN, "/w/one"), rehydrateCommand(BIN, "/w/two")]);
  expect(out.ok).toBe(true);
  expect(out.rehydrated).toEqual(["/w/one", "/w/two"]);
});

test("a failed rehydrate is reported, not swallowed", async () => {
  // Claiming success while a workspace still runs last version's coordinator
  // skills is exactly the lie that hides a half-applied upgrade.
  const out = await applyUpgrade(
    BIN,
    deps({ workspaces: async () => ["/w/one", "/w/two"], run: async (cmd) => (cmd[3] === "/w/one" ? 3 : 0) }),
  );
  expect(out.ok).toBe(false);
  expect(out.failures).toEqual(["rehydrate /w/one: exited 3"]);
  expect(out.rehydrated).toEqual(["/w/two"]); // the other one still got done
});

test("a running web console is stopped and started again from the new binary", async () => {
  const stopped: number[] = [];
  const spawned: string[][] = [];
  const out = await applyUpgrade(
    BIN,
    deps({
      serves: async () => [serve({ pid: 222, port: 4400 })],
      stop: (pid) => (stopped.push(pid), true),
      spawnDetached: (cmd) => (spawned.push(cmd), 777),
    }),
  );
  expect(stopped).toEqual([222]);
  expect(spawned).toEqual([serveRestartCommand(BIN, serve({ pid: 222, port: 4400 }))]);
  expect(out.restarted).toEqual([777]);
  expect(out.ok).toBe(true);
});

test("a console that cannot be stopped is a failure, and is not double-started", async () => {
  // Starting a second server onto a port the old one still owns is how a
  // 'successful' upgrade ends with no console at all.
  const spawned: string[][] = [];
  const out = await applyUpgrade(
    BIN,
    deps({ serves: async () => [serve({ pid: 333 })], stop: () => false, spawnDetached: (c) => (spawned.push(c), 1) }),
  );
  expect(spawned).toEqual([]);
  expect(out.ok).toBe(false);
  expect(out.failures[0]).toContain("pid 333");
});

test("a console that stops but will not come back is reported", async () => {
  const out = await applyUpgrade(BIN, deps({ serves: async () => [serve()], spawnDetached: () => null }));
  expect(out.ok).toBe(false);
  expect(out.failures[0]).toContain("could not be restarted");
  expect(out.restarted).toEqual([]);
});

test("nothing to apply is a success, not an error", async () => {
  const lines: string[] = [];
  const out = await applyUpgrade(BIN, deps({ log: (l) => lines.push(l) }));
  expect(out).toEqual({ ok: true, rehydrated: [], restarted: [], failures: [] });
  expect(lines.join("\n")).toContain("Nothing to apply");
});

test("a registry that cannot be read degrades to doing nothing", async () => {
  const out = await applyUpgrade(
    BIN,
    deps({
      workspaces: async () => {
        throw new Error("unreadable");
      },
      serves: async () => {
        throw new Error("unreadable");
      },
    }),
  );
  expect(out.ok).toBe(true);
});
