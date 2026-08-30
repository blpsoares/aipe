// The spec gate: `journey spec --approve` must ESTABLISH that a real, filled
// Orientation Spec exists before it records approval — it must not approve on the
// strength of the ledger record alone (the bug: it read nothing). And `--show`
// must not parrot `approved=true` over a file that has since gone missing.
import { expect, test } from "bun:test";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "yaml";
import { run } from "../cli";

async function ws(): Promise<string> {
  return mkdtemp(join(tmpdir(), "aipe-spec-gate-"));
}

async function capture(fn: () => Promise<number>): Promise<{ code: number; output: string }> {
  const original = console.log;
  const lines: string[] = [];
  console.log = (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  };
  try {
    const code = await fn();
    return { code, output: lines.join("\n") };
  } finally {
    console.log = original;
  }
}

const specPath = (id: string) => join(".aipe", "journeys", id, "orientation.md");

// A real, fully-substituted spec for the happy path — every canonical section,
// one unit scope, and NOT a single `<...>` placeholder left.
const FILLED = [
  "# Orientation Spec — j1",
  "## Problem",
  "Close the spec gate.",
  "## Cross-package contracts",
  "aipe consumes agentop >= 1.9.0.",
  "## Per-package scope",
  "### aipe",
  "- **Scope:** approve reads and validates the spec",
  "- **Acceptance:** the suite is green",
  "## Sequencing",
  "- **Wave 1:** aipe",
  "## Out of scope",
  "- the site",
  "",
].join("\n");

async function readApproved(dir: string, id: string): Promise<boolean | undefined> {
  const raw = await readFile(join(dir, ".aipe", "journeys", `${id}.yaml`), "utf8");
  return (parse(raw) as { spec?: { approved?: boolean } }).spec?.approved;
}

