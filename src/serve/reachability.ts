// Establishing where this console can actually be reached, off loopback —
// never a guess. Two independent facts, each either established (with a
// value) or declared not established (with why):
//
//   - the machine's LAN address, from its own network interfaces;
//   - its Tailscale identity and whether Tailscale Serve is already
//     forwarding HTTPS/443 to this console's port — the only Tailscale path
//     that reaches this machine in practice; the tailnet IP with a bare port
//     is a silent blackhole from behind some NATs (measured, not assumed).
//
// A signal has to establish what it claims or say it couldn't — printing a
// pretty address nobody can reach is the same defect as an exit code that
// lies about the work it did.
import { networkInterfaces, type NetworkInterfaceInfo } from "node:os";

export interface Address {
  label: "lan" | "tailscale";
  /** The bare host (IP or DNS name), no scheme/port. Set only when established. */
  host: string | null;
  /** Why `host` is null. Always set together with a null host. */
  reason?: string;
}

const VIRTUAL_IFACE_RE = /^(docker|br-|veth|virbr|tailscale|tun|tap|lo)/i;

/** Pure: the machine's own LAN address, from its network interfaces. */
export function detectLan(nets: NodeJS.Dict<NetworkInterfaceInfo[]> = networkInterfaces()): Address {
  for (const [name, addrs] of Object.entries(nets)) {
    if (!addrs || VIRTUAL_IFACE_RE.test(name)) continue;
    const v4 = addrs.find((a) => a.family === "IPv4" && !a.internal);
    if (v4) return { label: "lan", host: v4.address };
  }
  return { label: "lan", host: null, reason: "no non-virtual network interface found" };
}

export interface TailscaleStatus {
  running: boolean;
  dnsName: string | null;
  ip: string | null;
}

/** Pure: parse `tailscale status --json`. Junk or a stopped backend ⇒ nothing established. */
export function parseTailscaleStatus(raw: string): TailscaleStatus {
  try {
    const j = JSON.parse(raw) as { BackendState?: string; Self?: { DNSName?: string; TailscaleIPs?: string[] } };
    if (j.BackendState !== "Running") return { running: false, dnsName: null, ip: null };
    const dnsName = j.Self?.DNSName ? j.Self.DNSName.replace(/\.$/, "") : null;
    const ip = j.Self?.TailscaleIPs?.[0] ?? null;
    return { running: true, dnsName, ip };
  } catch {
    return { running: false, dnsName: null, ip: null };
  }
}

/** Pure: parse `tailscale serve status --json` into a "does Serve forward this port" test. */
export function parseServeStatus(raw: string): (port: number) => boolean {
  let proxies: string[] = [];
  try {
    const j = JSON.parse(raw) as { Web?: Record<string, { Handlers?: Record<string, { Proxy?: string }> }> };
    proxies = Object.values(j.Web ?? {}).flatMap((w) => Object.values(w.Handlers ?? {}).map((h) => h.Proxy ?? ""));
  } catch {
    proxies = [];
  }
  return (port: number) => proxies.some((p) => p === `http://127.0.0.1:${port}` || p.endsWith(`:${port}`) || p.endsWith(`:${port}/`));
}

export interface ExecResult {
  ok: boolean;
  stdout: string;
}

/** Runs an external CLI with a timeout; never throws. Injectable for tests. */
async function execCli(cmd: string[], timeoutMs = 2500): Promise<ExecResult> {
  try {
    const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe" });
    const timer = setTimeout(() => proc.kill(), timeoutMs);
    const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
    const exitCode = await proc.exited;
    clearTimeout(timer);
    return { ok: exitCode === 0, stdout: exitCode === 0 ? stdout : `${stdout}${stderr}` };
  } catch {
    return { ok: false, stdout: "" };
  }
}

export type Exec = (cmd: string[]) => Promise<ExecResult>;

/** The Tailscale identity of this machine, established via the tailscale CLI — or not, with why. */
export async function detectTailscale(exec: Exec = execCli): Promise<Address> {
  const { ok, stdout } = await exec(["tailscale", "status", "--json"]);
  if (!ok) return { label: "tailscale", host: null, reason: "tailscale not installed, or not running" };
  const status = parseTailscaleStatus(stdout);
  if (!status.running) return { label: "tailscale", host: null, reason: "tailscale installed but the backend is not running" };
  const host = status.dnsName ?? status.ip;
  if (!host) return { label: "tailscale", host: null, reason: "tailscale running but reported no address" };
  return { label: "tailscale", host };
}

/** Whether Tailscale Serve is already forwarding HTTPS/443 to `port` — the only Tailscale path that actually reaches this console. */
export async function tailscaleServesPort(port: number, exec: Exec = execCli): Promise<boolean> {
  const { ok, stdout } = await exec(["tailscale", "serve", "status", "--json"]);
  if (!ok) return false;
  return parseServeStatus(stdout)(port);
}

export interface ConfigureResult {
  ok: boolean;
  error?: string;
}

/**
 * Points Tailscale Serve's HTTPS/443 at this console's port, in the
 * background (`--bg` returns as soon as tailscaled has the config — it does
 * not stream logs in the foreground and hang).
 */
export async function configureTailscaleServe(port: number, exec: Exec = execCli): Promise<ConfigureResult> {
  const { ok, stdout } = await exec(["tailscale", "serve", "--bg", "--https=443", `http://127.0.0.1:${port}`]);
  return ok ? { ok: true } : { ok: false, error: stdout.trim() || "tailscale serve failed" };
}
