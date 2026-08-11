import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { materializeHandoffRepo, readManifest, writeManifest } from "../clone";
import type { Cloner, Inspector } from "../../make-workspace/clone";
import type { RepoInput } from "../types";

test("local path that is a valid git repo with a remote → ok, remote auto-detected", async () => {
  const repo: RepoInput = { name: "embark", localPath: "/home/pe/projects/embark" };
  const inspect: Inspector = async () => ({ exists: true, isGitRepo: true, remote: "git@github.com:opvibes/embark.git" });
  const clone: Cloner = async () => ({ ok: true });
  const entry = await materializeHandoffRepo(repo, "/tmp/out", inspect, clone);
  expect(entry).toEqual({
    name: "embark",
    status: "ok",
    path: "/home/pe/projects/embark",
    url: "git@github.com:opvibes/embark.git",
  });
});

test("local path that is not a git repo → error, no clone attempted", async () => {
  const repo: RepoInput = { name: "embark", localPath: "/home/pe/projects/embark" };
  const inspect: Inspector = async () => ({ exists: true, isGitRepo: false });
  let cloneCalled = false;
  const clone: Cloner = async () => { cloneCalled = true; return { ok: true }; };
  const entry = await materializeHandoffRepo(repo, "/tmp/out", inspect, clone);
  expect(entry.status).toBe("error");
  expect(entry.message).toContain("embark");
  expect(cloneCalled).toBe(false);
});

test("url-only, path not yet present → clones into outDir/name", async () => {
  const repo: RepoInput = { name: "embark", url: "git@github.com:opvibes/embark.git" };
  const inspect: Inspector = async () => ({ exists: false, isGitRepo: false });
  let clonedTo = "";
  const clone: Cloner = async (_url, absPath) => { clonedTo = absPath; return { ok: true }; };
  const entry = await materializeHandoffRepo(repo, "/tmp/out", inspect, clone);
  expect(entry).toEqual({ name: "embark", status: "ok", path: join("/tmp/out", "embark"), url: repo.url });
  expect(clonedTo).toBe(join("/tmp/out", "embark"));
});

test("url-only, path already present → skips clone, still ok", async () => {
  const repo: RepoInput = { name: "embark", url: "git@github.com:opvibes/embark.git" };
  const inspect: Inspector = async () => ({ exists: true, isGitRepo: true, remote: repo.url });
  let cloneCalled = false;
  const clone: Cloner = async () => { cloneCalled = true; return { ok: true }; };
  const entry = await materializeHandoffRepo(repo, "/tmp/out", inspect, clone);
  expect(entry.status).toBe("ok");
  expect(cloneCalled).toBe(false);
});

test("url-only, clone fails → error with the git message", async () => {
  const repo: RepoInput = { name: "embark", url: "git@github.com:opvibes/embark.git" };
  const inspect: Inspector = async () => ({ exists: false, isGitRepo: false });
  const clone: Cloner = async () => ({ ok: false, message: "Permission denied (publickey)" });
  const entry = await materializeHandoffRepo(repo, "/tmp/out", inspect, clone);
  expect(entry.status).toBe("error");
  expect(entry.message).toContain("Permission denied");
});

test("neither url nor localPath given → error", async () => {
  const repo: RepoInput = { name: "embark" };
  const inspect: Inspector = async () => ({ exists: false, isGitRepo: false });
  const clone: Cloner = async () => ({ ok: true });
  const entry = await materializeHandoffRepo(repo, "/tmp/out", inspect, clone);
  expect(entry.status).toBe("error");
});

test("writeManifest then readManifest round-trips the entries", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-handoff-"));
  try {
    const entries = [
      { name: "embark", status: "ok" as const, path: "/x/embark", url: "git@github.com:opvibes/embark.git" },
      { name: "broken", status: "error" as const, message: "boom" },
    ];
    await writeManifest(dir, entries);
    const read = await readManifest(dir);
    expect(read).toEqual(entries);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("readManifest on a directory with no manifest yet → empty array", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-handoff-"));
  try {
    expect(await readManifest(dir)).toEqual([]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
