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

test("qa-failed is surfaced as critical; escalated as warning; critical ranks first", async () => {
  const dir = await ws([
    { repo: "embark", specialist: "Caio", branch: "b", worktree: "w", status: "escalated" },
    { repo: "embark", package: "api", specialist: "Ana", branch: "b", worktree: "w", status: "failed" },
  ]);
  try {
    const att = (await buildSnapshot(dir)).attention;
    expect(att).toHaveLength(2);
    expect(att[0]).toMatchObject({ kind: "qa-failed", severity: "critical", unit: "embark/api" });
    expect(att[1]).toMatchObject({ kind: "escalated", severity: "warning", unit: "embark" });
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
