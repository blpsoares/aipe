import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stringify } from "yaml";
import { runSkill } from "../cli";

async function ws(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "aipe-floor-"));
  await mkdir(join(dir, ".aipe"), { recursive: true });
  await mkdir(join(dir, "embark"), { recursive: true });
  await writeFile(
    join(dir, ".aipe", "brain.yaml"),
    stringify({ context: { name: "opvibes", coordinator: "Nic" }, repos: [{ name: "embark", url: "u", path: "./embark" }] }),
    "utf8",
  );
  return dir;
}

test("skill preset installs the reliability floor (verify-before-done + review-delivery) into every repo", async () => {
  const dir = await ws();
  try {
    const code = await runSkill(["preset", "--workspace", dir]);
    expect(code).toBe(0);

    for (const name of ["verify-before-done", "review-delivery"]) {
      // published source of truth
      const src = await readFile(join(dir, ".aipe", "skills", name, "SKILL.md"), "utf8");
      expect(src).toContain(`name: ${name}`);
      // installed into the repo so a dispatched specialist can invoke it
      const inRepo = await readFile(join(dir, "embark", ".claude", "skills", name, "SKILL.md"), "utf8");
      expect(inRepo).toContain(`name: ${name}`);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
