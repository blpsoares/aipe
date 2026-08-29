import { expect, test } from "bun:test";
import {
  applyUpgrade,
  migrateCommand,
  migrationTargets,
  parseMigratedRepos,
  rehydrateCommand,
  serveRestartCommand,
  type ApplyDeps,
  type ApplyOptions,
} from "../apply";
import type { ServeEntry } from "../../runtime/serve-registry";

const BIN = "/home/u/.local/bin/aipe";

function serve(over: Partial<ServeEntry> = {}): ServeEntry {
  return { pid: 111, port: 4317, host: "127.0.0.1", workspace: "/w/one", version: "1.0.0", startedAt: 1, ...over };
}

function deps(over: Partial<ApplyDeps> = {}): ApplyDeps {
  return {
    workspaces: async () => [],
    serves: async () => [],
    run: async () => ({ code: 0, output: "" }),
    migrate: async (_bin, workspace) => ({ ok: true, repos: 1, output: `STATE migrate-layout=done (1 repo(s))` }),
    spawnDetached: () => 999,
    stop: () => true,
    log: () => {},
    isLegacy: async () => false,
    wait: async () => {},
    ...over,
  };
}

function run(bin: string, over: Partial<ApplyDeps> = {}, opts: ApplyOptions = {}) {
  return applyUpgrade(bin, opts, deps(over));
}

test("the restart reproduces the server's workspace, port and host", () => {
  expect(serveRestartCommand(BIN, serve({ port: 5000, host: "0.0.0.0" }))).toEqual([
    BIN, "serve", "--workspace", "/w/one", "--port", "5000", "--host", "0.0.0.0",
  ]);
  expect(rehydrateCommand(BIN, "/w/two")).toEqual([BIN, "rehydrate", "--workspace", "/w/two"]);
  expect(migrateCommand(BIN, "/w/two")).toEqual([BIN, "workspace", "migrate-layout", "--apply", "--workspace", "/w/two"]);
});

test("parseMigratedRepos reads the repo count from the STATE line", () => {
  expect(parseMigratedRepos("OK moved x\nSTATE migrate-layout=done (2 repo(s), 1 persona path(s))")).toBe(2);
  expect(parseMigratedRepos("STATE migrate-layout=nothing-to-do")).toBe(0);
  expect(parseMigratedRepos("garbage")).toBe(0);
});

test("every known workspace is rehydrated through the NEW binary", async () => {
  const ran: string[][] = [];
  const out = await run(BIN, { workspaces: async () => ["/w/one", "/w/two"], run: async (cmd) => (ran.push(cmd), { code: 0, output: "" }) });
  expect(ran).toEqual([rehydrateCommand(BIN, "/w/one"), rehydrateCommand(BIN, "/w/two")]);
  expect(out.ok).toBe(true);
  expect(out.rehydrated).toEqual(["/w/one", "/w/two"]);
});

// D2/F: the subprocess output is captured, so a failed rehydrate says WHY —
// not the opaque `exited 1` of today.
test("a failed rehydrate is reported WITH the captured reason", async () => {
  const out = await run(BIN, {
    workspaces: async () => ["/w/one", "/w/two"],
    run: async (cmd) => (cmd[3] === "/w/one" ? { code: 3, output: "ERROR toolbox: pdd kit missing\n" } : { code: 0, output: "" }),
  });
  expect(out.ok).toBe(false);
  expect(out.failures).toEqual(["rehydrate /w/one: exited 3 — ERROR toolbox: pdd kit missing"]);
  expect(out.rehydrated).toEqual(["/w/two"]); // the other one still got done
});

test("a running web console is stopped and started again from the new binary", async () => {
  const stopped: number[] = [];
  const spawned: string[][] = [];
  const out = await run(BIN, {
    serves: async () => [serve({ pid: 222, port: 4400 })],
    stop: (pid) => (stopped.push(pid), true),
    spawnDetached: (cmd) => (spawned.push(cmd), 777),
  });
  expect(stopped).toEqual([222]);
  expect(spawned).toEqual([serveRestartCommand(BIN, serve({ pid: 222, port: 4400 }))]);
  expect(out.restarted).toEqual([777]);
  expect(out.ok).toBe(true);
});

test("a console that cannot be stopped is a failure, and is not double-started", async () => {
  const spawned: string[][] = [];
  const out = await run(BIN, { serves: async () => [serve({ pid: 333 })], stop: () => false, spawnDetached: (c) => (spawned.push(c), 1) });
  expect(spawned).toEqual([]);
  expect(out.ok).toBe(false);
  expect(out.failures[0]).toContain("pid 333");
});

test("a console that stops but will not come back is reported", async () => {
  const out = await run(BIN, { serves: async () => [serve()], spawnDetached: () => null });
  expect(out.ok).toBe(false);
  expect(out.failures[0]).toContain("could not be restarted");
  expect(out.restarted).toEqual([]);
});

test("nothing to apply is a success, not an error", async () => {
  const lines: string[] = [];
  const out = await run(BIN, { log: (l) => lines.push(l) });
  expect(out.ok).toBe(true);
  expect(out.migrated).toEqual([]);
  expect(out.deferredLegacy).toEqual([]);
  expect(lines.join("\n")).toContain("Nothing to apply");
});

test("a registry that cannot be read degrades to doing nothing", async () => {
  const out = await run(BIN, {
    workspaces: async () => {
      throw new Error("unreadable");
    },
    serves: async () => {
      throw new Error("unreadable");
    },
  });
  expect(out.ok).toBe(true);
});

