import { expect, test } from "bun:test";
import { probeAll, probeBinary, PROBED_HARNESSES } from "../probe";
import { getAdapter } from "../../harness/registry";
import type { ProbeRunner } from "../types";

const ok = (out: string): ProbeRunner => async () => ({ code: 0, stdout: out, stderr: "" });
const missing: ProbeRunner = async () => { throw new Error("ENOENT"); };
const failing: ProbeRunner = async () => ({ code: 127, stdout: "", stderr: "not found" });

test("a present binary reports its version", async () => {
  const p = await probeBinary("gemini", ok("gemini 3.1.0"));
  expect(p).toEqual({ bin: "gemini", present: true, version: "3.1.0" });
});

test("a version string with no number is present but unversioned", async () => {
  const p = await probeBinary("gemini", ok("gemini (dev build)"));
  expect(p).toEqual({ bin: "gemini", present: true, version: null });
});

test("a missing binary is absent, never a throw", async () => {
  expect(await probeBinary("codex", missing)).toEqual({ bin: "codex", present: false, version: null });
});

test("a non-zero exit is absent, not a false positive", async () => {
  expect(await probeBinary("codex", failing)).toEqual({ bin: "codex", present: false, version: null });
});

test("probeAll covers every harness AIPe knows how to start", async () => {
  const all = await probeAll(ok("x 1.0.0"));
  expect(all.map((p) => p.bin).sort()).toEqual(["claude", "codex", "copilot", "gemini"]);
});

test("PROBED_HARNESSES maps exact adapter id→binary pairs", () => {
  expect(PROBED_HARNESSES).toEqual([
    { id: "claude-code", bin: "claude" },
    { id: "gemini", bin: "gemini" },
    { id: "codex", bin: "codex" },
    { id: "copilot", bin: "copilot" },
  ]);
});

test("every PROBED_HARNESSES id resolves to a registered adapter with matching id", () => {
  for (const entry of PROBED_HARNESSES) {
    const adapter = getAdapter(entry.id);
    expect(adapter.id).toBe(entry.id);
  }
});
