import { expect, test } from "bun:test";
import { join } from "node:path";
import { materializeRepo, remotesMatch, type Inspector, type Cloner } from "../clone";
import type { RepoEntry } from "../types";

const repo: RepoEntry = { name: "embark", url: "git@github.com:opvibes/embark.git", path: "./embark" };
const ws = "/tmp/ws";

test("remotesMatch normaliza ssh vs https e sufixo .git", () => {
  expect(remotesMatch("git@github.com:opvibes/embark.git", "https://github.com/opvibes/embark")).toBe(true);
  expect(remotesMatch("git@github.com:opvibes/embark.git", "git@github.com:opvibes/outro.git")).toBe(false);
});

test("path inexistente → clona", async () => {
  const inspect: Inspector = async () => ({ exists: false, isGitRepo: false });
  let clonedTo = "";
  const clone: Cloner = async (_url, absPath) => { clonedTo = absPath; return { ok: true }; };
  const res = await materializeRepo(repo, ws, inspect, clone);
  expect(res.status).toBe("cloned");
  expect(clonedTo).toBe(join(ws, "embark"));
});

test("path presente com mesmo remote → skipped, sem clonar", async () => {
  const inspect: Inspector = async () => ({ exists: true, isGitRepo: true, remote: "https://github.com/opvibes/embark" });
  let called = false;
  const clone: Cloner = async () => { called = true; return { ok: true }; };
  const res = await materializeRepo(repo, ws, inspect, clone);
  expect(res.status).toBe("skipped");
  expect(called).toBe(false);
});

test("path presente mas não é git → error, sem clonar", async () => {
  const inspect: Inspector = async () => ({ exists: true, isGitRepo: false });
  let called = false;
  const clone: Cloner = async () => { called = true; return { ok: true }; };
  const res = await materializeRepo(repo, ws, inspect, clone);
  expect(res.status).toBe("error");
  expect(res.message).toContain("ocupado");
  expect(called).toBe(false);
});

test("path presente com remote divergente → error, sem clonar", async () => {
  const inspect: Inspector = async () => ({ exists: true, isGitRepo: true, remote: "git@github.com:outro/repo.git" });
  let called = false;
  const clone: Cloner = async () => { called = true; return { ok: true }; };
  const res = await materializeRepo(repo, ws, inspect, clone);
  expect(res.status).toBe("error");
  expect(called).toBe(false);
});

test("falha do cloner → error com a mensagem do git", async () => {
  const inspect: Inspector = async () => ({ exists: false, isGitRepo: false });
  const clone: Cloner = async () => ({ ok: false, message: "Permission denied (publickey)" });
  const res = await materializeRepo(repo, ws, inspect, clone);
  expect(res.status).toBe("error");
  expect(res.message).toContain("Permission denied");
});
