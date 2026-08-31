import { expect, test } from "bun:test";
import {
  supportsColor,
  formatElapsed,
  renderHelp,
  renderBanner,
  renderStatus,
  renderStop,
  renderTailscale,
  liveLine,
  hasAnsi,
} from "../present";
import type { ServeEntry } from "../../runtime/serve-registry";

function entry(over: Partial<ServeEntry> = {}): ServeEntry {
  return { pid: 4242, port: 4317, host: "127.0.0.1", workspace: "/home/u/ws", version: "1.0.2", startedAt: 1000, ...over };
}

test("supportsColor: off without a TTY, off under NO_COLOR, on for a plain TTY", () => {
  expect(supportsColor({ isTTY: false }, {})).toBe(false);
  expect(supportsColor({ isTTY: true }, {})).toBe(true);
  expect(supportsColor({ isTTY: true }, { NO_COLOR: "1" })).toBe(false);
  expect(supportsColor({ isTTY: true }, { TERM: "dumb" })).toBe(false);
});

test("formatElapsed is compact and human", () => {
  expect(formatElapsed(5_000)).toBe("5s");
  expect(formatElapsed(90_000)).toBe("1m 30s");
  expect(formatElapsed(3_600_000)).toBe("1h 0m");
  expect(formatElapsed(-10)).toBe("0s");
});

test("renderHelp prints usage, the three subcommands and the flags, plainly without a TTY", () => {
  const lines = renderHelp(false).join("\n");
  expect(lines).toContain("aipe serve");
  expect(lines).toContain("status");
  expect(lines).toContain("stop");
  expect(lines).toContain("--background");
  expect(lines).toContain("--port");
  expect(lines).toContain("tailscale");
  expect(hasAnsi(lines)).toBe(false);
});

test("renderHelp colorizes when a TTY is present", () => {
  expect(hasAnsi(renderHelp(true).join("\n"))).toBe(true);
});

test("renderBanner carries the loopback URL, the workspace and the access notice", () => {
  const out = renderBanner(
    { reach: [{ label: "url", value: "http://127.0.0.1:4317/?token=abc", established: true }], workspace: "/home/u/ws", notice: ["reachable from the network"] },
    false,
  ).join("\n");
  expect(out).toContain("http://127.0.0.1:4317/?token=abc");
  expect(out).toContain("/home/u/ws");
  expect(out).toContain("reachable from the network");
  expect(hasAnsi(out)).toBe(false);
});

test("renderBanner never prints localhost off loopback: each reach row is either an established address or a declared non-establishment", () => {
  const out = renderBanner(
    {
      reach: [
        { label: "lan", value: "http://192.168.1.42:4317/?token=abc", established: true },
        { label: "tailscale", value: "not established — tailscale not installed, or not running", established: false },
      ],
      workspace: "/home/u/ws",
      notice: ["a token is required"],
    },
    false,
  ).join("\n");
  expect(out).toContain("http://192.168.1.42:4317/?token=abc");
  expect(out).toContain("not established — tailscale not installed, or not running");
  expect(out).not.toContain("localhost");
});

test("renderTailscale reports when no console is running for this workspace", () => {
  const out = renderTailscale({ state: "no-console", workspace: "/home/u/ws" }, false).join("\n").toLowerCase();
  expect(out).toMatch(/no console|not running/);
  expect(out).toContain("aipe serve");
});

test("renderTailscale reports the finished HTTPS URL once Serve confirms the forward", () => {
  const out = renderTailscale({ state: "ready", workspace: "/home/u/ws", host: "alien-wsl.seahorse-cobia.ts.net", token: "abc" }, false).join("\n");
  expect(out).toContain("https://alien-wsl.seahorse-cobia.ts.net/?token=abc");
});

test("renderTailscale surfaces a CLI failure plainly", () => {
  const out = renderTailscale({ state: "failed", workspace: "/home/u/ws", reason: "tailscale: not logged in" }, false).join("\n");
  expect(out).toContain("tailscale: not logged in");
});

test("renderStatus shows pid/port/workspace/since for a running console", () => {
  const out = renderStatus([entry({ pid: 4242, port: 4317 })], "/home/u/ws", 61_000, false).join("\n");
  expect(out).toContain("4242");
  expect(out).toContain("4317");
  expect(out).toContain("/home/u/ws");
  expect(out).toContain("running");
});

test("renderStatus says plainly when nothing is running", () => {
  const out = renderStatus([], "/home/u/ws", 0, false).join("\n").toLowerCase();
  expect(out).toContain("no");
  expect(out).toMatch(/not running|nothing/);
});

test("renderStop reports what it stopped, and is explicit about a no-op", () => {
  const stopped = renderStop([4242, 4243], "/home/u/ws", false).join("\n");
  expect(stopped).toContain("4242");
  expect(stopped).toContain("4243");
  const noop = renderStop([], "/home/u/ws", false).join("\n").toLowerCase();
  expect(noop).toMatch(/nothing to stop|no .*running/);
});

test("liveLine reflects the connected-client count", () => {
  expect(liveLine(0, false)).toMatch(/0|waiting|no client/i);
  expect(liveLine(2, false)).toContain("2");
  expect(hasAnsi(liveLine(2, true))).toBe(true);
});
