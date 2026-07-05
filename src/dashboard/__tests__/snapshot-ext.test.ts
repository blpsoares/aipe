import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stringify } from "yaml";
import { buildSnapshot } from "../snapshot";
import type { BrainFile } from "../../context-brain/types";

// A workspace seeded with stacks, a relations graph, a toolbox and a journey —
// enough to exercise every field the web console reads on top of the TUI's.
async function ws(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "aipe-snapext-"));
  const brain: BrainFile = {
    context: { name: "opvibes", coordinator: "Nicolas" },
    repos: [
      { name: "embark", url: "u1", path: "./embark", stack: ["TypeScript", "Bun"] },
      { name: "api", url: "u2", path: "./api", stack: ["Go"] },
    ],
  };
  await mkdir(join(dir, ".aipe", "journeys"), { recursive: true });
  await mkdir(join(dir, ".aipe", "relations"), { recursive: true });
  await writeFile(join(dir, ".aipe", "brain.yaml"), stringify(brain), "utf8");
  await writeFile(
    join(dir, ".aipe", "personas.yaml"),
    stringify({
      personas: [
        { name: "Nicolas", role: "coordinator", repo: null, path: null },
        { name: "Joaquim", role: "dev-fullstack", repo: "embark", path: "p" },
      ],
    }),
    "utf8",
  );
  await writeFile(
    join(dir, ".aipe", "relations", "graph.yaml"),
    stringify({
      edges: [
        {
          from: "embark",
          to: "api",
          type: "consumes",
          perspectives: [{ detail: "embark calls the api", evidence: "fetch(/api)" }],
        },
      ],
    }),
    "utf8",
  );
  await writeFile(
    join(dir, ".aipe", "toolbox.yaml"),
    stringify({
      skills: [{ name: "sdd", description: "Spec-driven kit", objective: "specs", whenToUse: "big features", repos: ["embark"] }],
      mcps: [{ name: "pg", scope: "workspace", repos: [], description: "Postgres", config: { url: "${PG_URL}" } }],
    }),
    "utf8",
  );
  await writeFile(
    join(dir, ".aipe", "journeys", "j1.yaml"),
    stringify({ id: "j1", dispatches: [{ repo: "embark", specialist: "Joaquim", branch: "b", worktree: "w", status: "dispatched" }] }),
    "utf8",
  );
  return dir;
}

test("snapshot exposes per-repo stacks", async () => {
  const dir = await ws();
  try {
    const s = await buildSnapshot(dir);
    expect(s.repoInfos).toEqual([
      { name: "embark", stack: ["TypeScript", "Bun"] },
      { name: "api", stack: ["Go"] },
    ]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("snapshot exposes relation edges with a detail", async () => {
  const dir = await ws();
  try {
    const s = await buildSnapshot(dir);
    expect(s.relations).toHaveLength(1);
    expect(s.relations[0]).toMatchObject({ from: "embark", to: "api", type: "consumes", detail: "embark calls the api" });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("snapshot exposes toolbox detail (not just counts)", async () => {
  const dir = await ws();
  try {
    const s = await buildSnapshot(dir);
    expect(s.skills).toBe(1);
    expect(s.mcps).toBe(1);
    expect(s.toolboxDetail.skills[0]).toMatchObject({ name: "sdd", whenToUse: "big features", repos: ["embark"] });
    expect(s.toolboxDetail.mcps[0]).toMatchObject({ name: "pg", scope: "workspace" });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("snapshot carries a generatedAt stamp and journey updatedAt", async () => {
  const dir = await ws();
  try {
    const s = await buildSnapshot(dir);
    expect(typeof s.generatedAt).toBe("string");
    expect(s.journeys[0]?.updatedAt).toBeDefined();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("snapshot exposes a persona CV per roster member (title, bio, competences)", async () => {
  const dir = await ws();
  try {
    const s = await buildSnapshot(dir);
    expect(s.personaCVs).toHaveLength(2);
    const joaquim = s.personaCVs.find((c) => c.name === "Joaquim");
    expect(joaquim?.title).toBe("Fullstack specialist");
    expect(joaquim?.repo).toBe("embark");
    // role competences + the repo stack, deduped
    expect(joaquim?.competences).toContain("Feature delivery");
    expect(joaquim?.competences).toContain("TypeScript");
    expect(typeof joaquim?.bio).toBe("string");
    expect((joaquim?.bio.length ?? 0)).toBeGreaterThan(0);
    const nicolas = s.personaCVs.find((c) => c.name === "Nicolas");
    expect(nicolas?.title).toBe("Coordinator");
    expect(nicolas?.repo).toBeNull();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("persona CV reads the bio from the skill's description front-matter when present", async () => {
  const dir = await ws();
  try {
    // Give Joaquim a real skill file at his registry path so the bio is read, not generated.
    const skillDir = join(dir, "embark", ".claude", "skills", "joaquim");
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, "SKILL.md"), "---\nname: joaquim\ndescription: Ships checkout flows end to end.\n---\n\nbody\n", "utf8");
    await writeFile(
      join(dir, ".aipe", "personas.yaml"),
      stringify({
        personas: [
          { name: "Nicolas", role: "coordinator", repo: null, path: null },
          { name: "Joaquim", role: "dev-fullstack", repo: "embark", path: "./embark/.claude/skills/joaquim" },
        ],
      }),
      "utf8",
    );
    const s = await buildSnapshot(dir);
    expect(s.personaCVs.find((c) => c.name === "Joaquim")?.bio).toBe("Ships checkout flows end to end.");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("snapshot resolves modules and carries them on workers (monorepo)", async () => {
  const { mkdtemp } = await import("node:fs/promises");
  const dir = await mkdtemp(join(tmpdir(), "aipe-mod-"));
  try {
    await mkdir(join(dir, ".aipe"), { recursive: true });
    await writeFile(
      join(dir, ".aipe", "brain.yaml"),
      stringify({
        context: { name: "co", coordinator: "Ana" },
        repos: [{ name: "platform", url: "u", path: "./platform", modules: [{ name: "core", path: "packages/core" }, { name: "web", path: "apps/web" }] }],
      }),
      "utf8",
    );
    await writeFile(
      join(dir, ".aipe", "personas.yaml"),
      stringify({
        personas: [
          { name: "Ana", role: "coordinator", repo: null, path: null },
          { name: "Bruno", role: "dev-fullstack", repo: "platform", module: "core", group: "core", path: "p" },
        ],
      }),
      "utf8",
    );
    const s = await buildSnapshot(dir);
    expect(s.modules.map((m) => m.fqid)).toEqual(["platform/core", "platform/web"]);
    expect(s.modules[0]?.implicit).toBe(false);
    const bruno = s.workers.find((w) => w.name === "Bruno");
    expect(bruno?.module).toBe("core");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
