import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { block, BEGIN, HOOK_LINE } from "../rc";
import { installShellHook, statusShellHook, suggestInstallLine, uninstallShellHook } from "../cli";

let home = "";
const bashrc = () => join(home, ".bashrc");
const zshrc = () => join(home, ".zshrc");

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "aipe-shell-hook-"));
});
afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

describe("install", () => {
  it("installs into both .bashrc and .zshrc when both exist", async () => {
    await writeFile(bashrc(), "export PATH=x\n");
    await writeFile(zshrc(), "export PATH=y\n");
    const res = await installShellHook(home);
    expect(res.code).toBe(0);
    expect(await readFile(bashrc(), "utf8")).toContain(block());
    expect(await readFile(zshrc(), "utf8")).toContain(block());
  });

  it("creates ~/.bashrc as the default when no rc exists", async () => {
    expect(existsSync(bashrc())).toBe(false);
    const res = await installShellHook(home);
    expect(res.code).toBe(0);
    expect(existsSync(bashrc())).toBe(true);
    expect(existsSync(zshrc())).toBe(false); // never conjures .zshrc
    expect(await readFile(bashrc(), "utf8")).toContain(block());
  });

  it("only touches rc files that already exist", async () => {
    await writeFile(zshrc(), "export ZSH=1\n");
    await installShellHook(home);
    expect(existsSync(bashrc())).toBe(false); // .bashrc absent → left absent
    expect(await readFile(zshrc(), "utf8")).toContain(block());
  });

  it("is idempotent — installing twice does not duplicate the block", async () => {
    await writeFile(bashrc(), "export PATH=x\n");
    await installShellHook(home);
    await installShellHook(home);
    const content = await readFile(bashrc(), "utf8");
    expect(content.split(BEGIN)).toHaveLength(2); // exactly one marker
  });

  it("REFUSES a strange rc (corrupt block) without writing anything", async () => {
    const strange = `export PATH=x\n${BEGIN}\n${HOOK_LINE}\n`; // BEGIN, no END
    await writeFile(bashrc(), strange);
    const res = await installShellHook(home);
    expect(res.code).toBe(1);
    expect(await readFile(bashrc(), "utf8")).toBe(strange); // untouched
  });
});

describe("uninstall", () => {
  it("removes exactly the marked block and nothing else", async () => {
    const original = "export PATH=x\nalias g=git\n";
    await writeFile(bashrc(), original);
    await installShellHook(home);
    const res = await uninstallShellHook(home);
    expect(res.code).toBe(0);
    expect(await readFile(bashrc(), "utf8")).toBe(original); // byte-for-byte restore
  });

  it("reports nothing to remove when the block is absent", async () => {
    await writeFile(bashrc(), "export PATH=x\n");
    const res = await uninstallShellHook(home);
    expect(res.code).toBe(0);
    expect(await readFile(bashrc(), "utf8")).toBe("export PATH=x\n");
  });

  it("refuses to touch a corrupt rc", async () => {
    const strange = `${BEGIN}\n${HOOK_LINE}\n`; // no END
    await writeFile(bashrc(), strange);
    const res = await uninstallShellHook(home);
    expect(res.code).toBe(1);
    expect(await readFile(bashrc(), "utf8")).toBe(strange);
  });
});

describe("status reflects the three states", () => {
  it("installed — present in every existing rc", async () => {
    await writeFile(bashrc(), "x\n");
    await writeFile(zshrc(), "y\n");
    await installShellHook(home);
    const res = await statusShellHook(home);
    expect(res.verdict).toBe("installed");
  });

  it("absent — present in none", async () => {
    await writeFile(bashrc(), "x\n");
    const res = await statusShellHook(home);
    expect(res.verdict).toBe("absent");
  });

  it("partial — present in some but not all existing rc", async () => {
    await writeFile(bashrc(), "x\n");
    await writeFile(zshrc(), "y\n");
    // install everywhere, then hand-remove from .zshrc
    await installShellHook(home);
    await writeFile(zshrc(), "y\n");
    const res = await statusShellHook(home);
    expect(res.verdict).toBe("partial");
  });
});

describe("suggestInstallLine (discovery)", () => {
  it("offers the command when the hook is not installed", async () => {
    await writeFile(bashrc(), "x\n");
    const line = await suggestInstallLine(home);
    expect(line).not.toBeNull();
    expect(line).toContain("aipe shell-hook install");
  });

  it("stays silent once the hook is installed everywhere (no nagging)", async () => {
    await writeFile(bashrc(), "x\n");
    await installShellHook(home);
    expect(await suggestInstallLine(home)).toBeNull();
  });
});
