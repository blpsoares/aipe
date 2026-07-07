import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse, stringify } from "yaml";
import { run } from "../cli";
import { renderCheck, renderResolve } from "../cli";

test("renderResolve/renderCheck format the report lines", () => {
  const r = renderResolve({ tier: "frontier", model: "claude-fable-5", label: "Fable 5", requiresAuth: true }, "needs-authorization");
  expect(r).toContain("TIER=frontier");
  expect(r.some((l) => l.startsWith("MODEL=claude-fable-5"))).toBe(true);
  expect(r).toContain("GATE=needs-authorization");
  expect(renderCheck({ reasoningDispatches: 9, threshold: 8, status: "notify" })).toEqual(["REASONING=9/8", "STATE=notify"]);
});

async function ws(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "aipe-mpcli-"));
  await mkdir(join(dir, ".aipe", "journeys"), { recursive: true });
  return dir;
}

test("model resolve: reasoning is ok, frontier needs authorization then ok after authorize", async () => {
  const dir = await ws();
  try {
    await writeFile(join(dir, ".aipe", "journeys", "j1.yaml"), stringify({ id: "j1", dispatches: [], authorizations: [] }), "utf8");

    const reasoning = await run(["resolve", "--tier", "reasoning", "--workspace", dir]);
    expect(reasoning).toBe(0); // gate ok

    const frontierBefore = await run(["resolve", "--tier", "frontier", "--journey", "j1", "--workspace", dir]);
    expect(frontierBefore).toBe(1); // needs-authorization → non-zero

    const auth = await run(["authorize", "--journey", "j1", "--tier", "frontier", "--by", "PE", "--workspace", dir]);
    expect(auth).toBe(0);
    const ledger = parse(await readFile(join(dir, ".aipe", "journeys", "j1.yaml"), "utf8"));
    expect(ledger.authorizations).toEqual([{ tier: "frontier", grantedBy: "PE" }]);

    const frontierAfter = await run(["resolve", "--tier", "frontier", "--journey", "j1", "--workspace", dir]);
    expect(frontierAfter).toBe(0); // granted → ok
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("model check: exits non-zero (notify) once Opus volume passes the threshold", async () => {
  const dir = await ws();
  try {
    const dispatches = Array.from({ length: 9 }, (_, i) => ({ repo: "r", specialist: `s${i}`, branch: "b", worktree: "w", status: "dispatched", tier: "reasoning" }));
    await writeFile(join(dir, ".aipe", "journeys", "j1.yaml"), stringify({ id: "j1", dispatches }), "utf8");
    expect(await run(["check", "--journey", "j1", "--workspace", dir])).toBe(1); // notify
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("model resolve rejects an unknown tier", async () => {
  expect(await run(["resolve", "--tier", "genius"])).toBe(1);
});
