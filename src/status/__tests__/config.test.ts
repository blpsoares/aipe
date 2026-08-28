import { expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "yaml";
import { configCommand } from "../config";

async function ws(brain: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "aipe-cfg-"));
  await mkdir(join(dir, ".aipe"), { recursive: true });
  await writeFile(join(dir, ".aipe", "brain.yaml"), brain, "utf8");
  return dir;
}

const BRAIN_NO_FIELD =
  "context:\n  name: blpsoares\n  coordinator: Heisenberg\n  pe: bryao\nrepos:\n  - name: aipe\n    url: https://x/y.git\n    path: ./aipe\n";

function capture(): { spy: (s: string) => void; lines: string[] } {
  const lines: string[] = [];
  return { spy: (s) => lines.push(s), lines };
}

async function withOut<T>(fn: () => Promise<T>): Promise<{ out: string; result: T }> {
  const cap = capture();
  const orig = console.log;
  console.log = cap.spy as typeof console.log;
  try {
    const result = await fn();
    return { out: cap.lines.join("\n"), result };
  } finally {
    console.log = orig;
  }
}

test("with no flags, reports the current setting (default off when absent)", async () => {
  const dir = await ws(BRAIN_NO_FIELD);
  const { out, result } = await withOut(() => configCommand(["--workspace", dir]));
  expect(result).toBe(0);
  expect(out).toBe("STATUS-UPDATES auto=false format=detailed");
});

test("sets auto + format and persists them through the typed writer", async () => {
  const dir = await ws(BRAIN_NO_FIELD);
  const { result } = await withOut(() => configCommand(["--workspace", dir, "--auto", "true", "--format", "compact"]));
  expect(result).toBe(0);
  const brain = parse(await readFile(join(dir, ".aipe", "brain.yaml"), "utf8"));
  expect(brain.context.statusUpdates).toEqual({ auto: true, format: "compact" });
});

test("an invalid --format is a legible error, never a crash or silent default (inv.6)", async () => {
  const dir = await ws(BRAIN_NO_FIELD);
  const { out, result } = await withOut(() => configCommand(["--workspace", dir, "--format", "fancy"]));
  expect(result).toBe(1);
  expect(out).toContain("context.statusUpdates.format");
  // brain untouched
  const brain = parse(await readFile(join(dir, ".aipe", "brain.yaml"), "utf8"));
  expect(brain.context.statusUpdates).toBeUndefined();
});

test("an invalid --auto is rejected legibly", async () => {
  const dir = await ws(BRAIN_NO_FIELD);
  const { out, result } = await withOut(() => configCommand(["--workspace", dir, "--auto", "maybe"]));
  expect(result).toBe(1);
  expect(out).toContain("--auto must be true or false");
});

test("changing only --format keeps the existing auto value", async () => {
  const dir = await ws(
    "context:\n  name: blpsoares\n  coordinator: Heisenberg\n  statusUpdates:\n    auto: true\n    format: detailed\nrepos:\n  - name: aipe\n    url: https://x/y.git\n    path: ./aipe\n",
  );
  await withOut(() => configCommand(["--workspace", dir, "--format", "compact"]));
  const brain = parse(await readFile(join(dir, ".aipe", "brain.yaml"), "utf8"));
  expect(brain.context.statusUpdates).toEqual({ auto: true, format: "compact" });
});

test("round-trip preserves the existing keys and their order", async () => {
  const dir = await ws(BRAIN_NO_FIELD);
  await withOut(() => configCommand(["--workspace", dir, "--auto", "true", "--format", "detailed"]));
  const text = await readFile(join(dir, ".aipe", "brain.yaml"), "utf8");
  // name, coordinator, pe still present and before statusUpdates
  const iName = text.indexOf("name: blpsoares");
  const iCoord = text.indexOf("coordinator: Heisenberg");
  const iPe = text.indexOf("pe: bryao");
  const iSU = text.indexOf("statusUpdates");
  expect(iName).toBeGreaterThanOrEqual(0);
  expect(iCoord).toBeGreaterThan(iName);
  expect(iPe).toBeGreaterThan(iCoord);
  expect(iSU).toBeGreaterThan(iPe);
});

test("a missing brain is an error, not a crash", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-cfg-empty-"));
  const { out, result } = await withOut(() => configCommand(["--workspace", dir]));
  expect(result).toBe(1);
  expect(out).toContain("ERROR brain");
});
