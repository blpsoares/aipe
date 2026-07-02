import { realpath, stat } from "node:fs/promises";
import type { Cloner, Inspector, RepoInspection } from "./clone";

async function run(cmd: string[], cwd?: string): Promise<{ code: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(cmd, { cwd, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const code = await proc.exited;
  return { code, stdout: stdout.trim(), stderr: stderr.trim() };
}

export const realInspect: Inspector = async (absPath: string): Promise<RepoInspection> => {
  try {
    await stat(absPath);
  } catch {
    return { exists: false, isGitRepo: false };
  }
  const toplevel = await run(["git", "-C", absPath, "rev-parse", "--show-toplevel"]);
  if (toplevel.code !== 0) {
    return { exists: true, isGitRepo: false };
  }
  const [normalizedAbsPath, normalizedToplevel] = await Promise.all([
    realpath(absPath),
    realpath(toplevel.stdout),
  ]);
  if (normalizedToplevel !== normalizedAbsPath) {
    return { exists: true, isGitRepo: false };
  }
  const remote = await run(["git", "-C", absPath, "remote", "get-url", "origin"]);
  return {
    exists: true,
    isGitRepo: true,
    remote: remote.code === 0 ? remote.stdout : undefined,
  };
};

export const realClone: Cloner = async (url: string, absPath: string) => {
  const result = await run(["git", "-c", "protocol.ext.allow=never", "clone", "--", url, absPath]);
  if (result.code === 0) return { ok: true };
  return { ok: false, message: result.stderr || `git clone falhou (código ${result.code})` };
};
