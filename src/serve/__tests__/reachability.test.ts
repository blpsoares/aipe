import { expect, test } from "bun:test";
import {
  parseTailscaleStatus,
  parseServeStatus,
  detectLan,
  detectTailscale,
  tailscaleServesPort,
  configureTailscaleServe,
} from "../reachability";

// ── parseTailscaleStatus (pure) ──────────────────────────────────────────────

test("parseTailscaleStatus reads the DNS name and IP of a running backend, strips the trailing dot", () => {
  const raw = JSON.stringify({
    BackendState: "Running",
    Self: { DNSName: "alien-wsl.seahorse-cobia.ts.net.", TailscaleIPs: ["100.109.247.39"] },
  });
  expect(parseTailscaleStatus(raw)).toEqual({ running: true, dnsName: "alien-wsl.seahorse-cobia.ts.net", ip: "100.109.247.39" });
});

test("parseTailscaleStatus reports not-running when the backend is stopped, even with a Self block", () => {
  const raw = JSON.stringify({ BackendState: "Stopped", Self: { DNSName: "x.ts.net.", TailscaleIPs: ["100.1.2.3"] } });
  expect(parseTailscaleStatus(raw)).toEqual({ running: false, dnsName: null, ip: null });
});

test("parseTailscaleStatus on junk input reports not-running rather than throwing", () => {
  expect(parseTailscaleStatus("not json")).toEqual({ running: false, dnsName: null, ip: null });
  expect(parseTailscaleStatus("")).toEqual({ running: false, dnsName: null, ip: null });
});

// ── parseServeStatus (pure) ──────────────────────────────────────────────────

test("parseServeStatus tells whether Serve is forwarding a given port, from the real CLI shape", () => {
  const raw = JSON.stringify({
    TCP: { "443": { HTTPS: true } },
    Web: { "alien-wsl.seahorse-cobia.ts.net:443": { Handlers: { "/": { Proxy: "http://127.0.0.1:4901" } } } },
  });
  const forwards = parseServeStatus(raw);
  expect(forwards(4901)).toBe(true);
  expect(forwards(4317)).toBe(false);
});

test("parseServeStatus on an empty config forwards nothing", () => {
  expect(parseServeStatus(JSON.stringify({}))(4317)).toBe(false);
});

test("parseServeStatus on junk input forwards nothing rather than throwing", () => {
  expect(parseServeStatus("not json")(4317)).toBe(false);
});

// ── detectLan (pure, injected interfaces) ────────────────────────────────────

test("detectLan picks the first non-internal, non-virtual IPv4 address", () => {
  const nets = {
    lo: [{ address: "127.0.0.1", family: "IPv4", internal: true } as any],
    docker0: [{ address: "172.17.0.1", family: "IPv4", internal: false } as any],
    eth0: [{ address: "192.168.1.42", family: "IPv4", internal: false } as any],
  };
  expect(detectLan(nets)).toEqual({ label: "lan", host: "192.168.1.42" });
});

test("detectLan declares not-established when only loopback/virtual interfaces exist", () => {
  const nets = {
    lo: [{ address: "127.0.0.1", family: "IPv4", internal: true } as any],
    docker0: [{ address: "172.17.0.1", family: "IPv4", internal: false } as any],
    tailscale0: [{ address: "100.1.2.3", family: "IPv4", internal: false } as any],
  };
  const result = detectLan(nets);
  expect(result.host).toBeNull();
  expect(result.reason).toBeTruthy();
});

// ── detectTailscale (injected exec) ──────────────────────────────────────────

test("detectTailscale reports the host from a running backend", async () => {
  const exec = async () => ({ ok: true, stdout: JSON.stringify({ BackendState: "Running", Self: { DNSName: "x.ts.net.", TailscaleIPs: ["100.1.2.3"] } }) });
  expect(await detectTailscale(exec)).toEqual({ label: "tailscale", host: "x.ts.net" });
});

test("detectTailscale declares not-established when the CLI is missing or fails", async () => {
  const exec = async () => ({ ok: false, stdout: "" });
  const result = await detectTailscale(exec);
  expect(result.host).toBeNull();
  expect(result.reason).toBeTruthy();
});

test("detectTailscale declares not-established when the backend is not running", async () => {
  const exec = async () => ({ ok: true, stdout: JSON.stringify({ BackendState: "Stopped" }) });
  const result = await detectTailscale(exec);
  expect(result.host).toBeNull();
  expect(result.reason).toBeTruthy();
});

// ── tailscaleServesPort (injected exec) ──────────────────────────────────────

test("tailscaleServesPort is true only when Serve forwards to that exact port", async () => {
  const raw = JSON.stringify({ Web: { "x.ts.net:443": { Handlers: { "/": { Proxy: "http://127.0.0.1:4901" } } } } });
  const exec = async () => ({ ok: true, stdout: raw });
  expect(await tailscaleServesPort(4901, exec)).toBe(true);
  expect(await tailscaleServesPort(4317, exec)).toBe(false);
});

test("tailscaleServesPort is false when the CLI call fails", async () => {
  const exec = async () => ({ ok: false, stdout: "" });
  expect(await tailscaleServesPort(4317, exec)).toBe(false);
});

// ── configureTailscaleServe (injected exec) ──────────────────────────────────

test("configureTailscaleServe reports success when the CLI call exits clean", async () => {
  const calls: string[][] = [];
  const exec = async (cmd: string[]) => {
    calls.push(cmd);
    return { ok: true, stdout: "" };
  };
  const result = await configureTailscaleServe(4317, exec);
  expect(result.ok).toBe(true);
  expect(calls[0]).toEqual(["tailscale", "serve", "--bg", "--https=443", "http://127.0.0.1:4317"]);
});

test("configureTailscaleServe surfaces the CLI's own error text on failure", async () => {
  const exec = async () => ({ ok: false, stdout: "tailscale: not logged in\n" });
  const result = await configureTailscaleServe(4317, exec);
  expect(result.ok).toBe(false);
  expect(result.error).toContain("not logged in");
});
