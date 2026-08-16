import { expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { confirmCommand, probeCommand, run, showCommand } from "../cli";
import { readCapabilities } from "../store";
import type { ProbeRunner } from "../types";

const NOW = "2026-08-15T00:00:00.000Z";
const only = (present: string[]): ProbeRunner => async (bin) =>
  present.includes(bin) ? { code: 0, stdout: `${bin} 1.2.3`, stderr: "" } : { code: 127, stdout: "", stderr: "" };

const UNCONFIRMED_NOTE =
  "NOTE capabilities: probed, not confirmed — a binary on PATH is not an authenticated binary. Run `aipe capabilities confirm` once you have checked.";

async function writeRawCaps(dir: string, yaml: string): Promise<void> {
  await mkdir(join(dir, ".aipe"), { recursive: true });
  await writeFile(join(dir, ".aipe", "capabilities.yaml"), yaml, "utf8");
}

// One well-formed entry plus one malformed entry — the same shape
// store.test.ts uses to exercise `dropped: 1` on readCapabilities.
const ONE_GOOD_ONE_BAD = [
  "confirmed: false",
  "harnesses:",
  "  - id: claude-code",
  "    bin: claude",
  "    present: true",
  "    version: 5.0.0",
  "    source: probe",
  `    checkedAt: "${NOW}"`,
  "  - {}",
].join("\n");

const ONE_GOOD_TWO_BAD = [
  "confirmed: false",
  "harnesses:",
  "  - id: claude-code",
  "    bin: claude",
  "    present: true",
  "    version: 5.0.0",
  "    source: probe",
  `    checkedAt: "${NOW}"`,
  "  - {}",
  "  - missing: fields",
].join("\n");

test("probe writes the file and reports what it found", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-capscli-"));
  const r = await probeCommand(dir, only(["claude", "gemini"]), NOW);
  expect(r.code).toBe(0);
  expect(r.lines).toEqual([
    "OK claude-code claude 1.2.3",
    "OK gemini gemini 1.2.3",
    "-- codex codex absent",
    "-- copilot copilot absent",
    UNCONFIRMED_NOTE,
  ]);
  const result = await readCapabilities(dir);
  expect(result!.capabilities.confirmed).toBe(false);
  expect(result!.dropped).toBe(0);
});

test("confirm marks the file as the PE's word", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-capscli-"));
  await probeCommand(dir, only(["claude"]), NOW);
  const r = await confirmCommand(dir, NOW);
  expect(r.code).toBe(0);
  expect(r.lines).toEqual(["OK capabilities confirmed 4 harnesses"]);
  const result = await readCapabilities(dir);
  expect(result!.capabilities.confirmed).toBe(true);
  expect(result!.capabilities.harnesses.every((h) => h.source === "pe-confirmed")).toBe(true);
  expect(result!.dropped).toBe(0);
});

test("confirm with no file errors rather than confirming nothing", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-capscli-"));
  const r = await confirmCommand(dir, NOW);
  expect(r.code).toBe(1);
  expect(r.lines).toEqual(["ERROR capabilities: nothing to confirm — run `aipe capabilities probe` first"]);
});

test("confirm on a degraded record warns about the dropped entries, then confirms what's left", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-capscli-"));
  await writeRawCaps(dir, ONE_GOOD_ONE_BAD);
  const r = await confirmCommand(dir, NOW);
  expect(r.code).toBe(0);
  expect(r.lines).toEqual([
    "WARN capabilities: 1 malformed entry discarded from the record — it may be missing a harness; re-run `aipe capabilities probe` to rebuild it",
    "NOTE: 1 malformed entries have been permanently removed from the record. Confirmation applies only to the 1 remaining entries.",
    "OK capabilities confirmed 1 harnesses",
  ]);
  const result = await readCapabilities(dir);
  expect(result!.dropped).toBe(0); // confirm rewrites the file, so the bad entry is gone for good.
  expect(result!.capabilities).toEqual({
    confirmed: true,
    harnesses: [{ id: "claude-code", bin: "claude", present: true, version: "5.0.0", source: "pe-confirmed", checkedAt: NOW }],
  });
});

test("show with no file errors rather than showing nothing", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-capscli-"));
  const r = await showCommand(dir, only(["claude"]), NOW);
  expect(r.code).toBe(1);
  expect(r.lines).toEqual(["ERROR capabilities: no record — run `aipe capabilities probe` first"]);
});

test("show on a degraded record warns about the dropped entries", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-capscli-"));
  await writeRawCaps(dir, ONE_GOOD_ONE_BAD);
  const r = await showCommand(dir, only(["claude"]), NOW);
  expect(r.code).toBe(0);
  expect(r.lines).toEqual([
    "WARN capabilities: 1 malformed entry discarded from the record — it may be missing a harness; re-run `aipe capabilities probe` to rebuild it",
    `OK claude-code claude 5.0.0 (probe ${NOW})`,
    UNCONFIRMED_NOTE,
  ]);
});

