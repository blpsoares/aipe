import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse, stringify } from "yaml";
import { renderAgentMd } from "../../hire-specialists/agent";
import { renderSkillMd } from "../../hire-specialists/render";
import type { BrainFile, PersonaReport } from "../../hire-specialists/types";
import { rebuildRegistryFromSources } from "../registry";

// Lay down the published source-of-truth files for a persona exactly as
// writePersonaFiles does: .aipe/personas/<repo>/<slug>/{SKILL.md,agent.md}.
async function writeSource(dir: string, report: PersonaReport, stack: string[]): Promise<void> {
  const slug = report.name.toLowerCase();
  const sourceDir = join(dir, ".aipe", "personas", report.repo, slug);
  await mkdir(sourceDir, { recursive: true });
  await writeFile(join(sourceDir, "SKILL.md"), renderSkillMd(report, stack), "utf8");
  await writeFile(
    join(sourceDir, "agent.md"),
    renderAgentMd({ name: report.name, role: report.role, repo: report.repo, stack, body: report.body }),
    "utf8",
  );
}

const brain: BrainFile = {
  context: { name: "opvibes", coordinator: "Heisenberg" },
  repos: [{ name: "openvibes-embark", url: "u", path: "./openvibes-embark", stack: ["typescript"] }],
};

// D3 recovery path: `hire-specialists --merge` destroyed personas.yaml, but the
// published sources under .aipe/personas/** survived. There must be a CLI path
// that rebuilds the registry from those sources, or the roster is unrecoverable.
test("rebuildRegistryFromSources rebuilds personas.yaml from .aipe/personas/** after the registry was destroyed", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-rebuild-"));
  try {
    await mkdir(join(dir, ".aipe"), { recursive: true });
    await writeFile(join(dir, ".aipe", "brain.yaml"), stringify(brain), "utf8");

    // Four personas whose sources survived (two packages, both roles).
    await writeSource(dir, { repo: "openvibes-embark", role: "dev-fullstack", name: "Ann", body: "You are Ann." }, ["typescript"]);
    await writeSource(dir, { repo: "openvibes-embark", role: "qa", name: "Bob", body: "You are Bob." }, ["typescript"]);
    await writeSource(dir, { repo: "openvibes-embark", role: "dev-fullstack", name: "Cid", body: "You are Cid." }, ["typescript"]);
    await writeSource(dir, { repo: "openvibes-embark", role: "qa", name: "Dot", body: "You are Dot." }, ["typescript"]);

    // The destroyed registry: coordinator + one lone survivor.
    await writeFile(
      join(dir, ".aipe", "personas.yaml"),
      stringify({
        personas: [
          { name: "Heisenberg", role: "coordinator", repo: null, path: null },
          { name: "Ann", role: "dev-fullstack", repo: "openvibes-embark", path: "./openvibes-embark/.claude/skills/ann", package: "core" },
        ],
      }),
      "utf8",
    );

    const rows = await rebuildRegistryFromSources(dir);

    const roster = parse(await readFile(join(dir, ".aipe", "personas.yaml"), "utf8"));
    const names: string[] = roster.personas.map((p: { name: string }) => p.name).sort();
    // Coordinator + all four sources are back.
    expect(names).toEqual(["Ann", "Bob", "Cid", "Dot", "Heisenberg"]);

    // Coordinator is rebuilt fresh from the brain, exactly once.
    expect(roster.personas.filter((p: { role: string }) => p.role === "coordinator")).toEqual([
      { name: "Heisenberg", role: "coordinator", repo: null, path: null },
    ]);

    const byName = new Map(roster.personas.map((p: { name: string }) => [p.name, p]));
    // The surviving roster entry keeps its richer data (its package) — not clobbered.
    expect((byName.get("Ann") as { package?: string }).package).toBe("core");
    // Reconstructed entries recover repo, role and a usable path from the sources.
    expect(byName.get("Bob")).toMatchObject({ role: "qa", repo: "openvibes-embark" });
    expect(byName.get("Cid")).toMatchObject({ role: "dev-fullstack", repo: "openvibes-embark" });
    expect((byName.get("Dot") as { path: string }).path).toContain("openvibes-embark");

    // It reports what it re-registered.
    expect(rows.filter((r) => r.status === "registered").map((r) => r.slug).sort()).toEqual(["bob", "cid", "dot"]);
    expect(rows.find((r) => r.slug === "ann")?.status).toBe("kept");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// A wholesale loss (personas.yaml gone entirely) is still fully recoverable
// from the sources — the common case the incident actually hit.
test("rebuildRegistryFromSources reconstructs the whole roster when personas.yaml is missing", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-rebuild-none-"));
  try {
    await mkdir(join(dir, ".aipe"), { recursive: true });
    await writeFile(join(dir, ".aipe", "brain.yaml"), stringify(brain), "utf8");
    await writeSource(dir, { repo: "openvibes-embark", role: "dev-fullstack", name: "Ann", body: "You are Ann." }, ["typescript"]);
    await writeSource(dir, { repo: "openvibes-embark", role: "qa", name: "Bob", body: "You are Bob." }, ["typescript"]);

    await rebuildRegistryFromSources(dir);

    const roster = parse(await readFile(join(dir, ".aipe", "personas.yaml"), "utf8"));
    expect(roster.personas.map((p: { name: string }) => p.name).sort()).toEqual(["Ann", "Bob", "Heisenberg"]);
    // Display names, not slugs, are recovered from the agent.md frontmatter.
    expect(roster.personas.map((p: { name: string }) => p.name)).toContain("Ann");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// A source dir for a repo no longer in the brain is skipped, not registered
// against a nonexistent repo.
test("rebuildRegistryFromSources skips sources whose repo is not in the brain", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-rebuild-ghost-"));
  try {
    await mkdir(join(dir, ".aipe"), { recursive: true });
    await writeFile(join(dir, ".aipe", "brain.yaml"), stringify(brain), "utf8");
    await writeSource(dir, { repo: "openvibes-embark", role: "dev-fullstack", name: "Ann", body: "You are Ann." }, ["typescript"]);
    await writeSource(dir, { repo: "ghost-repo", role: "qa", name: "Boo", body: "You are Boo." }, ["typescript"]);

    const rows = await rebuildRegistryFromSources(dir);
    const roster = parse(await readFile(join(dir, ".aipe", "personas.yaml"), "utf8"));
    expect(roster.personas.map((p: { name: string }) => p.name).sort()).toEqual(["Ann", "Heisenberg"]);
    expect(rows.find((r) => r.repo === "ghost-repo")?.status).toBe("unknown-repo");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
