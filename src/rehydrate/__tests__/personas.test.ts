import { expect, test } from "bun:test";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stringify } from "yaml";
import { rehydratePersonas } from "../personas";
import type { BrainFile } from "../../context-brain/types";

async function ws(withRepoDirs: boolean): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "aipe-reh-"));
  const brain: BrainFile = {
    context: { name: "opvibes", coordinator: "Nicolas" },
    repos: [{ name: "embark", url: "u", path: "./embark" }],
  };
  await mkdir(join(dir, ".aipe", "personas", "embark", "joaquim"), { recursive: true });
  await writeFile(join(dir, ".aipe", "brain.yaml"), stringify(brain), "utf8");
  await writeFile(
    join(dir, ".aipe", "personas", "embark", "joaquim", "SKILL.md"),
    "---\nname: joaquim\n---\nYou are Joaquim.\n",
    "utf8",
  );
  if (withRepoDirs) await mkdir(join(dir, "embark"), { recursive: true });
  return dir;
}

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

test("restores persona SKILL.md into a present repo", async () => {
  const dir = await ws(true);
  try {
    const rows = await rehydratePersonas(dir);
    expect(rows).toContainEqual({ repo: "embark", slug: "joaquim", status: "restored" });
    const restored = await readFile(join(dir, "embark", ".claude", "skills", "joaquim", "SKILL.md"), "utf8");
    expect(restored).toContain("You are Joaquim.");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("backfills the persona agent type from the roster's real name", async () => {
  const dir = await ws(true);
  try {
    // a roster gives the display name (SKILL frontmatter only carries the slug)
    await writeFile(
      join(dir, ".aipe", "personas.yaml"),
      stringify({ personas: [{ name: "Joaquim", role: "dev-fullstack", repo: "embark", path: "./embark/.claude/skills/joaquim" }] }),
      "utf8",
    );
    await rehydratePersonas(dir);
    const agentMd = await readFile(join(dir, "embark", ".claude", "agents", "joaquim.md"), "utf8");
    expect(agentMd).toContain("name: Joaquim");
    expect(agentMd).toContain("You are Joaquim.");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("reports repo-missing when the repo dir isn't cloned yet", async () => {
  const dir = await ws(false);
  try {
    const rows = await rehydratePersonas(dir);
    expect(rows).toContainEqual({ repo: "embark", slug: "joaquim", status: "repo-missing" });
    expect(await exists(join(dir, "embark", ".claude", "skills", "joaquim", "SKILL.md"))).toBe(false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("empty when there are no stored personas", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-reh-"));
  try {
    await mkdir(join(dir, ".aipe"), { recursive: true });
    await writeFile(
      join(dir, ".aipe", "brain.yaml"),
      stringify({ context: { name: "o", coordinator: "N" }, repos: [{ name: "embark", url: "u", path: "./embark" }] }),
      "utf8",
    );
    expect(await rehydratePersonas(dir)).toEqual([]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
