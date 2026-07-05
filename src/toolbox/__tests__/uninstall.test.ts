import { expect, test } from "bun:test";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stringify } from "yaml";
import { readToolbox } from "../catalog";
import { installSkill, removeSkill } from "../skills";
import { installMcp, removeMcp } from "../mcp";
import type { BrainFile } from "../../context-brain/types";

async function ws(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "aipe-tb-rm-"));
  const brain: BrainFile = {
    context: { name: "opvibes", coordinator: "Nicolas" },
    repos: [{ name: "embark", url: "u", path: "./embark" }],
  };
  await mkdir(join(dir, ".aipe"), { recursive: true });
  await writeFile(join(dir, ".aipe", "brain.yaml"), stringify(brain), "utf8");
  await mkdir(join(dir, "embark"), { recursive: true });
  return dir;
}

async function present(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

test("removeSkill deletes catalog entry, published source and installed copy", async () => {
  const dir = await ws();
  try {
    const src = join(dir, "src-skill");
    await mkdir(src, { recursive: true });
    await writeFile(join(src, "SKILL.md"), "---\nname: sdd\n---\nx\n", "utf8");
    await installSkill(dir, { name: "sdd", description: "d", objective: "o", whenToUse: "w", repos: ["embark"], source: src });

    expect(await present(join(dir, ".aipe", "skills", "sdd", "SKILL.md"))).toBe(true);
    expect(await present(join(dir, "embark", ".claude", "skills", "sdd", "SKILL.md"))).toBe(true);

    const result = await removeSkill(dir, "SDD"); // case-insensitive
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.rows).toEqual([{ repo: "embark", status: "removed" }]);
    expect(await present(join(dir, ".aipe", "skills", "sdd"))).toBe(false);
    expect(await present(join(dir, "embark", ".claude", "skills", "sdd"))).toBe(false);
    expect((await readToolbox(dir)).skills).toHaveLength(0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("removeSkill refuses an unknown skill", async () => {
  const dir = await ws();
  try {
    const result = await removeSkill(dir, "ghost");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("not-found");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("removeMcp drops the server from the catalog and .mcp.json, keeping others", async () => {
  const dir = await ws();
  try {
    await installMcp(dir, { name: "pg", scope: "workspace", repos: [], description: "Postgres", config: { url: "${PG_URL}" } });
    await installMcp(dir, { name: "redis", scope: "workspace", repos: [], description: "Redis", config: { url: "${REDIS_URL}" } });

    const result = await removeMcp(dir, "pg");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.rows).toEqual([{ target: "workspace", status: "removed" }]);

    const mcpJson = JSON.parse(await readFile(join(dir, ".mcp.json"), "utf8"));
    expect(mcpJson.mcpServers.pg).toBeUndefined();
    expect(mcpJson.mcpServers.redis).toBeDefined(); // other server preserved

    const tb = await readToolbox(dir);
    expect(tb.mcps.map((m) => m.name)).toEqual(["redis"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("removeMcp refuses an unknown server", async () => {
  const dir = await ws();
  try {
    const result = await removeMcp(dir, "ghost");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("not-found");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
