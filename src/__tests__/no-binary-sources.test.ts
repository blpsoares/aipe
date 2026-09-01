// A raw NUL byte in a `.ts` file makes git classify the whole file as BINARY.
// It still compiles, still passes every test, and `git diff` shows `- -` instead
// of a diff: the file cannot be reviewed, by a person or by a code-review tool.
//
// This shipped in v1.18.1 (`src/status/tables.ts`, a grouping key written with
// literal NULs instead of an escape) and an independent QA found it, not the
// author — who had hit the identical defect before and still shipped it. A rule
// you have to remember is not a rule; this is the same lesson as every other
// gate in this repository.
//
// Checked over every tracked source file, not just the one that broke: the
// defect is a property of the bytes, not of a module.
import { expect, test } from "bun:test";
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

const SRC = join(import.meta.dir, "..");

async function* sourceFiles(dir: string): AsyncGenerator<string> {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === "dist") continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) yield* sourceFiles(full);
    else if (/\.(ts|tsx|md|json|yaml|yml)$/.test(e.name)) yield full;
  }
}

test("no source file contains a raw NUL byte — a NUL makes it unreviewable", async () => {
  const offenders: string[] = [];
  for await (const file of sourceFiles(SRC)) {
    // skip anything genuinely large/binary-ish that slipped into src by mistake;
    // a real source file is never megabytes
    if ((await stat(file)).size > 2_000_000) continue;
    const buf = await readFile(file);
    if (buf.includes(0)) offenders.push(`${file.slice(SRC.length + 1)} (${buf.filter((b) => b === 0).length} NUL)`);
  }
  // If this fails: you meant an ESCAPE (`\\0`, `\\u0000`) and wrote the byte. Or
  // better — do not use a control character as a delimiter at all; a separator
  // can collide with the data, and `JSON.stringify` of the parts cannot.
  expect(offenders).toEqual([]);
});
