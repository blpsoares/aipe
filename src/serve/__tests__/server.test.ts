import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stringify } from "yaml";
import { isLoopback, startServer } from "../server";
import type { BrainFile } from "../../context-brain/types";

async function ws(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "aipe-serve-"));
  const brain: BrainFile = { context: { name: "opvibes", coordinator: "Nicolas" }, repos: [{ name: "embark", url: "u", path: "./embark" }] };
  await mkdir(join(dir, ".aipe"), { recursive: true });
  await writeFile(join(dir, ".aipe", "brain.yaml"), stringify(brain), "utf8");
  return dir;
}

test("isLoopback recognizes loopback hosts only", () => {
  expect(isLoopback("127.0.0.1")).toBe(true);
  expect(isLoopback("localhost")).toBe(true);
  expect(isLoopback("::1")).toBe(true);
  expect(isLoopback("0.0.0.0")).toBe(false);
  expect(isLoopback("192.168.0.5")).toBe(false);
});

test("server serves the SPA, snapshot JSON, and an SSE snapshot event", async () => {
  const dir = await ws();
  const server = startServer({ workspace: dir, port: 0, host: "127.0.0.1" });
  const base = `http://127.0.0.1:${server.port}`;
  try {
    const index = await fetch(`${base}/`);
    expect(index.status).toBe(200);
    expect((await index.text()).toLowerCase()).toContain("aipe");

    const snap = await fetch(`${base}/api/snapshot`);
    const body = await snap.json();
    expect(body.context.name).toBe("opvibes");

    // read the first SSE event
    const stream = await fetch(`${base}/api/stream`);
    const reader = stream.body!.getReader();
    const dec = new TextDecoder();
    let buf = "";
    while (!buf.includes("event: snapshot")) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
    }
    await reader.cancel();
    expect(buf).toContain("event: snapshot");
    expect(buf).toContain("opvibes");
  } finally {
    server.stop(true);
    await rm(dir, { recursive: true, force: true });
  }
});
