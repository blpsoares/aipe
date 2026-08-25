import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse, stringify } from "yaml";
import { runHireSpecialistsMerge } from "../run";
import { mergeRegistry } from "../registry";
import type { BrainFile, PersonaRegistryEntry, PersonaReport } from "../types";

const brain2: BrainFile = {
  context: { name: "opvibes", coordinator: "Nicolas" },
  repos: [
    { name: "embark", url: "u", path: "./embark", stack: ["typescript"] },
    { name: "prontuario", url: "u", path: "./prontuario", stack: ["python"] },
  ],
};

test("mergeRegistry keeps existing personas and adds new repo's, deduped", () => {
  const existing: PersonaRegistryEntry[] = [
    { name: "Nicolas", role: "coordinator", repo: null, path: null },
    { name: "Joaquim", role: "dev-fullstack", repo: "embark", path: "./embark/.claude/skills/joaquim" },
    { name: "Marina", role: "qa", repo: "embark", path: "./embark/.claude/skills/marina" },
  ];
  const reports: PersonaReport[] = [
    { repo: "prontuario", role: "dev-fullstack", name: "Pedro", body: "b" },
    { repo: "prontuario", role: "qa", name: "Karen", body: "b" },
  ];
  const merged = mergeRegistry(brain2, existing, reports);
  expect(merged.map((e) => e.name).sort()).toEqual(["Joaquim", "Karen", "Marina", "Nicolas", "Pedro"]);
  expect(merged.filter((e) => e.role === "coordinator")).toHaveLength(1);
});

// D3 (CRITICAL — data loss): the real incident. `mergeRegistry`'s `replaced`
// key was `${repo}|${role}`, blind to `package`. In a monorepo where one
// (repo, role) has MANY personas — one per package — adding a single new
// package's report for that (repo, role) evicted EVERY existing persona of
// that (repo, role) across ALL other packages: 64 personas collapsed to 3
// (coordinator + the 2 new). The union must key on the package too, so a new
// package's persona replaces only its own (repo, role, package) slot and
// leaves every other package's persona — names AND packages — intact.
test("mergeRegistry adding a new package's personas preserves every other package's personas of the same (repo, role) (D3)", () => {
  const brainMono: BrainFile = {
    context: { name: "opvibes", coordinator: "Heisenberg" },
    repos: [{ name: "openvibes-embark", url: "u", path: "./openvibes-embark" }],
  };
  const existing: PersonaRegistryEntry[] = [
    { name: "Heisenberg", role: "coordinator", repo: null, path: null },
    { name: "Ann", role: "dev-fullstack", repo: "openvibes-embark", path: "p/ann", package: "core" },
    { name: "Bob", role: "qa", repo: "openvibes-embark", path: "p/bob", package: "core" },
    { name: "Cid", role: "dev-fullstack", repo: "openvibes-embark", path: "p/cid", package: "tui" },
    { name: "Dot", role: "qa", repo: "openvibes-embark", path: "p/dot", package: "tui" },
  ];
  const reports: PersonaReport[] = [
    { repo: "openvibes-embark", role: "dev-fullstack", name: "Lawson", body: "b", package: "aipe-site" },
    { repo: "openvibes-embark", role: "qa", name: "Zed", body: "b", package: "aipe-site" },
  ];
  const merged = mergeRegistry(brainMono, existing, reports);

  // All 5 existing (coordinator + 4 package personas) + 2 new = 7 survive.
  expect(merged.map((e) => e.name).sort()).toEqual(["Ann", "Bob", "Cid", "Dot", "Heisenberg", "Lawson", "Zed"]);

  // Packages are intact: the existing package personas keep their package.
  const byName = new Map(merged.map((e) => [e.name, e]));
  expect(byName.get("Ann")?.package).toBe("core");
  expect(byName.get("Cid")?.package).toBe("tui");
  expect(byName.get("Lawson")?.package).toBe("aipe-site");
  expect(byName.get("Zed")?.package).toBe("aipe-site");
});

// Re-hiring the SAME (repo, role, package) still replaces that exact slot —
// the union must not turn into "append forever" and leave a stale duplicate.
test("mergeRegistry replacing a persona in an existing package slot swaps just that one, keeping the package", () => {
  const brainMono: BrainFile = {
    context: { name: "opvibes", coordinator: "Heisenberg" },
    repos: [{ name: "openvibes-embark", url: "u", path: "./openvibes-embark" }],
  };
  const existing: PersonaRegistryEntry[] = [
    { name: "Heisenberg", role: "coordinator", repo: null, path: null },
    { name: "Ann", role: "dev-fullstack", repo: "openvibes-embark", path: "p/ann", package: "core" },
    { name: "Cid", role: "dev-fullstack", repo: "openvibes-embark", path: "p/cid", package: "tui" },
  ];
  // A fresh dev-fullstack for the SAME package "core" replaces Ann; tui's Cid stays.
  const reports: PersonaReport[] = [
    { repo: "openvibes-embark", role: "dev-fullstack", name: "Ana", body: "b", package: "core" },
  ];
  const merged = mergeRegistry(brainMono, existing, reports);
  expect(merged.map((e) => e.name).sort()).toEqual(["Ana", "Cid", "Heisenberg"]);
  const byName = new Map(merged.map((e) => [e.name, e]));
  expect(byName.get("Ana")?.package).toBe("core");
  expect(byName.get("Cid")?.package).toBe("tui");
});

