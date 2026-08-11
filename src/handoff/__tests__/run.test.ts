import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runHandoffClone, runHandoffRender } from "../run";
import type { Cloner, Inspector } from "../../make-workspace/clone";
import type { RepoInput } from "../types";

test("runHandoffClone materializes every repo and writes the manifest", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-handoff-run-"));
  try {
    const repos: RepoInput[] = [
      { name: "repo-a", url: "git@github.com:org/repo-a.git" },
      { name: "repo-b", url: "git@github.com:org/repo-b.git" },
    ];
    const inspect: Inspector = async () => ({ exists: false, isGitRepo: false });
    const clone: Cloner = async () => ({ ok: true });
    const results = await runHandoffClone(repos, dir, { inspect, clone });
    expect(results.every((r) => r.status === "ok")).toBe(true);
    const manifestRaw = await readFile(join(dir, ".aipe-handoff", "repos.json"), "utf8");
    expect(JSON.parse(manifestRaw).repos).toHaveLength(2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("runHandoffClone records a per-repo error without stopping the others", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-handoff-run-"));
  try {
    const repos: RepoInput[] = [
      { name: "repo-a", url: "git@github.com:org/repo-a.git" },
      { name: "repo-b", url: "git@github.com:org/repo-b.git" },
    ];
    const inspect: Inspector = async () => ({ exists: false, isGitRepo: false });
    const clone: Cloner = async (url) =>
      url.includes("repo-b") ? { ok: false, message: "network error" } : { ok: true };
    const results = await runHandoffClone(repos, dir, { inspect, clone });
    expect(results.find((r) => r.name === "repo-a")?.status).toBe("ok");
    expect(results.find((r) => r.name === "repo-b")?.status).toBe("error");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("runHandoffRender: every repo reported → phase done, .aipe-handoff cleaned up", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-handoff-run-"));
  try {
    const inspect: Inspector = async () => ({ exists: false, isGitRepo: false });
    const clone: Cloner = async () => ({ ok: true });
    await runHandoffClone(
      [{ name: "repo-a", url: "git@github.com:org/repo-a.git" }],
      dir,
      { inspect, clone },
    );
    await mkdir(join(dir, ".aipe-handoff", ".reports"), { recursive: true });
    await writeFile(
      join(dir, ".aipe-handoff", ".reports", "repo-a.json"),
      JSON.stringify({ repo: "repo-a", purpose: "Payments API", stack: ["go"], relations: [] }),
    );

    const outFile = join(dir, "CLAUDE.md");
    const result = await runHandoffRender(dir, outFile, "cliente-x");
    expect(result.phase).toBe("done");
    expect(result.missing).toEqual([]);
    const written = await readFile(outFile, "utf8");
    expect(written).toContain("# Context Handoff — cliente-x");
    expect(written).toContain("| repo-a | ./repo-a | Payments API | go |");

    // .aipe-handoff should be gone after a "done" render.
    await expect(readFile(join(dir, ".aipe-handoff", "repos.json"), "utf8")).rejects.toThrow();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("runHandoffRender: re-running after done → phase no-manifest, CLAUDE.md preserved", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-handoff-run-"));
  try {
    const inspect: Inspector = async () => ({ exists: false, isGitRepo: false });
    const clone: Cloner = async () => ({ ok: true });
    await runHandoffClone([{ name: "repo-a", url: "git@github.com:org/repo-a.git" }], dir, { inspect, clone });
    await mkdir(join(dir, ".aipe-handoff", ".reports"), { recursive: true });
    await writeFile(
      join(dir, ".aipe-handoff", ".reports", "repo-a.json"),
      JSON.stringify({ repo: "repo-a", purpose: "Payments API", stack: ["go"], relations: [] }),
    );

    const outFile = join(dir, "CLAUDE.md");
    const first = await runHandoffRender(dir, outFile, "cliente-x");
    expect(first.phase).toBe("done");
    const before = await readFile(outFile, "utf8");

    const second = await runHandoffRender(dir, outFile, "cliente-x");
    expect(second.phase).toBe("no-manifest");
    const after = await readFile(outFile, "utf8");
    expect(after).toBe(before);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("runHandoffRender: a repo with no report → phase pending, .aipe-handoff kept for retry", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-handoff-run-"));
  try {
    const inspect: Inspector = async () => ({ exists: false, isGitRepo: false });
    const clone: Cloner = async () => ({ ok: true });
    await runHandoffClone(
      [{ name: "repo-a", url: "git@github.com:org/repo-a.git" }],
      dir,
      { inspect, clone },
    );

    const outFile = join(dir, "CLAUDE.md");
    const result = await runHandoffRender(dir, outFile, "cliente-x");
    expect(result.phase).toBe("pending");
    expect(result.missing).toEqual(["repo-a"]);
    const manifestRaw = await readFile(join(dir, ".aipe-handoff", "repos.json"), "utf8");
    expect(JSON.parse(manifestRaw).repos).toHaveLength(1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
