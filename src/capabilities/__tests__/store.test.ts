import { expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { confirm, drift, fromProbes, readCapabilities, writeCapabilities } from "../store";

const NOW = "2026-08-15T00:00:00.000Z";

async function writeRawCaps(dir: string, yaml: string): Promise<void> {
  await mkdir(join(dir, ".aipe"), { recursive: true });
  await writeFile(join(dir, ".aipe", "capabilities.yaml"), yaml, "utf8");
}

test("a missing file reads as null, never a throw", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-caps-"));
  expect(await readCapabilities(dir)).toBeNull();
});

test("harnesses as a non-array reads as null", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-caps-"));
  await writeRawCaps(dir, "harnesses: nope\nconfirmed: false\n");
  expect(await readCapabilities(dir)).toBeNull();
});

test("a bare scalar document reads as null", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-caps-"));
  await writeRawCaps(dir, "42\n");
  expect(await readCapabilities(dir)).toBeNull();
});

test("a top-level array document (no `harnesses` key to find) reads as null", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-caps-"));
  await writeRawCaps(dir, "[]\n");
  expect(await readCapabilities(dir)).toBeNull();
});

test("a malformed harness entry is dropped, the well-formed ones are kept", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-caps-"));
  await writeRawCaps(
    dir,
    [
      "confirmed: false",
      "harnesses:",
      "  - id: claude-code",
      "    bin: claude",
      "    present: true",
      "    version: 5.0.0",
      "    source: probe",
      `    checkedAt: "${NOW}"`,
      "  - id: x",
      "    bin: y",
      '    present: "yes"',
      "    version: 1",
      "    source: made-up",
      "    checkedAt: 5",
      "  - {}",
    ].join("\n"),
  );
  expect(await readCapabilities(dir)).toEqual({
    confirmed: false,
    harnesses: [
      { id: "claude-code", bin: "claude", present: true, version: "5.0.0", source: "probe", checkedAt: NOW },
    ],
  });
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

test("capabilities round-trip through the file with present: false and version: null", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-caps-"));
  const caps = fromProbes([{ bin: "codex", present: false, version: null }], NOW);
  await writeCapabilities(dir, caps);
  expect(await readCapabilities(dir)).toEqual(caps);
});

test("fromProbes skips a bin that isn't in PROBED_HARNESSES", () => {
  const caps = fromProbes(
    [
      { bin: "claude", present: true, version: "5.0.0" },
      { bin: "some-unknown-tool", present: true, version: "1.0.0" },
    ],
    NOW,
  );
  expect(caps.harnesses).toEqual([
    { id: "claude-code", bin: "claude", present: true, version: "5.0.0", source: "probe", checkedAt: NOW },
  ]);
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

test("drift names a harness the record has never seen when the fresh probe finds it present", () => {
  const recorded = fromProbes([{ bin: "claude", present: true, version: "5.0.0" }], NOW);
  const fresh = [
    { bin: "claude", present: true, version: "5.0.0" },
    { bin: "gemini", present: true, version: "3.1.0" },
  ];
  expect(drift(recorded, fresh)).toEqual(["gemini"]);
});

test("an unrecorded harness the fresh probe finds absent is not drift", () => {
  const recorded = fromProbes([{ bin: "claude", present: true, version: "5.0.0" }], NOW);
  const fresh = [
    { bin: "claude", present: true, version: "5.0.0" },
    { bin: "gemini", present: false, version: null },
  ];
  expect(drift(recorded, fresh)).toEqual([]);
});

test("a recorded harness absent from a partial fresh list is not drift", () => {
  const recorded = fromProbes(
    [
      { bin: "claude", present: true, version: "5.0.0" },
      { bin: "gemini", present: true, version: "3.1.0" },
    ],
    NOW,
  );
  // fresh only re-checked claude; gemini simply wasn't probed this round.
  expect(drift(recorded, [{ bin: "claude", present: true, version: "5.0.0" }])).toEqual([]);
});
