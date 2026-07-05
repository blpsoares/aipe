import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse, stringify } from "yaml";
import { readToolbox, upsertMcp, upsertSkill } from "../catalog";
import { installSkill } from "../skills";
import { installMcp } from "../mcp";
import { emptyToolbox } from "../types";
import type { BrainFile } from "../../context-brain/types";

async function ws(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "aipe-tb-"));
  const brain: BrainFile = {
    context: { name: "opvibes", coordinator: "Nicolas" },
    repos: [
      { name: "embark", url: "u", path: "./embark" },
      { name: "prontuario", url: "u", path: "./prontuario" },
    ],
  };
  await mkdir(join(dir, ".aipe"), { recursive: true });
  await writeFile(join(dir, ".aipe", "brain.yaml"), stringify(brain), "utf8");
  await mkdir(join(dir, "embark"), { recursive: true });
  await mkdir(join(dir, "prontuario"), { recursive: true });
  return dir;
}

test("upsertSkill/upsertMcp are case-insensitive by name", () => {
  let tb = emptyToolbox();
  tb = upsertSkill(tb, { name: "SDD", description: "d", objective: "o", whenToUse: "w", repos: ["embark"] });
  tb = upsertSkill(tb, { name: "sdd", description: "d2", objective: "o", whenToUse: "w", repos: ["embark", "prontuario"] });
  expect(tb.skills).toHaveLength(1);
  expect(tb.skills[0]?.repos).toEqual(["embark", "prontuario"]);

  tb = upsertMcp(tb, { name: "pg", scope: "workspace", repos: [], description: "d", config: {} });
  tb = upsertMcp(tb, { name: "pg", scope: "workspace", repos: [], description: "d2", config: {} });
  expect(tb.mcps).toHaveLength(1);
});

test("installSkill copies into chosen repos + .aipe/skills + records the catalog", async () => {
  const dir = await ws();
  try {
    const src = join(dir, "src-skill");
    await mkdir(src, { recursive: true });
    await writeFile(join(src, "SKILL.md"), "---\nname: sdd\n---\nSpec-driven flow.\n", "utf8");

    const result = await installSkill(dir, {
      name: "sdd",
      description: "Spec-driven development kit",
      objective: "Structure large features spec-first",
      whenToUse: "Only for substantial features; skip for trivial edits like a colour change",
      repos: ["embark"],
      source: src,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.rows).toContainEqual({ repo: "embark", status: "installed" });

    const inRepo = await readFile(join(dir, "embark", ".claude", "skills", "sdd", "SKILL.md"), "utf8");
    expect(inRepo).toContain("Spec-driven flow.");
    const source = await readFile(join(dir, ".aipe", "skills", "sdd", "SKILL.md"), "utf8");
    expect(source).toContain("Spec-driven flow.");

    const tb = await readToolbox(dir);
    expect(tb.skills[0]?.name).toBe("sdd");
    expect(tb.skills[0]?.whenToUse).toContain("colour change");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("installMcp at workspace scope writes .mcp.json and records the catalog", async () => {
  const dir = await ws();
  try {
    const result = await installMcp(dir, {
      name: "postgres",
      scope: "workspace",
      repos: [],
      description: "shared DB access",
      config: { command: "mcp-postgres", args: [], env: { PG_URL: "${PG_URL}" } },
    });
    expect(result.ok).toBe(true);

    const mcpJson = JSON.parse(await readFile(join(dir, ".mcp.json"), "utf8"));
    expect(mcpJson.mcpServers.postgres.command).toBe("mcp-postgres");
    // no literal secret — env is an env-var reference
    expect(mcpJson.mcpServers.postgres.env.PG_URL).toBe("${PG_URL}");

    const tb = await readToolbox(dir);
    expect(tb.mcps[0]?.scope).toBe("workspace");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("installMcp at repo scope merges each repo's .mcp.json preserving others", async () => {
  const dir = await ws();
  try {
    await writeFile(join(dir, "embark", ".mcp.json"), JSON.stringify({ mcpServers: { existing: { command: "x" } } }), "utf8");
    const result = await installMcp(dir, {
      name: "redis",
      scope: "repo",
      repos: ["embark"],
      description: "cache",
      config: { command: "mcp-redis" },
    });
    expect(result.ok).toBe(true);
    const mcpJson = JSON.parse(await readFile(join(dir, "embark", ".mcp.json"), "utf8"));
    expect(Object.keys(mcpJson.mcpServers).sort()).toEqual(["existing", "redis"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
