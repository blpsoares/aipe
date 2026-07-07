import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stringify } from "yaml";
import { claudeCodeAdapter } from "../../harness/claude-code";
import { genericAdapter } from "../../harness/generic";
import type { JourneyLedger } from "../../journey/types";
import { checkVolume } from "../check";
import { defaultPolicy, readPolicy } from "../policy";
import { gateFor, resolveModel } from "../resolve";

test("adapters map tiers to concrete models (Claude Code) / null (generic)", () => {
  expect(claudeCodeAdapter.resolveModel("fast")?.id).toBe("claude-haiku-4-5-20251001");
  expect(claudeCodeAdapter.resolveModel("standard")?.id).toBe("claude-sonnet-5");
  expect(claudeCodeAdapter.resolveModel("reasoning")?.id).toBe("claude-opus-4-8");
  expect(claudeCodeAdapter.resolveModel("frontier")?.id).toBe("claude-fable-5");
  expect(claudeCodeAdapter.resolveModel("bogus")).toBeNull();
  expect(genericAdapter.resolveModel("reasoning")).toBeNull();
});

test("defaults: standard default, frontier gated, Opus notify at 8", () => {
  const p = defaultPolicy();
  expect(p.default).toBe("standard");
  expect(p.authorizationTiers).toEqual(["frontier"]);
  expect(p.reasoningNotifyMaxDispatches).toBe(8);
});

test("resolveModel reports the model + whether the tier requires authorization", () => {
  const p = defaultPolicy();
  const standard = resolveModel(p, claudeCodeAdapter, "standard");
  expect(standard).toEqual({ tier: "standard", model: "claude-sonnet-5", label: "Sonnet 5", requiresAuth: false });
  const frontier = resolveModel(p, claudeCodeAdapter, "frontier");
  expect(frontier.requiresAuth).toBe(true);
  expect(frontier.model).toBe("claude-fable-5");
});

test("gateFor: frontier needs authorization until granted; others are ok", () => {
  const p = defaultPolicy();
  expect(gateFor(p, "reasoning", new Set())).toBe("ok");
  expect(gateFor(p, "frontier", new Set())).toBe("needs-authorization");
  expect(gateFor(p, "frontier", new Set(["frontier"]))).toBe("ok");
});

test("checkVolume: notify only past the reasoning threshold", () => {
  const p = defaultPolicy(); // threshold 8
  const mk = (n: number): JourneyLedger => ({
    id: "j1",
    dispatches: Array.from({ length: n }, (_, i) => ({
      repo: "r", specialist: `s${i}`, branch: "b", worktree: "w", status: "dispatched" as const, tier: "reasoning",
    })),
  });
  expect(checkVolume(p, mk(8)).status).toBe("ok"); // 8 is not over 8
  const over = checkVolume(p, mk(9));
  expect(over.status).toBe("notify");
  expect(over.reasoningDispatches).toBe(9);
  // non-reasoning dispatches don't count
  expect(checkVolume(p, { id: "j", dispatches: [{ repo: "r", specialist: "s", branch: "b", worktree: "w", status: "dispatched", tier: "fast" }] }).status).toBe("ok");
});

test("readPolicy: absent → defaults; file overrides merge", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-mp-"));
  try {
    expect(await readPolicy(dir)).toEqual(defaultPolicy());
    await mkdir(join(dir, ".aipe"), { recursive: true });
    await writeFile(
      join(dir, ".aipe", "model-policy.yaml"),
      stringify({ default: "fast", gates: { frontier: "authorization", reasoning: "notify" }, notify: { reasoning: { maxDispatches: 3 } } }),
      "utf8",
    );
    const p = await readPolicy(dir);
    expect(p.default).toBe("fast");
    expect(p.reasoningNotifyMaxDispatches).toBe(3);
    expect(p.authorizationTiers).toEqual(["frontier"]); // only "authorization" gates
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
