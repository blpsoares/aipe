import { expect, test, afterEach } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { statusCommand, stopCommand } from "../cli";
import type { ServeEntry } from "../../runtime/serve-registry";

const savedHome = process.env.AIPE_HOME;
afterEach(() => {
  if (savedHome === undefined) delete process.env.AIPE_HOME;
  else process.env.AIPE_HOME = savedHome;
});

async function withRegistry(): Promise<{ home: string; workspace: string; writeEntry: (e: ServeEntry) => Promise<void>; serveFiles: () => Promise<string[]> }> {
  const home = await mkdtemp(join(tmpdir(), "aipe-home-"));
  const workspace = await mkdtemp(join(tmpdir(), "aipe-ws-"));
  process.env.AIPE_HOME = home;
  const serveDir = join(home, "serve");
  await mkdir(serveDir, { recursive: true });
  return {
    home,
    workspace,
    writeEntry: async (e) => writeFile(join(serveDir, `${e.pid}.json`), JSON.stringify(e), "utf8"),
    serveFiles: async () => readdir(serveDir).catch(() => [] as string[]),
  };
}

function entry(over: Partial<ServeEntry>): ServeEntry {
  return { pid: process.pid, port: 4317, host: "127.0.0.1", workspace: "/x", version: "1.0.2", startedAt: Date.now() - 61_000, ...over };
}

test("statusCommand reports a running console for this workspace and exits 0", async () => {
  const { workspace, writeEntry, home } = await withRegistry();
  await writeEntry(entry({ pid: process.pid, port: 4321, workspace }));
  const lines: string[] = [];
  const code = await statusCommand(workspace, (l) => lines.push(...l));
  expect(code).toBe(0);
  const out = lines.join("\n");
  expect(out).toContain(String(process.pid));
  expect(out).toContain("4321");
  expect(out).toContain("running");
  await rm(home, { recursive: true, force: true });
});

test("statusCommand exits non-zero when nothing runs for this workspace", async () => {
  const { workspace, home } = await withRegistry();
  const code = await statusCommand(workspace, () => {});
  expect(code).not.toBe(0);
  await rm(home, { recursive: true, force: true });
});

test("stopCommand signals the workspace's console, clears its entry, is idempotent", async () => {
  const { workspace, writeEntry, serveFiles, home } = await withRegistry();
  await writeEntry(entry({ pid: process.pid, port: 4399, workspace }));
  const killed: number[] = [];
  const lines: string[] = [];
  const code = await stopCommand(workspace, (l) => lines.push(...l), (pid) => killed.push(pid));
  expect(code).toBe(0);
  expect(killed).toEqual([process.pid]);
  expect(lines.join("\n")).toContain(String(process.pid));
  // entry removed
  expect(await serveFiles()).not.toContain(`${process.pid}.json`);
  // idempotent: a second stop is a clean no-op
  const noop: string[] = [];
  const code2 = await stopCommand(workspace, (l) => noop.push(...l), (pid) => killed.push(pid));
  expect(code2).toBe(0);
  expect(noop.join("\n").toLowerCase()).toMatch(/nothing to stop|no console/);
  await rm(home, { recursive: true, force: true });
});
