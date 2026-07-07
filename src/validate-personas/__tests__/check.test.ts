import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stringify } from "yaml";
import { checkPersonaReadiness, parseFrontmatter } from "../check";

test("parseFrontmatter reads name + description from a persona SKILL.md", () => {
  const fm = parseFrontmatter("---\nname: joaquim\ndescription: Fullstack specialist for embark.\n---\n\nbody");
  expect(fm).toEqual({ name: "joaquim", description: "Fullstack specialist for embark." });
});

test("parseFrontmatter returns null without a closing delimiter", () => {
  expect(parseFrontmatter("---\nname: joaquim\nno closing")).toBeNull();
  expect(parseFrontmatter("no frontmatter at all")).toBeNull();
});

async function ws(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "aipe-vp-"));
  await mkdir(join(dir, ".aipe"), { recursive: true });
  return dir;
}

async function roster(dir: string, personas: unknown[]): Promise<void> {
  await writeFile(join(dir, ".aipe", "personas.yaml"), stringify({ personas }), "utf8");
}

async function skill(dir: string, path: string, name: string, description: string): Promise<void> {
  const skillDir = join(dir, path);
  await mkdir(skillDir, { recursive: true });
  await writeFile(join(skillDir, "SKILL.md"), `---\nname: ${name}\ndescription: ${description}\n---\n\nbody`, "utf8");
}

test("a well-formed persona passes; the coordinator is skipped", async () => {
  const dir = await ws();
  try {
    await roster(dir, [
      { name: "Nicolas", role: "coordinator", repo: null, module: null, fqid: null, path: null },
      { name: "Joaquim", role: "dev-fullstack", repo: "embark", module: null, fqid: "embark", path: "./embark/.claude/skills/joaquim" },
    ]);
    await skill(dir, "embark/.claude/skills/joaquim", "joaquim", "Fullstack specialist for embark.");

    const result = await checkPersonaReadiness(dir);
    expect(result.total).toBe(1); // coordinator skipped
    expect(result.ready).toBe(1);
    expect(result.results[0]?.ok).toBe(true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("flags a missing SKILL.md", async () => {
  const dir = await ws();
  try {
    await roster(dir, [
      { name: "Joaquim", role: "dev-fullstack", repo: "embark", module: null, fqid: "embark", path: "./embark/.claude/skills/joaquim" },
    ]);
    const result = await checkPersonaReadiness(dir);
    expect(result.ready).toBe(0);
    expect(result.results[0]?.issues.join()).toContain("missing on disk");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("flags a frontmatter name that does not match the persona slug", async () => {
  const dir = await ws();
  try {
    await roster(dir, [
      { name: "Marina", role: "qa", repo: "embark", module: null, fqid: "embark", path: "./embark/.claude/skills/marina" },
    ]);
    await skill(dir, "embark/.claude/skills/marina", "marina-qa", "QA specialist.");
    const result = await checkPersonaReadiness(dir);
    expect(result.ready).toBe(0);
    expect(result.results[0]?.issues.join()).toContain('expected "marina"');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("flags an empty description", async () => {
  const dir = await ws();
  try {
    await roster(dir, [
      { name: "Ana", role: "dev-fullstack", repo: "prontuario", module: "api", fqid: "prontuario/api", path: "./prontuario/.claude/skills/ana" },
    ]);
    await skill(dir, "prontuario/.claude/skills/ana", "ana", "");
    const result = await checkPersonaReadiness(dir);
    expect(result.results[0]?.issues.join()).toContain("description` is empty");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("empty roster → 0/0 ready", async () => {
  const dir = await ws();
  try {
    const result = await checkPersonaReadiness(dir);
    expect(result).toEqual({ results: [], ready: 0, total: 0 });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
