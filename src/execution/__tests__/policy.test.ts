import { expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultExecutionPolicy, readExecutionPolicy } from "../policy";

async function ws(yaml?: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "aipe-execpol-"));
  if (yaml !== undefined) {
    await mkdir(join(dir, ".aipe"), { recursive: true });
    await writeFile(join(dir, ".aipe", "execution-policy.yaml"), yaml, "utf8");
  }
  return dir;
}

test("the defaults are conservative", () => {
  expect(defaultExecutionPolicy()).toEqual({
    maxSessionsPerWave: 4,
    gateAboveSessions: 2,
    gatedIntensities: ["ultracode"],
    gatedTiers: ["frontier"],
    maxCostIndexPerWave: 24,
  });
});

test("an absent file yields the defaults", async () => {
  expect(await readExecutionPolicy(await ws())).toEqual(defaultExecutionPolicy());
});

test("a malformed file yields the defaults rather than throwing", async () => {
  expect(await readExecutionPolicy(await ws("]["))).toEqual(defaultExecutionPolicy());
});

test("a partial file overrides only what it names", async () => {
  const p = await readExecutionPolicy(await ws("gateAboveSessions: 1\n"));
  expect(p.gateAboveSessions).toBe(1);
  expect(p.maxSessionsPerWave).toBe(4);
});

test("maxSessionsPerWave is clamped to the dispatch law's ceiling, never raised past it", async () => {
  const p = await readExecutionPolicy(await ws("maxSessionsPerWave: 99\n"));
  expect(p.maxSessionsPerWave).toBe(4);
});

test("a nonsensical value is ignored rather than accepted", async () => {
  const p = await readExecutionPolicy(await ws("maxCostIndexPerWave: -5\n"));
  expect(p.maxCostIndexPerWave).toBe(24);
});

test("a gateAboveSessions at or above maxSessionsPerWave would never fire, so it is clamped down", async () => {
  const p = await readExecutionPolicy(await ws("gateAboveSessions: 999\n"));
  expect(p.maxSessionsPerWave).toBe(4);
  expect(p.gateAboveSessions).toBe(3);
});

test("the clamp tracks an overridden maxSessionsPerWave, not just the default", async () => {
  const p = await readExecutionPolicy(await ws("maxSessionsPerWave: 2\ngateAboveSessions: 999\n"));
  expect(p.maxSessionsPerWave).toBe(2);
  expect(p.gateAboveSessions).toBe(1);
});

test("a top-level YAML array is rejected explicitly, not by accident of property access", async () => {
  const p = await readExecutionPolicy(await ws("- maxSessionsPerWave: 1\n- gateAboveSessions: 1\n"));
  expect(p).toEqual(defaultExecutionPolicy());
});
