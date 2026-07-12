import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stringify } from "yaml";
import { rehydrateToolbox } from "../toolbox";
import { RELIABILITY_FLOOR } from "../../toolbox/reliability-floor";

const vbd = RELIABILITY_FLOOR.find((f) => f.name === "verify-before-done")!;

test("rehydrate refreshes a stale reliability-floor skill from the binary", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-floorsync-"));
  try {
    await mkdir(join(dir, ".aipe"), { recursive: true });
    await mkdir(join(dir, "embark"), { recursive: true });
    await writeFile(
      join(dir, ".aipe", "brain.yaml"),
      stringify({ context: { name: "o", coordinator: "N" }, repos: [{ name: "embark", url: "u", path: "./embark" }] }),
      "utf8",
    );
    // catalog lists verify-before-done as installed; the published copy is STALE.
    await writeFile(
      join(dir, ".aipe", "toolbox.yaml"),
      stringify({ skills: [{ name: "verify-before-done", description: "old", objective: "old", whenToUse: "old", repos: ["embark"] }], mcps: [] }),
      "utf8",
    );
    await mkdir(join(dir, ".aipe", "skills", "verify-before-done"), { recursive: true });
    await writeFile(join(dir, ".aipe", "skills", "verify-before-done", "SKILL.md"), "STALE OLD CONTENT\n", "utf8");

    const rows = await rehydrateToolbox(dir);
    expect(rows).toContainEqual({ kind: "skill", name: "verify-before-done", status: "restored" });

    // both the published source and the repo copy now carry the binary's version
    const src = await readFile(join(dir, ".aipe", "skills", "verify-before-done", "SKILL.md"), "utf8");
    const inRepo = await readFile(join(dir, "embark", ".claude", "skills", "verify-before-done", "SKILL.md"), "utf8");
    expect(src).toBe(vbd.content);
    expect(inRepo).toBe(vbd.content);
    expect(src).not.toContain("STALE OLD CONTENT");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
