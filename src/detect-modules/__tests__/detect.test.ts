import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectModules } from "../detect";

async function repo(): Promise<string> {
  return mkdtemp(join(tmpdir(), "aipe-detect-"));
}

test("detects pnpm-workspace packages globs", async () => {
  const dir = await repo();
  try {
    await writeFile(join(dir, "pnpm-workspace.yaml"), "packages:\n  - 'packages/*'\n", "utf8");
    await mkdir(join(dir, "packages", "core"), { recursive: true });
    await writeFile(join(dir, "packages", "core", "package.json"), JSON.stringify({ name: "@scope/core" }), "utf8");
    await writeFile(join(dir, "packages", "core", "tsconfig.json"), "{}", "utf8");
    await mkdir(join(dir, "packages", "utils"), { recursive: true });
    await writeFile(join(dir, "packages", "utils", "package.json"), JSON.stringify({ name: "utils" }), "utf8");

    const mods = await detectModules(dir);
    expect(mods.map((m) => `${m.name}@${m.path}`).sort()).toEqual(["core@packages/core", "utils@packages/utils"]);
    expect(mods.find((m) => m.name === "core")?.stack).toEqual(["TypeScript"]);
    expect(mods.find((m) => m.name === "utils")?.stack).toEqual(["JavaScript"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("detects package.json workspaces", async () => {
  const dir = await repo();
  try {
    await writeFile(join(dir, "package.json"), JSON.stringify({ workspaces: ["apps/*"] }), "utf8");
    await mkdir(join(dir, "apps", "web"), { recursive: true });
    await writeFile(join(dir, "apps", "web", "package.json"), JSON.stringify({ name: "web" }), "utf8");
    const mods = await detectModules(dir);
    expect(mods).toEqual([{ name: "web", path: "apps/web", stack: ["JavaScript"] }]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("detects go.work use directories", async () => {
  const dir = await repo();
  try {
    await writeFile(join(dir, "go.work"), "go 1.22\n\nuse (\n  ./cmd/gateway\n  ./cmd/workers\n)\n", "utf8");
    await mkdir(join(dir, "cmd", "gateway"), { recursive: true });
    await mkdir(join(dir, "cmd", "workers"), { recursive: true });
    await writeFile(join(dir, "cmd", "gateway", "go.mod"), "module gateway\n", "utf8");
    const mods = await detectModules(dir);
    expect(mods.map((m) => m.path).sort()).toEqual(["cmd/gateway", "cmd/workers"]);
    expect(mods.find((m) => m.path === "cmd/gateway")?.stack).toEqual(["Go"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a non-monorepo returns no modules", async () => {
  const dir = await repo();
  try {
    await writeFile(join(dir, "package.json"), JSON.stringify({ name: "flat" }), "utf8");
    expect(await detectModules(dir)).toEqual([]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