test("runHireSpecialistsMerge adds a new repo's personas without touching existing ones", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-merge-"));
  try {
    await mkdir(join(dir, ".aipe"), { recursive: true });
    await writeFile(join(dir, ".aipe", "brain.yaml"), stringify(brain2), "utf8");
    await writeFile(
      join(dir, ".aipe", "state.yaml"),
      stringify({ phase: { brain: "done", workspace: "done", relationship: "done", specialists: "pending" } }),
      "utf8",
    );
    // existing roster: embark already hired
    await writeFile(
      join(dir, ".aipe", "personas.yaml"),
      stringify({
        personas: [
          { name: "Nicolas", role: "coordinator", repo: null, path: null },
          { name: "Joaquim", role: "dev-fullstack", repo: "embark", path: "./embark/.claude/skills/joaquim" },
          { name: "Marina", role: "qa", repo: "embark", path: "./embark/.claude/skills/marina" },
        ],
      }),
      "utf8",
    );
    // stage only the new repo's two reports
    const reportsDir = join(dir, ".aipe", "specialists", ".reports");
    await mkdir(reportsDir, { recursive: true });
    await writeFile(join(reportsDir, "prontuario-dev-fullstack.json"), JSON.stringify({ repo: "prontuario", role: "dev-fullstack", name: "Pedro", body: "You are Pedro." }));
    await writeFile(join(reportsDir, "prontuario-qa.json"), JSON.stringify({ repo: "prontuario", role: "qa", name: "Karen", body: "You are Karen." }));

    const result = await runHireSpecialistsMerge(dir);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.phase).toBe("done");

    const roster = parse(await readFile(join(dir, ".aipe", "personas.yaml"), "utf8"));
    expect(roster.personas.map((p: { name: string }) => p.name).sort()).toEqual(["Joaquim", "Karen", "Marina", "Nicolas", "Pedro"]);

    // new persona installed + dual-written
    expect(await readFile(join(dir, "prontuario", ".claude", "skills", "pedro", "SKILL.md"), "utf8")).toContain("You are Pedro.");
    expect(await readFile(join(dir, ".aipe", "personas", "prontuario", "pedro", "SKILL.md"), "utf8")).toContain("You are Pedro.");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// D3, end to end: adding a new package's two reports into a monorepo roster
// that is ALREADY complete must (1) preserve every existing package's personas
// on disk, and (2) report the repo as covered — not print MISSING for it and
// flip phase to `pending`, which is the "phase report is also wrong" symptom
// that broke /operate's precondition.
test("runHireSpecialistsMerge on a monorepo preserves all packages' personas and reports the repo as covered (D3)", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-merge-mono-"));
  try {
    const brainMono: BrainFile = {
      context: { name: "opvibes", coordinator: "Heisenberg" },
      repos: [{ name: "openvibes-embark", url: "u", path: "./openvibes-embark", stack: ["typescript"] }],
    };
    await mkdir(join(dir, ".aipe"), { recursive: true });
    await writeFile(join(dir, ".aipe", "brain.yaml"), stringify(brainMono), "utf8");
    await writeFile(
      join(dir, ".aipe", "state.yaml"),
      stringify({ phase: { brain: "done", workspace: "done", relationship: "done", specialists: "done" } }),
      "utf8",
    );
    // A complete roster: two packages, both roles each.
    await writeFile(
      join(dir, ".aipe", "personas.yaml"),
      stringify({
        personas: [
          { name: "Heisenberg", role: "coordinator", repo: null, path: null },
          { name: "Ann", role: "dev-fullstack", repo: "openvibes-embark", path: "./openvibes-embark/.claude/skills/ann", package: "core" },
          { name: "Bob", role: "qa", repo: "openvibes-embark", path: "./openvibes-embark/.claude/skills/bob", package: "core" },
          { name: "Cid", role: "dev-fullstack", repo: "openvibes-embark", path: "./openvibes-embark/.claude/skills/cid", package: "tui" },
          { name: "Dot", role: "qa", repo: "openvibes-embark", path: "./openvibes-embark/.claude/skills/dot", package: "tui" },
        ],
      }),
      "utf8",
    );
    // Stage two reports for a NEW package "aipe-site".
    const reportsDir = join(dir, ".aipe", "specialists", ".reports");
    await mkdir(reportsDir, { recursive: true });
    await writeFile(join(reportsDir, "a.json"), JSON.stringify({ repo: "openvibes-embark", role: "dev-fullstack", name: "Lawson", body: "You are Lawson.", package: "aipe-site" }));
    await writeFile(join(reportsDir, "b.json"), JSON.stringify({ repo: "openvibes-embark", role: "qa", name: "Zed", body: "You are Zed.", package: "aipe-site" }));

    const result = await runHireSpecialistsMerge(dir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // The repo is covered by both roles → reported ok, phase stays done.
    expect(result.results.every((r) => r.status === "ok")).toBe(true);
    expect(result.phase).toBe("done");

    // Every existing package's persona + the 2 new ones survive on disk, with packages intact.
    const roster = parse(await readFile(join(dir, ".aipe", "personas.yaml"), "utf8"));
    expect(roster.personas.map((p: { name: string }) => p.name).sort()).toEqual(["Ann", "Bob", "Cid", "Dot", "Heisenberg", "Lawson", "Zed"]);
    const byName = new Map(roster.personas.map((p: { name: string; package?: string }) => [p.name, p.package]));
    expect(byName.get("Ann")).toBe("core");
    expect(byName.get("Cid")).toBe("tui");
    expect(byName.get("Lawson")).toBe("aipe-site");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
