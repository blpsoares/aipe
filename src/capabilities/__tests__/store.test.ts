import { expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { confirm, drift, fromProbes, readCapabilities, writeCapabilities } from "../store";

const NOW = "2026-08-15T00:00:00.000Z";

test("a missing file reads as null, never a throw", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-caps-"));
  expect(await readCapabilities(dir)).toBeNull();
});

test("probes become capabilities tagged as unconfirmed probe results", async () => {
  const caps = fromProbes([{ bin: "claude", present: true, version: "5.0.0" }], NOW);
  expect(caps.confirmed).toBe(false);
  expect(caps.harnesses).toEqual([
    { id: "claude-code", bin: "claude", present: true, version: "5.0.0", source: "probe", checkedAt: NOW },
  ]);
});

test("capabilities round-trip through the file", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-caps-"));
  const caps = fromProbes([{ bin: "gemini", present: true, version: "3.1.0" }], NOW);
  await writeCapabilities(dir, caps);
  expect(await readCapabilities(dir)).toEqual(caps);
});

test("confirming marks every entry as the PE's word, not a probe's", () => {
  const caps = confirm(fromProbes([{ bin: "claude", present: true, version: "5.0.0" }], NOW), NOW);
  expect(caps.confirmed).toBe(true);
  expect(caps.harnesses[0]!.source).toBe("pe-confirmed");
});

test("drift names a harness whose fresh probe disagrees with the record", () => {
  const recorded = fromProbes([
    { bin: "claude", present: true, version: "5.0.0" },
    { bin: "gemini", present: true, version: "3.1.0" },
  ], NOW);
  const fresh = [
    { bin: "claude", present: true, version: "5.0.0" },
    { bin: "gemini", present: false, version: null },
  ];
  expect(drift(recorded, fresh)).toEqual(["gemini"]);
});

test("drift is empty when the record and a fresh probe agree", () => {
  const recorded = fromProbes([{ bin: "claude", present: true, version: "5.0.0" }], NOW);
  expect(drift(recorded, [{ bin: "claude", present: true, version: "5.0.0" }])).toEqual([]);
});

test("a version change alone is not drift — only presence is", () => {
  const recorded = fromProbes([{ bin: "claude", present: true, version: "5.0.0" }], NOW);
  expect(drift(recorded, [{ bin: "claude", present: true, version: "5.1.0" }])).toEqual([]);
});
