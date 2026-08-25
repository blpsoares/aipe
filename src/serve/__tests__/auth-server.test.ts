import { afterAll, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { COOKIE_NAME } from "../auth";
import { accessNotice } from "../cli";
import { startServer } from "../server";

const ws = await mkdtemp(join(tmpdir(), "aipe-auth-srv-"));
const TOKEN = "test-token-value";

// Port 0 lets the OS pick, so the suite never collides with a real console.
const guarded = startServer({ workspace: ws, port: 0, host: "0.0.0.0", token: TOKEN });
const open = startServer({ workspace: ws, port: 0, host: "127.0.0.1" });

afterAll(() => {
  guarded.stop(true);
  open.stop(true);
});

const g = (path: string, init?: RequestInit) => fetch(`http://127.0.0.1:${guarded.port}${path}`, init);

test("off loopback, the workspace snapshot is refused without a token", async () => {
  // This is the hole: /api/snapshot returns the entire workspace — repos,
  // personas, journeys — and it answered anyone on the network.
  const res = await g("/api/snapshot");
  expect(res.status).toBe(401);
  expect(await res.text()).toContain("token");
});

test("off loopback, the specialist monitor stream is refused without a token", async () => {
  // Worse than the snapshot: /api/monitor streams the code specialists are
  // writing, `Write` file contents included.
  const res = await g("/api/monitor");
  expect(res.status).toBe(401);
  await res.body?.cancel();
});

test("off loopback, even the page itself is refused", async () => {
  expect((await g("/")).status).toBe(401);
});

test("a wrong token is refused", async () => {
  expect((await g("/api/snapshot?token=wrong")).status).toBe(401);
});

test("the right token in the URL works and hands back a session cookie", async () => {
  const res = await g(`/api/snapshot?token=${TOKEN}`);
  expect(res.status).toBe(200);
  const cookie = res.headers.get("set-cookie") ?? "";
  expect(cookie).toContain(`${COOKIE_NAME}=${TOKEN}`);
  expect(cookie).toContain("HttpOnly");
});

test("the session cookie alone is enough for the SPA's own calls", async () => {
  // The client fetches /api/snapshot with no query string, so without the
  // cookie the page would load and then 401 on everything it does.
  const res = await g("/api/snapshot", { headers: { cookie: `${COOKIE_NAME}=${TOKEN}` } });
  expect(res.status).toBe(200);
});

test("a bearer token works, for scripts and curl", async () => {
  const res = await g("/api/snapshot", { headers: { authorization: `Bearer ${TOKEN}` } });
  expect(res.status).toBe(200);
});

test("a guarded server with an empty token refuses everything rather than serving open", async () => {
  const broken = startServer({ workspace: ws, port: 0, host: "0.0.0.0", token: "" });
  try {
    expect((await fetch(`http://127.0.0.1:${broken.port}/api/snapshot`)).status).toBe(401);
    expect((await fetch(`http://127.0.0.1:${broken.port}/api/snapshot?token=`)).status).toBe(401);
  } finally {
    broken.stop(true);
  }
});

test("on loopback nothing changes — no token, no cookie", async () => {
  const res = await fetch(`http://127.0.0.1:${open.port}/api/snapshot`);
  expect(res.status).toBe(200);
  expect(res.headers.get("set-cookie")).toBeNull();
});

test("--insecure serves an open console off loopback, deliberately", async () => {
  const insecure = startServer({ workspace: ws, port: 0, host: "0.0.0.0", insecure: true });
  try {
    expect((await fetch(`http://127.0.0.1:${insecure.port}/api/snapshot`)).status).toBe(200);
  } finally {
    insecure.stop(true);
  }
});

test("the operator is told who can reach the console", () => {
  expect(accessNotice("127.0.0.1", false, "AIPE_SERVE_TOKEN")).toEqual([]); // nothing to say
  expect(accessNotice("0.0.0.0", false, "AIPE_SERVE_TOKEN").join(" ")).toContain("token is required");
  // An open console must never be quiet about it.
  expect(accessNotice("0.0.0.0", true, "AIPE_SERVE_TOKEN").join(" ")).toContain("WARNING");
});