test("a restarted console keeps its token, and it never reaches the argv", async () => {
  const calls: { cmd: string[]; env?: Record<string, string> }[] = [];
  const entry = serve({ host: "0.0.0.0", token: "secret-token", insecure: false });
  await run(BIN, { serves: async () => [entry], spawnDetached: (cmd, env) => (calls.push({ cmd, env }), 1) });
  expect(calls[0]!.env).toEqual({ AIPE_SERVE_TOKEN: "secret-token" });
  expect(calls[0]!.cmd.join(" ")).not.toContain("secret-token");
});

test("an --insecure console is restarted --insecure, not silently locked down", async () => {
  const calls: string[][] = [];
  await run(BIN, { serves: async () => [serve({ host: "0.0.0.0", insecure: true })], spawnDetached: (cmd) => (calls.push(cmd), 1) });
  expect(calls[0]).toContain("--insecure");
});

test("a loopback console carries no token and no env", async () => {
  const calls: { cmd: string[]; env?: Record<string, string> }[] = [];
  await run(BIN, { serves: async () => [serve()], spawnDetached: (c, e) => (calls.push({ cmd: c, env: e }), 1) });
  expect(calls[0]!.env).toBeUndefined();
  expect(calls[0]!.cmd).not.toContain("--insecure");
});

// The journey's core inversion: the upgrade now MIGRATES the current workspace
// autonomously (it used to only print "you should run migrate-layout").
test("the current legacy workspace is MIGRATED, not just reported (D1)", async () => {
  const migrations: string[] = [];
  const lines: string[] = [];
  const out = await run(
    BIN,
    {
      workspaces: async () => ["/w/legacy"],
      isLegacy: async () => true,
      migrate: async (_b, ws) => (migrations.push(ws), { ok: true, repos: 2, output: "STATE migrate-layout=done (2 repo(s))" }),
      log: (l) => lines.push(l),
    },
    { currentWorkspace: "/w/legacy" },
  );
  expect(migrations).toEqual(["/w/legacy"]);
  expect(out.migrated).toEqual([{ workspace: "/w/legacy", repos: 2 }]);
  expect(out.deferredLegacy).toEqual([]);
  expect(out.ok).toBe(true);
  // Says what was DONE; never a "now run X" instruction for the current one.
  const text = lines.join("\n");
  expect(text).toContain("Migrated /w/legacy");
  expect(text).not.toContain("To migrate it");
});

// Safe default scope: a legacy workspace that is NOT the one being upgraded from
// is deferred (named with the command), never migrated unattended.
test("a legacy workspace that is not the current one is deferred, not migrated (D5)", async () => {
  const migrations: string[] = [];
  const lines: string[] = [];
  const out = await run(
    BIN,
    {
      workspaces: async () => ["/w/current", "/w/other"],
      isLegacy: async () => true,
      migrate: async (_b, ws) => (migrations.push(ws), { ok: true, repos: 1, output: "" }),
      log: (l) => lines.push(l),
    },
    { currentWorkspace: "/w/current" },
  );
  expect(migrations).toEqual(["/w/current"]);
  expect(out.deferredLegacy).toEqual(["/w/other"]);
  const text = lines.join("\n");
  expect(text).toContain("aipe workspace migrate-layout --apply --workspace /w/other");
  expect(text).toContain("--migrate-all");
});

// No current workspace (upgrade run outside any workspace) and no --migrate-all:
// the safe default migrates nothing, and names the legacy workspaces.
test("with no current workspace and no --migrate-all, nothing is migrated (safe default)", async () => {
  const migrations: string[] = [];
  const out = await run(
    BIN,
    {
      workspaces: async () => ["/w/a", "/w/b"],
      isLegacy: async () => true,
      migrate: async (_b, ws) => (migrations.push(ws), { ok: true, repos: 1, output: "" }),
    },
    {},
  );
  expect(migrations).toEqual([]);
  expect(out.deferredLegacy).toEqual(["/w/a", "/w/b"]);
  expect(out.ok).toBe(true);
});

test("--migrate-all migrates every known legacy workspace", async () => {
  const migrations: string[] = [];
  const out = await run(
    BIN,
    {
      workspaces: async () => ["/w/a", "/w/b", "/w/modern"],
      isLegacy: async (ws) => ws !== "/w/modern",
      migrate: async (_b, ws) => (migrations.push(ws), { ok: true, repos: 1, output: "" }),
    },
    { migrateAll: true },
  );
  expect(migrations.sort()).toEqual(["/w/a", "/w/b"]);
  expect(out.deferredLegacy).toEqual([]);
});

// A migration that fails is surfaced with its captured reason; the binary is
// installed but the upgrade is not "done".
test("a failed migration is reported with its captured reason", async () => {
  const out = await run(
    BIN,
    {
      workspaces: async () => ["/w/legacy"],
      isLegacy: async () => true,
      migrate: async () => ({ ok: false, repos: 0, output: "BLOCKED embark: dirty\nSTATE migrate-layout=blocked (1 blocker(s))" }),
    },
    { currentWorkspace: "/w/legacy" },
  );
  expect(out.ok).toBe(false);
  expect(out.failures[0]).toContain("migrate /w/legacy");
  expect(out.failures[0]).toContain("blocked");
});

test("migrationTargets: default is the current legacy workspace only; --migrate-all is everything", () => {
  expect(migrationTargets(["/a", "/b"], { currentWorkspace: "/a" })).toEqual(["/a"]);
  expect(migrationTargets(["/a", "/b"], { currentWorkspace: "/modern" })).toEqual([]);
  expect(migrationTargets(["/a", "/b"], {})).toEqual([]);
  expect(migrationTargets(["/a", "/b"], { migrateAll: true })).toEqual(["/a", "/b"]);
});
