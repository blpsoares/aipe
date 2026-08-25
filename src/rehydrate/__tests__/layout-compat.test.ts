// Both workspace layouts are first-class, and rehydrate never migrates between
// them.
//
// The second half of this file is the load-bearing one: `aipe rehydrate` runs
// unattended (SessionStart auto-rehydrate, and `applyUpgrade` after a
// self-update, over every known workspace, with stdout discarded). If it ever
// grew the ability to move a repo, it would do so silently and in bulk. These
// tests fail the moment that happens.
import { expect, test } from "bun:test";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stringify } from "yaml";
import type { BrainFile } from "../../context-brain/types";
import { rehydratePersonas } from "../personas";

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

/** A workspace whose single repo lives at `repoPath`, with one stored persona. */
async function workspaceAt(repoPath: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "aipe-compat-"));
  const brain: BrainFile = {
    context: { name: "opvibes", coordinator: "Nicolas" },
    repos: [{ name: "embark", url: "git@github.com:opvibes/embark.git", path: repoPath }],
  };
  await mkdir(join(dir, ".aipe", "personas", "embark", "joaquim"), { recursive: true });
  await writeFile(join(dir, ".aipe", "brain.yaml"), stringify(brain), "utf8");
  await writeFile(
    join(dir, ".aipe", "personas", "embark", "joaquim", "SKILL.md"),
    "---\nname: joaquim\n---\nYou are Joaquim.\n",
    "utf8",
  );
  await mkdir(join(dir, repoPath.replace(/^\.\//, "")), { recursive: true });
  return dir;
}

test("legacy layout (repo at the workspace root) rehydrates", async () => {
  const dir = await workspaceAt("./embark");
  try {
    const rows = await rehydratePersonas(dir);
    expect(rows).toContainEqual({ repo: "embark", slug: "joaquim", status: "restored" });
    expect(await readFile(join(dir, "embark", ".claude", "skills", "joaquim", "SKILL.md"), "utf8"))
      .toContain("You are Joaquim.");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("repos/ layout rehydrates identically — nothing assumes the root", async () => {
  const dir = await workspaceAt("./repos/embark");
  try {
    const rows = await rehydratePersonas(dir);
    expect(rows).toContainEqual({ repo: "embark", slug: "joaquim", status: "restored" });
    expect(await readFile(join(dir, "repos", "embark", ".claude", "skills", "joaquim", "SKILL.md"), "utf8"))
      .toContain("You are Joaquim.");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a PE-chosen nested path is honoured too", async () => {
  const dir = await workspaceAt("./services/embark");
  try {
    const rows = await rehydratePersonas(dir);
    expect(rows).toContainEqual({ repo: "embark", slug: "joaquim", status: "restored" });
    expect(await exists(join(dir, "services", "embark", ".claude", "skills", "joaquim"))).toBe(true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("GUARANTEE: rehydrate never migrates a legacy workspace", async () => {
  const dir = await workspaceAt("./embark");
  try {
    await rehydratePersonas(dir);

    // the repo is exactly where it was …
    expect(await exists(join(dir, "embark"))).toBe(true);
    // … no repos/ appeared …
    expect(await exists(join(dir, "repos"))).toBe(false);
    // … and the brain was not rewritten behind the PE's back.
    expect(await readFile(join(dir, ".aipe", "brain.yaml"), "utf8")).toContain("path: ./embark");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
