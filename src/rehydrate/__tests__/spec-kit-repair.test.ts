// #118 T1: `aipe rehydrate` REPAIRS an existing workspace that predates the
// automatic spec-kit install — the full SDD flow must not stay unreachable just
// because the workspace was onboarded before it was mandatory. Absent from the
// toolbox → installed into every repo; present but missing .specify/ → the real
// Spec Kit re-materialized.
import { expect, test } from "bun:test";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stringify } from "yaml";
import { rehydrateToolbox } from "../toolbox";
import { readToolbox } from "../../toolbox/catalog";

const exists = (p: string): Promise<boolean> => access(p).then(() => true).catch(() => false);

async function ws(toolbox: unknown): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "aipe-skrepair-"));
  await mkdir(join(dir, ".aipe"), { recursive: true });
  await mkdir(join(dir, "embark"), { recursive: true });
  await writeFile(
    join(dir, ".aipe", "brain.yaml"),
    stringify({ context: { name: "o", coordinator: "N" }, repos: [{ name: "embark", url: "u", path: "./embark" }] }),
    "utf8",
  );
  await writeFile(join(dir, ".aipe", "toolbox.yaml"), stringify(toolbox), "utf8");
  return dir;
}

test("a workspace with NO spec-kit in the toolbox gets it installed + materialized on rehydrate", async () => {
  const dir = await ws({ skills: [{ name: "sdd-lite", description: "d", objective: "o", whenToUse: "floor", repos: ["embark"] }], mcps: [] });
  try {
    const rows = await rehydrateToolbox(dir);
    expect(rows).toContainEqual({ kind: "skill", name: "spec-kit", status: "restored" });

    // SKILL.md installed into the repo
    const inRepo = await readFile(join(dir, "embark", ".claude", "skills", "spec-kit", "SKILL.md"), "utf8");
    expect(inRepo).toContain("name: spec-kit");
    // the real Spec Kit materialized
    expect(await exists(join(dir, "embark", ".specify"))).toBe(true);
    expect(await exists(join(dir, "embark", ".claude", "commands", "speckit.specify.md"))).toBe(true);
    // recorded in the catalog with its routing threshold
    const tb = await readToolbox(dir);
    const sk = tb.skills.find((s) => s.name === "spec-kit");
    expect(sk?.routing?.minSize).toBe("medium");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a workspace that HAS spec-kit in the toolbox but is missing .specify/ gets it re-materialized", async () => {
  const dir = await ws({
    skills: [{ name: "spec-kit", description: "d", objective: "o", whenToUse: "w", repos: ["embark"], routing: { skipFor: ["chore"], minSize: "medium" } }],
    mcps: [],
  });
  try {
    // published SKILL.md source exists (as after an install) but .specify/ does not
    await mkdir(join(dir, ".aipe", "skills", "spec-kit"), { recursive: true });
    await writeFile(join(dir, ".aipe", "skills", "spec-kit", "SKILL.md"), "---\nname: spec-kit\n---\n", "utf8");
    expect(await exists(join(dir, "embark", ".specify"))).toBe(false);

    await rehydrateToolbox(dir);
    expect(await exists(join(dir, "embark", ".specify"))).toBe(true);
    expect(await exists(join(dir, "embark", ".claude", "commands", "speckit.plan.md"))).toBe(true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
