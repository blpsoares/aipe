// #118 T1: a new workspace is BORN with the full spec-kit — `aipe skill preset`
// (run by hire-specialists during onboarding) materializes it into every repo,
// not merely suggests it. This is the root fix: the full SDD flow being
// unreachable is what let 7/7 deliveries skip spec+plan.
import { expect, test } from "bun:test";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stringify } from "yaml";
import { runSkill } from "../cli";
import { readToolbox } from "../catalog";

async function ws(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "aipe-preset-sdd-"));
  await mkdir(join(dir, ".aipe"), { recursive: true });
  await mkdir(join(dir, "embark"), { recursive: true });
  await mkdir(join(dir, "aipe"), { recursive: true });
  await writeFile(
    join(dir, ".aipe", "brain.yaml"),
    stringify({
      context: { name: "opvibes", coordinator: "Nic" },
      repos: [
        { name: "embark", url: "u", path: "./embark" },
        { name: "aipe", url: "u2", path: "./aipe" },
      ],
    }),
    "utf8",
  );
  return dir;
}

const exists = async (p: string): Promise<boolean> => access(p).then(() => true).catch(() => false);

test("skill preset materializes the full spec-kit into EVERY repo — SKILL.md + .specify/ + /speckit.* commands", async () => {
  const dir = await ws();
  try {
    const code = await runSkill(["preset", "--workspace", dir]);
    expect(code).toBe(0);

    for (const repo of ["embark", "aipe"]) {
      // the SKILL.md floor is installed…
      const src = await readFile(join(dir, repo, ".claude", "skills", "spec-kit", "SKILL.md"), "utf8");
      expect(src).toContain("name: spec-kit");
      // …AND the real Spec Kit is materialized (the /speckit.* flow the SKILL.md points to)
      expect(await exists(join(dir, repo, ".specify"))).toBe(true);
      expect(await exists(join(dir, repo, ".claude", "commands", "speckit.specify.md"))).toBe(true);
    }

    // recorded in the published toolbox so `skill match` can route it
    const tb = await readToolbox(dir);
    const specKit = tb.skills.find((s) => s.name === "spec-kit");
    expect(specKit?.repos.sort()).toEqual(["aipe", "embark"]);
    expect(specKit?.routing?.minSize).toBe("medium"); // the threshold that makes --size real
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
