import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stringify } from "yaml";
import { ensureRehydrated, type RehydrateDeps } from "../auto-rehydrate";

function fakeDeps(calls: string[]): RehydrateDeps {
  return {
    rehydratePersonas: async (root: string) => {
      calls.push(`personas:${root}`);
    },
    rehydrateToolbox: async (root: string) => {
      calls.push(`toolbox:${root}`);
    },
    rehydrateFlowSkills: async (root: string) => {
      calls.push(`flow-skills:${root}`);
    },
  };
}

test("no stamp yet → rehydrates and writes the stamp", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-arh-"));
  try {
    const calls: string[] = [];
    const ran = await ensureRehydrated(dir, "0.3.0", fakeDeps(calls));
    expect(ran).toBe(true);
    expect(calls).toEqual([`personas:${dir}`, `toolbox:${dir}`, `flow-skills:${dir}`]);
    const stamped = await readFile(join(dir, ".aipe", "toolchain.yaml"), "utf8");
    expect(stamped).toContain("0.3.0");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("stamp already matches current version → no rehydrate, no calls", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-arh-"));
  try {
    await mkdir(join(dir, ".aipe"), { recursive: true });
    await writeFile(join(dir, ".aipe", "toolchain.yaml"), stringify({ aipeVersion: "0.3.0" }), "utf8");
    const calls: string[] = [];
    const ran = await ensureRehydrated(dir, "0.3.0", fakeDeps(calls));
    expect(ran).toBe(false);
    expect(calls).toEqual([]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("stamp is an older version → rehydrates and overwrites the stamp", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-arh-"));
  try {
    await mkdir(join(dir, ".aipe"), { recursive: true });
    await writeFile(join(dir, ".aipe", "toolchain.yaml"), stringify({ aipeVersion: "0.2.0" }), "utf8");
    const calls: string[] = [];
    const ran = await ensureRehydrated(dir, "0.3.0", fakeDeps(calls));
    expect(ran).toBe(true);
    expect(calls).toHaveLength(3);
    const stamped = await readFile(join(dir, ".aipe", "toolchain.yaml"), "utf8");
    expect(stamped).toContain("0.3.0");
    expect(stamped).not.toContain("0.2.0");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a rehydrate dep that throws → swallowed, returns false, stamp not written", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-arh-"));
  try {
    const deps: RehydrateDeps = {
      rehydratePersonas: async () => {
        throw new Error("disk full");
      },
      rehydrateToolbox: async () => {},
      rehydrateFlowSkills: async () => {},
    };
    const ran = await ensureRehydrated(dir, "0.3.0", deps);
    expect(ran).toBe(false);
    await expect(readFile(join(dir, ".aipe", "toolchain.yaml"), "utf8")).rejects.toThrow();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("malformed toolchain.yaml → treated as no stamp, rehydrates", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-arh-"));
  try {
    await mkdir(join(dir, ".aipe"), { recursive: true });
    await writeFile(join(dir, ".aipe", "toolchain.yaml"), ": : not : yaml :", "utf8");
    const calls: string[] = [];
    const ran = await ensureRehydrated(dir, "0.3.0", fakeDeps(calls));
    expect(ran).toBe(true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
