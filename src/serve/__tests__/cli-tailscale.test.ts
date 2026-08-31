import { expect, test, afterEach } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { tailscaleCommand, buildReach } from "../cli";
import type { ServeEntry } from "../../runtime/serve-registry";

const savedHome = process.env.AIPE_HOME;
afterEach(() => {
  if (savedHome === undefined) delete process.env.AIPE_HOME;
  else process.env.AIPE_HOME = savedHome;
});

async function withRegistry(): Promise<{ home: string; workspace: string; writeEntry: (e: ServeEntry) => Promise<void> }> {
  const home = await mkdtemp(join(tmpdir(), "aipe-home-"));
  const workspace = await mkdtemp(join(tmpdir(), "aipe-ws-"));
  process.env.AIPE_HOME = home;
  const serveDir = join(home, "serve");
  await mkdir(serveDir, { recursive: true });
  return { home, workspace, writeEntry: async (e) => writeFile(join(serveDir, `${e.pid}.json`), JSON.stringify(e), "utf8") };
}

function entry(over: Partial<ServeEntry>): ServeEntry {
  return { pid: process.pid, port: 4317, host: "0.0.0.0", workspace: "/x", version: "1.0.2", startedAt: Date.now() - 61_000, ...over };
}

test("tailscaleCommand refuses when no console runs for this workspace, without touching tailscale", async () => {
  const { workspace, home } = await withRegistry();
  let called = false;
  const code = await tailscaleCommand(workspace, () => {}, {
    configure: async () => { called = true; return { ok: true }; },
    detectTailscale: async () => ({ label: "tailscale", host: null }),
    tailscaleServesPort: async () => false,
  });
  expect(code).not.toBe(0);
  expect(called).toBe(false);
  await rm(home, { recursive: true, force: true });
});

test("tailscaleCommand configures Serve for the workspace's console and reports the working URL once confirmed", async () => {
  const { workspace, writeEntry, home } = await withRegistry();
  await writeEntry(entry({ pid: process.pid, port: 4900, workspace, token: "tok123" }));
  const configuredPorts: number[] = [];
  const lines: string[] = [];
  const code = await tailscaleCommand(workspace, (l) => lines.push(...l), {
    configure: async (port) => { configuredPorts.push(port); return { ok: true }; },
    detectTailscale: async () => ({ label: "tailscale", host: "alien-wsl.seahorse-cobia.ts.net" }),
    tailscaleServesPort: async (port) => port === 4900,
  });
  expect(configuredPorts).toEqual([4900]);
  expect(code).toBe(0);
  expect(lines.join("\n")).toContain("https://alien-wsl.seahorse-cobia.ts.net/?token=tok123");
  await rm(home, { recursive: true, force: true });
});

test("tailscaleCommand surfaces a CLI failure without claiming success", async () => {
  const { workspace, writeEntry, home } = await withRegistry();
  await writeEntry(entry({ pid: process.pid, port: 4900, workspace }));
  const code = await tailscaleCommand(workspace, () => {}, {
    configure: async () => ({ ok: false, error: "tailscale: not logged in" }),
    detectTailscale: async () => ({ label: "tailscale", host: null }),
    tailscaleServesPort: async () => false,
  });
  expect(code).not.toBe(0);
  await rm(home, { recursive: true, force: true });
});

test("tailscaleCommand reports unverified (not success) when Serve still doesn't show the forward after configuring", async () => {
  const { workspace, writeEntry, home } = await withRegistry();
  await writeEntry(entry({ pid: process.pid, port: 4900, workspace }));
  const lines: string[] = [];
  const code = await tailscaleCommand(workspace, (l) => lines.push(...l), {
    configure: async () => ({ ok: true }),
    detectTailscale: async () => ({ label: "tailscale", host: "alien-wsl.seahorse-cobia.ts.net" }),
    tailscaleServesPort: async () => false,
  });
  expect(code).not.toBe(0);
  expect(lines.join("\n").toLowerCase()).toContain("not");
  await rm(home, { recursive: true, force: true });
});

test("buildReach on loopback is a single established row and never queries lan/tailscale", async () => {
  let queried = false;
  const rows = await buildReach("127.0.0.1", 4317, "", {
    detectLan: () => { queried = true; return { label: "lan", host: null }; },
    detectTailscale: async () => { queried = true; return { label: "tailscale", host: null }; },
    tailscaleServesPort: async () => false,
  });
  expect(rows).toEqual([{ label: "url", value: "http://127.0.0.1:4317", established: true }]);
  expect(queried).toBe(false);
});

test("buildReach off loopback establishes lan and tailscale independently, never printing localhost", async () => {
  const rows = await buildReach("0.0.0.0", 4317, "/?token=abc", {
    detectLan: () => ({ label: "lan", host: "192.168.1.42" }),
    detectTailscale: async () => ({ label: "tailscale", host: "alien-wsl.seahorse-cobia.ts.net" }),
    tailscaleServesPort: async () => true,
  });
  expect(rows).toContainEqual({ label: "lan", value: "http://192.168.1.42:4317/?token=abc", established: true });
  expect(rows).toContainEqual({ label: "tailscale", value: "https://alien-wsl.seahorse-cobia.ts.net/?token=abc", established: true });
  for (const r of rows) expect(r.value).not.toContain("localhost");
});

test("buildReach declares tailscale not established when the CLI has nothing, and when Serve isn't pointed here yet", async () => {
  const absent = await buildReach("0.0.0.0", 4317, "", {
    detectLan: () => ({ label: "lan", host: null, reason: "no non-virtual network interface found" }),
    detectTailscale: async () => ({ label: "tailscale", host: null, reason: "tailscale not installed, or not running" }),
    tailscaleServesPort: async () => false,
  });
  expect(absent.find((r) => r.label === "lan")).toEqual({ label: "lan", value: "not established — no non-virtual network interface found", established: false });
  expect(absent.find((r) => r.label === "tailscale")).toEqual({ label: "tailscale", value: "not established — tailscale not installed, or not running", established: false });

  const notServed = await buildReach("0.0.0.0", 4317, "", {
    detectLan: () => ({ label: "lan", host: null, reason: "x" }),
    detectTailscale: async () => ({ label: "tailscale", host: "alien-wsl.seahorse-cobia.ts.net" }),
    tailscaleServesPort: async () => false,
  });
  const ts = notServed.find((r) => r.label === "tailscale")!;
  expect(ts.established).toBe(false);
  expect(ts.value).toContain("aipe serve tailscale");
});
