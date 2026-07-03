import { expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readReports } from "../reports";

test("reads and parses every valid report json file", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-rel-"));
  try {
    await writeFile(join(dir, "embark.json"), JSON.stringify({ repo: "embark", stack: ["typescript"], relations: [] }));
    await writeFile(join(dir, "prontuario.json"), JSON.stringify({ repo: "prontuario", stack: [], relations: [] }));
    const reports = await readReports(dir);
    expect(reports.map((r) => r.repo).sort()).toEqual(["embark", "prontuario"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("ignores non-json files", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-rel-"));
  try {
    await writeFile(join(dir, "embark.json"), JSON.stringify({ repo: "embark", stack: [], relations: [] }));
    await writeFile(join(dir, "notes.txt"), "hello");
    const reports = await readReports(dir);
    expect(reports).toHaveLength(1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("skips a malformed json file instead of throwing", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-rel-"));
  try {
    await writeFile(join(dir, "embark.json"), JSON.stringify({ repo: "embark", stack: [], relations: [] }));
    await writeFile(join(dir, "broken.json"), "{ not valid json");
    const reports = await readReports(dir);
    expect(reports).toHaveLength(1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("skips a json file missing required fields", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-rel-"));
  try {
    await writeFile(join(dir, "incomplete.json"), JSON.stringify({ repo: "embark" }));
    const reports = await readReports(dir);
    expect(reports).toHaveLength(0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("returns an empty list when the directory does not exist", async () => {
  const reports = await readReports("/tmp/aipe-does-not-exist-ever");
  expect(reports).toEqual([]);
});
