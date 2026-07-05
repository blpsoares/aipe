import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scaffoldWorkspace } from "../scaffold";

async function sh(cmd: string[], cwd: string): Promise<string> {
  const proc = Bun.spawn(cmd, { cwd, stdout: "pipe", stderr: "pipe" });
  const out = await new Response(proc.stdout).text();
  await proc.exited;
  return out.trim();
}

test("scaffoldWorkspace inits git and writes an allowlist .gitignore", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-scaf-"));
  try {
    await scaffoldWorkspace(dir);
    const gi = await readFile(join(dir, ".gitignore"), "utf8");
    expect(gi).toContain("/*");
    expect(gi).toContain("!/.aipe/");
    expect(gi).toContain("!/.claude/");
    // it is a git repo
    const inside = await sh(["git", "rev-parse", "--is-inside-work-tree"], dir);
    expect(inside).toBe("true");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("cloned repos are ignored but .aipe/.claude are tracked", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-scaf-"));
  try {
    await scaffoldWorkspace(dir);
    await sh(["git", "config", "user.email", "t@e.com"], dir);
    await sh(["git", "config", "user.name", "t"], dir);
    // simulate a cloned repo + a brain file
    await Bun.write(join(dir, "embark", "file.txt"), "code");
    await Bun.write(join(dir, ".aipe", "brain.yaml"), "context: {}\n");
    await Bun.write(join(dir, ".claude", "settings.json"), "{}\n");

    const status = await sh(["git", "status", "--porcelain"], dir);
    // .aipe and .claude show up as tracked-candidates; embark must not
    expect(status).toContain(".aipe/");
    expect(status).toContain(".claude/");
    expect(status).not.toContain("embark");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("scaffoldWorkspace is idempotent and never clobbers a custom .gitignore", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-scaf-"));
  try {
    await scaffoldWorkspace(dir);
    await writeFile(join(dir, ".gitignore"), "custom\n", "utf8");
    await scaffoldWorkspace(dir);
    expect(await readFile(join(dir, ".gitignore"), "utf8")).toBe("custom\n");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
