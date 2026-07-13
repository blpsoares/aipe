import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stringify } from "yaml";
import { buildSnapshot } from "../snapshot";

async function ws(dispatches: unknown[]): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "aipe-att-"));
  await mkdir(join(dir, ".aipe", "journeys"), { recursive: true });
  await writeFile(
    join(dir, ".aipe", "brain.yaml"),
    stringify({ context: { name: "opvibes", coordinator: "Nic" }, repos: [{ name: "embark", url: "u", path: "./embark" }] }),
    "utf8",
  );
  await writeFile(join(dir, ".aipe", "journeys", "j1.yaml"), stringify({ id: "j1", dispatches }), "utf8");
  return dir;
}

test("clean board → no attention", async () => {
  const dir = await ws([
    { repo: "embark", specialist: "Ana", branch: "b", worktree: "w", status: "verified", evidence: { by: "qa", commands: ["bun test"], summary: "ok" } },
  ]);
  try {
    expect((await buildSnapshot(dir)).attention).toEqual([]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a failed unit surfaces as critical; escalated as warning; critical ranks first", async () => {
  const dir = await ws([
    { repo: "embark", specialist: "Caio", branch: "b", worktree: "w", status: "escalated" },
    { repo: "embark", package: "api", specialist: "Ana", branch: "b", worktree: "w", status: "failed" },
  ]);
  try {
    const att = (await buildSnapshot(dir)).attention;
    expect(att).toHaveLength(2);
    // same finding codes as `aipe journey verify`, filtered to what needs the PE now
    expect(att[0]).toMatchObject({ kind: "failed-open", severity: "critical", unit: "embark/api" });
    expect(att[1]).toMatchObject({ kind: "escalated-open", severity: "warning", unit: "embark" });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a delivered/verified record with no evidence is surfaced (legacy/hand-edited ledger)", async () => {
  const dir = await ws([
    { repo: "embark", specialist: "Ana", branch: "b", worktree: "w", status: "delivered" }, // no evidence
  ]);
  try {
    const att = (await buildSnapshot(dir)).attention;
    expect(att).toHaveLength(1);
    expect(att[0]).toMatchObject({ kind: "no-evidence", unit: "embark" });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a consumer shipped before its producer landed surfaces as critical (dependency-not-landed)", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-att-"));
  try {
    await mkdir(join(dir, ".aipe", "journeys"), { recursive: true });
    await mkdir(join(dir, ".aipe", "relations"), { recursive: true });
    await writeFile(
      join(dir, ".aipe", "brain.yaml"),
      stringify({ context: { name: "o", coordinator: "N" }, repos: [{ name: "embark", url: "u", path: "./embark" }, { name: "prontuario", url: "u", path: "./prontuario" }] }),
      "utf8",
    );
    // embark consumes prontuario; embark shipped (verified w/ evidence) but prontuario never landed
    await writeFile(
      join(dir, ".aipe", "relations", "graph.yaml"),
      stringify({
        nodes: [{ fqid: "embark", repo: "embark", package: null, stack: [] }, { fqid: "prontuario", repo: "prontuario", package: null, stack: [] }],
        edges: [{ from: "embark", to: "prontuario", type: "consumes", perspectives: [{ detail: "d", evidence: "e" }] }],
      }),
      "utf8",
    );
    await writeFile(
      join(dir, ".aipe", "journeys", "j1.yaml"),
      stringify({ id: "j1", dispatches: [{ repo: "embark", specialist: "Ana", branch: "b", worktree: "w", status: "verified", evidence: { by: "qa", commands: ["bun test"], summary: "ok" } }] }),
      "utf8",
    );
    const att = (await buildSnapshot(dir)).attention;
    expect(att.some((a) => a.kind === "dependency-not-landed" && a.unit === "embark")).toBe(true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