test("show reports drift when a recorded harness has since disappeared", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-capscli-"));
  await probeCommand(dir, only(["claude", "gemini"]), NOW);
  const r = await showCommand(dir, only(["claude"]), NOW);
  expect(r.code).toBe(2);
  expect(r.lines).toEqual([
    `OK claude-code claude 1.2.3 (probe ${NOW})`,
    `OK gemini gemini 1.2.3 (probe ${NOW})`,
    `-- codex codex unversioned (probe ${NOW})`,
    `-- copilot copilot unversioned (probe ${NOW})`,
    "DRIFT gemini — recorded present, now absent. Re-run `aipe capabilities probe`.",
    UNCONFIRMED_NOTE,
  ]);
});

test("show reports drift when a harness recorded absent is now present", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-capscli-"));
  await probeCommand(dir, only(["claude"]), NOW);
  const r = await showCommand(dir, only(["claude", "gemini"]), NOW);
  expect(r.code).toBe(2);
  expect(r.lines).toEqual([
    `OK claude-code claude 1.2.3 (probe ${NOW})`,
    `-- gemini gemini unversioned (probe ${NOW})`,
    `-- codex codex unversioned (probe ${NOW})`,
    `-- copilot copilot unversioned (probe ${NOW})`,
    "DRIFT gemini — recorded absent, now present. Re-run `aipe capabilities probe`.",
    UNCONFIRMED_NOTE,
  ]);
});

test("show reports drift when a fresh probe finds a harness the record never mentioned at all", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-capscli-"));
  await writeRawCaps(
    dir,
    ["confirmed: false", "harnesses:", "  - id: claude-code", "    bin: claude", "    present: true", "    version: 5.0.0", "    source: probe", `    checkedAt: "${NOW}"`].join(
      "\n",
    ),
  );
  const r = await showCommand(dir, only(["claude", "gemini"]), NOW);
  expect(r.code).toBe(2);
  expect(r.lines).toEqual([
    `OK claude-code claude 5.0.0 (probe ${NOW})`,
    "DRIFT gemini — not recorded, now present. Re-run `aipe capabilities probe`.",
    UNCONFIRMED_NOTE,
  ]);
});

test("show with no drift exits 0", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-capscli-"));
  await probeCommand(dir, only(["claude"]), NOW);
  const r = await showCommand(dir, only(["claude"]), NOW);
  expect(r.code).toBe(0);
  expect(r.lines).toEqual([
    `OK claude-code claude 1.2.3 (probe ${NOW})`,
    `-- gemini gemini unversioned (probe ${NOW})`,
    `-- codex codex unversioned (probe ${NOW})`,
    `-- copilot copilot unversioned (probe ${NOW})`,
    UNCONFIRMED_NOTE,
  ]);
});

test("show with drift and unconfirmed note places the note at the end", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-capscli-"));
  await probeCommand(dir, only(["claude", "gemini"]), NOW);
  const r = await showCommand(dir, only(["claude"]), NOW);
  expect(r.code).toBe(2);
  // Verify UNCONFIRMED_NOTE is the final element when both drift and note exist
  expect(r.lines[r.lines.length - 1]).toBe(UNCONFIRMED_NOTE);
  expect(r.lines).toEqual([
    `OK claude-code claude 1.2.3 (probe ${NOW})`,
    `OK gemini gemini 1.2.3 (probe ${NOW})`,
    `-- codex codex unversioned (probe ${NOW})`,
    `-- copilot copilot unversioned (probe ${NOW})`,
    "DRIFT gemini — recorded present, now absent. Re-run `aipe capabilities probe`.",
    UNCONFIRMED_NOTE,
  ]);
});

test("droppedWarning handles plural correctly", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-capscli-"));
  await writeRawCaps(dir, ONE_GOOD_TWO_BAD);
  const r = await confirmCommand(dir, NOW);
  expect(r.code).toBe(0);
  expect(r.lines).toEqual([
    "WARN capabilities: 2 malformed entries discarded from the record — it may be missing a harness; re-run `aipe capabilities probe` to rebuild it",
    "NOTE: 2 malformed entries have been permanently removed from the record. Confirmation applies only to the 1 remaining entries.",
    "OK capabilities confirmed 1 harnesses",
  ]);
});

test("run with no args prints help and returns 0", async () => {
  const logs: string[] = [];
  const originalLog = console.log;
  console.log = (...args: unknown[]) => {
    logs.push(args.join(" "));
  };
  try {
    const code = await run([]);
    expect(code).toBe(0);
    expect(logs.join("\n")).toContain("aipe capabilities");
  } finally {
    console.log = originalLog;
  }
});

test("run with --help prints help and returns 0", async () => {
  const logs: string[] = [];
  const originalLog = console.log;
  console.log = (...args: unknown[]) => {
    logs.push(args.join(" "));
  };
  try {
    const code = await run(["--help"]);
    expect(code).toBe(0);
    expect(logs.join("\n")).toContain("aipe capabilities");
  } finally {
    console.log = originalLog;
  }
});

test("run with unknown subcommand returns non-zero", async () => {
  const logs: string[] = [];
  const originalLog = console.log;
  console.log = (...args: unknown[]) => {
    logs.push(args.join(" "));
  };
  try {
    const code = await run(["bogus"]);
    expect(code).toBe(1);
  } finally {
    console.log = originalLog;
  }
});
