import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stringify } from "yaml";
import { handleRequest } from "../handler";
import type { BrainFile } from "../../context-brain/types";

async function ws(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "aipe-handler-"));
  const brain: BrainFile = { context: { name: "opvibes", coordinator: "Nicolas" }, repos: [{ name: "embark", url: "u", path: "./embark" }] };
  await mkdir(join(dir, ".aipe"), { recursive: true });
  await writeFile(join(dir, ".aipe", "brain.yaml"), stringify(brain), "utf8");
  return dir;
}

const ctx = (workspace: string) => ({ workspace, html: "<!doctype html><title>AIPe</title>OK" });

test("GET / serves the SPA html", async () => {
  const dir = await ws();
  try {
    const res = await handleRequest(new Request("http://x/"), ctx(dir));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(await res.text()).toContain("AIPe");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("GET /api/snapshot returns the snapshot JSON", async () => {
  const dir = await ws();
  try {
    const res = await handleRequest(new Request("http://x/api/snapshot"), ctx(dir));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.context.name).toBe("opvibes");
    expect(Array.isArray(body.repoInfos)).toBe(true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("unknown path is 404", async () => {
  const dir = await ws();
  try {
    const res = await handleRequest(new Request("http://x/nope"), ctx(dir));
    expect(res.status).toBe(404);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
