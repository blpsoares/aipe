import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rehydrateFlowSkills } from "../flow-skills";
import { FLOW_SKILLS } from "../../harness/skills";
import { writeHarness } from "../../harness/registry";

const NAMES = Object.keys(FLOW_SKILLS);

async function tmp(): Promise<string> {
  return mkdtemp(join(tmpdir(), "aipe-fs-"));
}

test("fresh workspace: installs every coordinator flow-skill (claude-code)", async () => {
  const dir = await tmp();
  try {
    const rows = await rehydrateFlowSkills(dir);
    expect(rows.length).toBe(NAMES.length);
    expect(rows.every((r) => r.status === "installed")).toBe(true);
    // content matches the binary's embedded version, at the claude-code path
    const operate = await readFile(join(dir, ".claude", "skills", "operate", "SKILL.md"), "utf8");
    expect(operate).toBe(FLOW_SKILLS.operate!);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("stale skill is refreshed and reported updated; up-to-date one is unchanged", async () => {
  const dir = await tmp();
  try {
    // operate installed stale (old, weaker text); context-brain installed current
    await mkdir(join(dir, ".claude", "skills", "operate"), { recursive: true });
    await writeFile(join(dir, ".claude", "skills", "operate", "SKILL.md"), "old stale operate\n", "utf8");
    await mkdir(join(dir, ".claude", "skills", "context-brain"), { recursive: true });
    await writeFile(join(dir, ".claude", "skills", "context-brain", "SKILL.md"), FLOW_SKILLS["context-brain"]!, "utf8");

    const rows = await rehydrateFlowSkills(dir);
    const byName = Object.fromEntries(rows.map((r) => [r.name, r.status]));
    expect(byName.operate).toBe("updated");
    expect(byName["context-brain"]).toBe("unchanged");

    // the stale copy now carries the reinforced (#12) text
    const operate = await readFile(join(dir, ".claude", "skills", "operate", "SKILL.md"), "utf8");
    expect(operate).toBe(FLOW_SKILLS.operate!);
    expect(operate).toContain("Table of non-exceptions");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("re-running immediately is a no-op (all unchanged)", async () => {
  const dir = await tmp();
  try {
    await rehydrateFlowSkills(dir);
    const rows = await rehydrateFlowSkills(dir);
    expect(rows.every((r) => r.status === "unchanged")).toBe(true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("generic harness writes flow-skills under .aipe/flows/", async () => {
  const dir = await tmp();
  try {
    await writeHarness(dir, "generic");
    const rows = await rehydrateFlowSkills(dir);
    expect(rows.every((r) => r.status === "installed")).toBe(true);
    const operate = await readFile(join(dir, ".aipe", "flows", "operate.md"), "utf8");
    expect(operate).toBe(FLOW_SKILLS.operate!);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
