import { expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stringify } from "yaml";
import { startServer } from "../server";
import type { BrainFile } from "../../context-brain/types";

async function ws(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "aipe-serve-oc-"));
  const brain: BrainFile = { context: { name: "opvibes", coordinator: "Nicolas" }, repos: [{ name: "embark", url: "u", path: "./embark" }] };
  await mkdir(join(dir, ".aipe"), { recursive: true });
  await writeFile(join(dir, ".aipe", "brain.yaml"), stringify(brain), "utf8");
  return dir;
}

test("onClients tracks live SSE clients as they connect and disconnect", async () => {
  const dir = await ws();
  const counts: number[] = [];
  const server = startServer({ workspace: dir, port: 0, host: "127.0.0.1", onClients: (n) => counts.push(n) });
  const base = `http://127.0.0.1:${server.port}`;
  try {
    const ctrl = new AbortController();
    const res = await fetch(`${base}/api/stream`, { signal: ctrl.signal });
    // Read one chunk so the stream is fully established before we assert.
    const reader = res.body!.getReader();
    await reader.read();
    expect(counts.at(-1)).toBe(1);
    ctrl.abort();
    // Give the server a tick to run the stream's cancel handler.
    await new Promise((r) => setTimeout(r, 50));
    expect(counts.at(-1)).toBe(0);
  } finally {
    server.stop(true);
  }
});
