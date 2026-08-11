import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readHandoffReports } from "../reports";

test("reads and parses every valid report json file", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-handoff-rep-"));
  try {
    await writeFile(
      join(dir, "embark.json"),
      JSON.stringify({ repo: "embark", purpose: "worker service", stack: ["typescript"], relations: [] }),
    );
    const reports = await readHandoffReports(dir);
    expect(reports).toEqual([{ repo: "embark", purpose: "worker service", stack: ["typescript"], relations: [] }]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("rejects a report missing `purpose`", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-handoff-rep-"));
  try {
    await writeFile(join(dir, "embark.json"), JSON.stringify({ repo: "embark", stack: [], relations: [] }));
    const reports = await readHandoffReports(dir);
    expect(reports).toHaveLength(0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("rejects a report whose relations contain an out-of-enum type", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-handoff-rep-"));
  try {
    await writeFile(
      join(dir, "embark.json"),
      JSON.stringify({
        repo: "embark",
        purpose: "worker service",
        stack: [],
        relations: [{ to: "other", type: "depends-on", detail: "x", evidence: "y" }],
      }),
    );
    const reports = await readHandoffReports(dir);
    expect(reports).toHaveLength(0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("skips a malformed json file instead of throwing", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-handoff-rep-"));
  try {
    await writeFile(
      join(dir, "embark.json"),
      JSON.stringify({ repo: "embark", purpose: "worker service", stack: [], relations: [] }),
    );
    await writeFile(join(dir, "broken.json"), "{ not valid json");
    const reports = await readHandoffReports(dir);
    expect(reports).toHaveLength(1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("ignores non-json files", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-handoff-rep-"));
  try {
    await writeFile(
      join(dir, "embark.json"),
      JSON.stringify({ repo: "embark", purpose: "worker service", stack: [], relations: [] }),
    );
    await writeFile(join(dir, "notes.txt"), "hello");
    const reports = await readHandoffReports(dir);
    expect(reports).toHaveLength(1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("returns an empty list when the directory does not exist", async () => {
  const reports = await readHandoffReports("/tmp/aipe-handoff-does-not-exist-ever");
  expect(reports).toEqual([]);
});
