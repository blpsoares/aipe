import { expect, test } from "bun:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readReports } from "../reports";

test("reads and parses every valid report json file", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-gen-"));
  try {
    await writeFile(join(dir, "embark-dev-fullstack.json"), JSON.stringify({ repo: "embark", role: "dev-fullstack", name: "Joaquim", body: "b" }));
    await writeFile(join(dir, "embark-qa.json"), JSON.stringify({ repo: "embark", role: "qa", name: "Marina", body: "b" }));
    const reports = await readReports(dir);
    expect(reports.map((r) => r.name).sort()).toEqual(["Joaquim", "Marina"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("ignores non-json files", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-gen-"));
  try {
    await writeFile(join(dir, "embark-qa.json"), JSON.stringify({ repo: "embark", role: "qa", name: "Marina", body: "b" }));
    await writeFile(join(dir, "notes.txt"), "hello");
    const reports = await readReports(dir);
    expect(reports).toHaveLength(1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("skips a malformed json file instead of throwing", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-gen-"));
  try {
    await writeFile(join(dir, "embark-qa.json"), JSON.stringify({ repo: "embark", role: "qa", name: "Marina", body: "b" }));
    await writeFile(join(dir, "broken.json"), "{ not valid json");
    const reports = await readReports(dir);
    expect(reports).toHaveLength(1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("rejects a report with an out-of-enum role", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-gen-"));
  try {
    await writeFile(join(dir, "embark-lead.json"), JSON.stringify({ repo: "embark", role: "lead", name: "Someone", body: "b" }));
    const reports = await readReports(dir);
    expect(reports).toHaveLength(0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("rejects a report missing required fields", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-gen-"));
  try {
    await writeFile(join(dir, "incomplete.json"), JSON.stringify({ repo: "embark", role: "qa" }));
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
