import { expect, test } from "bun:test";
import { join } from "node:path";
import { materializeRepo, remotesMatch, type Inspector, type Cloner } from "../clone";
import type { RepoEntry } from "../types";

const repo: RepoEntry = { name: "embark", url: "git@github.com:opvibes/embark.git", path: "./embark" };
const ws = "/tmp/ws";

test("remotesMatch normalizes ssh vs https and .git suffix", () => {
  expect(remotesMatch("git@github.com:opvibes/embark.git", "https://github.com/opvibes/embark")).toBe(true);
  expect(remotesMatch("git@github.com:opvibes/embark.git", "git@github.com:opvibes/outro.git")).toBe(false);
});

test("nonexistent path → clones", async () => {
  const inspect: Inspector = async () => ({ exists: false, isGitRepo: false });
  let clonedTo = "";
  const clone: Cloner = async (_url, absPath) => { clonedTo = absPath; return { ok: true }; };
  const res = await materializeRepo(repo, ws, inspect, clone);
  expect(res.status).toBe("cloned");
  expect(clonedTo).toBe(join(ws, "embark"));
});

test("path present with same remote → skipped, does not clone", async () => {
  const inspect: Inspector = async () => ({ exists: true, isGitRepo: true, remote: "https://github.com/opvibes/embark" });
  let called = false;
  const clone: Cloner = async () => { called = true; return { ok: true }; };
  const res = await materializeRepo(repo, ws, inspect, clone);
  expect(res.status).toBe("skipped");
  expect(called).toBe(false);
});

test("path present but not git → error, does not clone", async () => {
  const inspect: Inspector = async () => ({ exists: true, isGitRepo: false });
  let called = false;
  const clone: Cloner = async () => { called = true; return { ok: true }; };
  const res = await materializeRepo(repo, ws, inspect, clone);
  expect(res.status).toBe("error");
  expect(res.message).toContain("occupied");
  expect(called).toBe(false);
});

test("path present with divergent remote → error, does not clone", async () => {
  const inspect: Inspector = async () => ({ exists: true, isGitRepo: true, remote: "git@github.com:outro/repo.git" });
  let called = false;
  const clone: Cloner = async () => { called = true; return { ok: true }; };
  const res = await materializeRepo(repo, ws, inspect, clone);
  expect(res.status).toBe("error");
  expect(called).toBe(false);
});

test("cloner failure → error with the git message", async () => {
  const inspect: Inspector = async () => ({ exists: false, isGitRepo: false });
  const clone: Cloner = async () => ({ ok: false, message: "Permission denied (publickey)" });
  const res = await materializeRepo(repo, ws, inspect, clone);
  expect(res.status).toBe("error");
  expect(res.message).toContain("Permission denied");
});
