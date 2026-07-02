import { expect, test } from "bun:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { realInspect } from "../git";

async function git(args: string[], cwd: string): Promise<void> {
  const proc = Bun.spawn(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  const code = await proc.exited;
  if (code !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new Error(`git ${args.join(" ")} falhou: ${stderr}`);
  }
}

test("path inexistente → exists:false, isGitRepo:false", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-git-"));
  try {
    const target = join(dir, "nao-existe");
    const result = await realInspect(target);
    expect(result).toEqual({ exists: false, isGitRepo: false });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("diretório é a raiz de um repo git com origin → isGitRepo:true, remote lido", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-git-"));
  try {
    await git(["init"], dir);
    await git(["remote", "add", "origin", "git@github.com:opvibes/embark.git"], dir);
    const result = await realInspect(dir);
    expect(result.exists).toBe(true);
    expect(result.isGitRepo).toBe(true);
    expect(result.remote).toBe("git@github.com:opvibes/embark.git");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("regressão: subdiretório simples dentro de um repo git ancestral não é tratado como repo", async () => {
  const parent = await mkdtemp(join(tmpdir(), "aipe-git-"));
  try {
    await git(["init"], parent);
    await git(["remote", "add", "origin", "git@github.com:opvibes/embark.git"], parent);
    const child = join(parent, "subdir-vazio");
    await mkdir(child);
    const result = await realInspect(child);
    expect(result.exists).toBe(true);
    expect(result.isGitRepo).toBe(false);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});
