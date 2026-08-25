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

// Capture what `run` prints, so we can assert the resolved MODEL line.
async function captureRun(args: string[]): Promise<{ code: number; out: string[] }> {
  const out: string[] = [];
  const original = console.log;
  console.log = (...a: unknown[]) => { out.push(a.map(String).join(" ")); };
  try {
    const code = await run(args);
    return { code, out };
  } finally {
    console.log = original;
  }
}

// D4: `model resolve --harness gemini` returned MODEL=claude-sonnet-5 because
// resolveCmd never read `--harness` at all — it always used the workspace's
// adapter. Each adapter has its OWN tier→model table (geminiAdapter maps
// standard → gemini-3-flash-preview), so this is a genuine defect: an explicit
// `--harness` must resolve to THAT harness's model id, not silently a Claude one.
test("model resolve --harness gemini resolves to gemini's own model id, not a Claude one (D4)", async () => {
  const { out } = await captureRun(["resolve", "--tier", "standard", "--harness", "gemini"]);
  const modelLine = out.find((l) => l.startsWith("MODEL="));
  expect(modelLine).toContain("gemini-3-flash-preview");
  expect(modelLine).not.toContain("claude");
});

test("model resolve without --harness still uses the workspace adapter (default claude-code)", async () => {
  const { out } = await captureRun(["resolve", "--tier", "standard"]);
  const modelLine = out.find((l) => l.startsWith("MODEL="));
  expect(modelLine).toContain("claude-sonnet-5");
});

// A `--harness` that names no known adapter must fail loudly, not fall back to
// silently resolving a Claude id (which is exactly the class of silent wrong
// answer D4 is about).
test("model resolve --harness with an unknown harness errors explicitly", async () => {
  const { code, out } = await captureRun(["resolve", "--tier", "standard", "--harness", "borg"]);
  expect(code).toBe(1);
  expect(out.some((l) => l.startsWith("ERROR harness"))).toBe(true);
});
