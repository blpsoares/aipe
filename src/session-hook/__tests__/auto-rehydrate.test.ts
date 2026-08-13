import { expect, test } from "bun:test";
import { access, mkdir, mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
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

test("another process holds a fresh lock → skips entirely, no deps called", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-arh-"));
  try {
    await mkdir(join(dir, ".aipe"), { recursive: true });
    await writeFile(join(dir, ".aipe", ".rehydrate.lock"), "", "utf8");
    const calls: string[] = [];
    const ran = await ensureRehydrated(dir, "0.3.0", fakeDeps(calls));
    expect(ran).toBe(false);
    expect(calls).toEqual([]);
    // The other process's lock is left alone — we never held it.
    await access(join(dir, ".aipe", ".rehydrate.lock"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a stale lock (crashed process) is reaped → rehydrates normally", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-arh-"));
  try {
    await mkdir(join(dir, ".aipe"), { recursive: true });
    const lock = join(dir, ".aipe", ".rehydrate.lock");
    await writeFile(lock, "", "utf8");
    // Backdate the lock well past the 5-minute staleness threshold.
    const old = new Date(Date.now() - 10 * 60 * 1000);
    await utimes(lock, old, old);
    const calls: string[] = [];
    const ran = await ensureRehydrated(dir, "0.3.0", fakeDeps(calls));
    expect(ran).toBe(true);
    expect(calls).toHaveLength(3);
    const stamped = await readFile(join(dir, ".aipe", "toolchain.yaml"), "utf8");
    expect(stamped).toContain("0.3.0");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("the lock file is removed after a rehydrate, success or failure", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-arh-"));
  try {
    const ran = await ensureRehydrated(dir, "0.3.0", fakeDeps([]));
    expect(ran).toBe(true);
    await expect(access(join(dir, ".aipe", ".rehydrate.lock"))).rejects.toThrow();

    // Same for the failure path: a throwing dep must not wedge the lock.
    const failed = await ensureRehydrated(dir, "0.4.0", {
      rehydratePersonas: async () => {
        throw new Error("disk full");
      },
      rehydrateToolbox: async () => {},
      rehydrateFlowSkills: async () => {},
    });
    expect(failed).toBe(false);
    await expect(access(join(dir, ".aipe", ".rehydrate.lock"))).rejects.toThrow();
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
