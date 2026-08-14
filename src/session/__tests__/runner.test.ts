import { expect, test } from "bun:test";
import { probe } from "../runner";
import type { AgentopRunner } from "../types";

const fake = (code: number, stdout: string): AgentopRunner =>
  async () => ({ code, stdout, stderr: "" });

test("a modern agentop probes ok", async () => {
  const r = await probe(fake(0, "agentop v1.9.0"));
  expect(r).toEqual({ present: true, version: "1.9.0", ok: true });
});

test("a newer agentop probes ok", async () => {
  const r = await probe(fake(0, "agentop v1.10.2"));
  expect(r.ok).toBe(true);
  expect(r.version).toBe("1.10.2");
});

test("an old agentop is present but not ok", async () => {
  const r = await probe(fake(0, "agentop v1.8.9"));
  expect(r.present).toBe(true);
  expect(r.ok).toBe(false);
  expect(r.reason).toBe("below-minimum 1.8.9 < 1.9.0");
});

test("a missing binary is absent and not ok", async () => {
  const r = await probe(async () => { throw new Error("ENOENT"); });
  expect(r).toEqual({ present: false, version: null, ok: false, reason: "not-installed" });
});

test("unparseable version output is not ok", async () => {
  const r = await probe(fake(0, "something else entirely"));
  expect(r.present).toBe(true);
  expect(r.ok).toBe(false);
  expect(r.reason).toBe("unreadable-version");
});