test("--approve REFUSES the raw scaffold template — placeholders intact are not a filled spec (the real case)", async () => {
  const dir = await ws();
  try {
    await run(["start", "--workspace", dir, "--id", "j1"]);
    // Scaffold, no edits — exactly what the coordinator gets before filling it.
    await run(["spec", "--workspace", dir, "--journey", "j1", "--units", "aipe"]);

    const { code, output } = await capture(() =>
      run(["spec", "--workspace", dir, "--journey", "j1", "--approve"]),
    );
    expect(code).toBe(1);
    expect(output).toContain("REJECT placeholder");
    expect(output).toContain("REJECT not-approvable");
    // …and the ledger was NOT flipped to approved.
    expect(await readApproved(dir, "j1")).toBe(false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("--approve REFUSES when the ledger records a spec but its file is absent", async () => {
  const dir = await ws();
  try {
    await run(["start", "--workspace", dir, "--id", "j1"]);
    await run(["spec", "--workspace", dir, "--journey", "j1", "--units", "aipe"]);
    // Delete the file out from under the record.
    await rm(join(dir, specPath("j1")));

    const { code, output } = await capture(() =>
      run(["spec", "--workspace", dir, "--journey", "j1", "--approve"]),
    );
    expect(code).toBe(1);
    expect(output).toContain("REJECT missing-file");
    expect(await readApproved(dir, "j1")).toBe(false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("--approve REFUSES an empty spec file", async () => {
  const dir = await ws();
  try {
    await run(["start", "--workspace", dir, "--id", "j1"]);
    await run(["spec", "--workspace", dir, "--journey", "j1", "--units", "aipe"]);
    await writeFile(join(dir, specPath("j1")), "   \n\n", "utf8");

    const { code, output } = await capture(() =>
      run(["spec", "--workspace", dir, "--journey", "j1", "--approve"]),
    );
    expect(code).toBe(1);
    expect(output).toContain("REJECT empty-file");
    expect(await readApproved(dir, "j1")).toBe(false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("--approve ACCEPTS a fully substituted spec (the legit path still works)", async () => {
  const dir = await ws();
  try {
    await run(["start", "--workspace", dir, "--id", "j1"]);
    await run(["spec", "--workspace", dir, "--journey", "j1", "--units", "aipe"]);
    await writeFile(join(dir, specPath("j1")), FILLED, "utf8");

    const { code, output } = await capture(() =>
      run(["spec", "--workspace", dir, "--journey", "j1", "--approve"]),
    );
    expect(code).toBe(0);
    expect(output).toContain("OK approved journey=j1");
    expect(await readApproved(dir, "j1")).toBe(true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("--check reproves the raw template (placeholders), where it used to pass", async () => {
  const dir = await ws();
  try {
    await run(["start", "--workspace", dir, "--id", "j1"]);
    await run(["spec", "--workspace", dir, "--journey", "j1", "--units", "aipe"]);

    const { code, output } = await capture(() =>
      run(["spec", "--workspace", dir, "--journey", "j1", "--units", "aipe", "--check"]),
    );
    expect(code).toBe(1);
    expect(output).toContain("REJECT placeholder");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("--check passes a fully substituted spec", async () => {
  const dir = await ws();
  try {
    await run(["start", "--workspace", dir, "--id", "j1"]);
    await run(["spec", "--workspace", dir, "--journey", "j1", "--units", "aipe"]);
    await writeFile(join(dir, specPath("j1")), FILLED, "utf8");

    const { code, output } = await capture(() =>
      run(["spec", "--workspace", dir, "--journey", "j1", "--units", "aipe", "--check"]),
    );
    expect(code).toBe(0);
    expect(output).toContain("OK spec journey=j1");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("--show reports INCONSISTENT (not approved=true) when the approved spec's file is missing", async () => {
  const dir = await ws();
  try {
    await run(["start", "--workspace", dir, "--id", "j1"]);
    await run(["spec", "--workspace", dir, "--journey", "j1", "--units", "aipe"]);
    await writeFile(join(dir, specPath("j1")), FILLED, "utf8");
    await run(["spec", "--workspace", dir, "--journey", "j1", "--approve"]);
    // Now the file disappears but the record still says approved=true.
    await rm(join(dir, specPath("j1")));

    const { code, output } = await capture(() =>
      run(["spec", "--workspace", dir, "--journey", "j1", "--show"]),
    );
    expect(code).toBe(1);
    expect(output).toContain("INCONSISTENT");
    expect(output).not.toContain("approved=true");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("--show prints the normal SPEC line when the approved file is present", async () => {
  const dir = await ws();
  try {
    await run(["start", "--workspace", dir, "--id", "j1"]);
    await run(["spec", "--workspace", dir, "--journey", "j1", "--units", "aipe"]);
    await writeFile(join(dir, specPath("j1")), FILLED, "utf8");
    await run(["spec", "--workspace", dir, "--journey", "j1", "--approve"]);

    const { code, output } = await capture(() =>
      run(["spec", "--workspace", dir, "--journey", "j1", "--show"]),
    );
    expect(code).toBe(0);
    expect(output).toContain("approved=true");
    expect(output).not.toContain("INCONSISTENT");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("--amend on a filled, approved spec bumps the version and re-opens approval (legit path intact)", async () => {
  const dir = await ws();
  try {
    await run(["start", "--workspace", dir, "--id", "j1"]);
    await run(["spec", "--workspace", dir, "--journey", "j1", "--units", "aipe"]);
    await writeFile(join(dir, specPath("j1")), FILLED, "utf8");
    await run(["spec", "--workspace", dir, "--journey", "j1", "--approve"]);
    expect(await readApproved(dir, "j1")).toBe(true);

    // Amend bumps the version and resets approval to false (needs re-approval),
    // never clobbering the edited file that is already on disk.
    const { code, output } = await capture(() =>
      run(["spec", "--workspace", dir, "--journey", "j1", "--amend"]),
    );
    expect(code).toBe(0);
    expect(output).toContain("v2");
    expect(await readApproved(dir, "j1")).toBe(false);
    // The filled file survived the amend (EXISTS, never re-scaffolded).
    await access(join(dir, specPath("j1")));
    expect(await readFile(join(dir, specPath("j1")), "utf8")).toBe(FILLED);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
