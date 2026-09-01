// THE CHOKEPOINT. Measured root cause of 2026-08-31: enforcement was opt-in at
// every level, and the level nobody watches is the CALL SITE. `recordDispatch`
// and `writeLedger` are the RAW writers — no gates, no evidence check, no QA
// check — and both are exported. `recordDispatchGuarded` is a wrapper beside
// them, not a door in front of them, so a new writer gets no gates by simply
// importing the other name. That is not hypothetical: `reconcile` writes
// `merged` this way, which is exactly how a merge nobody verified reached the
// ledger, and it took an independent QA to find that the same leak had been
// reopened three commits after it was closed.
//
// TypeScript cannot express "only these files may import this". A test can. This
// is the door: every raw write site is enumerated here WITH the reason it is
// allowed to bypass the gates. Adding one makes this test fail, which forces the
// question — should this be going through recordDispatchGuarded? — to be asked
// once, by a person, instead of never.
//
// To add a site: justify it here. To remove the need: route it through the gate.
import { expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const SRC = join(import.meta.dir, "..", "..");

// file → why this file is allowed to write the ledger without the gates.
const ALLOWED: Record<string, string> = {
  "journey/ledger.ts":
    "defines them; recordDispatchGuarded's own accepted write is the last line of the gate",
  "journey/reconcile.ts":
    "the FORGE is the authority on whether a PR merged, so this records what happened even when the QA never signed off — and stamps `qaGap` for the audit rather than absorbing it",
  "journey/dedupe-run.ts":
    "collapses duplicate ROWS; it changes identity, never status, so there is no claim for a gate to judge",
  "session/cli.ts":
    "writes back the agentop sessionId onto a row the gate already accepted — bookkeeping about a session, not a claim about the work",
};

const RAW_WRITE = /\b(recordDispatch|writeLedger)\s*\(/;

async function* sourceFiles(dir: string): AsyncGenerator<string> {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (e.name === "__tests__" || e.name === "node_modules") continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) yield* sourceFiles(full);
    else if (e.name.endsWith(".ts")) yield full;
  }
}

test("every raw ledger write site is enumerated, with the reason it may bypass the gates", async () => {
  const found: string[] = [];
  for await (const file of sourceFiles(SRC)) {
    const body = await readFile(file, "utf8");
    // `recordDispatchGuarded(` also matches `recordDispatch(` as a prefix, so
    // strip the guarded calls first — the guarded path is the door, not a bypass.
    const stripped = body.replace(/recordDispatchGuarded\s*\(/g, "GUARDED(");
    if (RAW_WRITE.test(stripped)) found.push(file.slice(SRC.length + 1));
  }
  const unexpected = found.filter((f) => !(f in ALLOWED));
  expect(unexpected).toEqual([]);
});

test("the allowlist has no dead entries — a justification outliving its call site is a lie", async () => {
  const live = new Set<string>();
  for await (const file of sourceFiles(SRC)) {
    const body = (await readFile(file, "utf8")).replace(/recordDispatchGuarded\s*\(/g, "GUARDED(");
    if (RAW_WRITE.test(body)) live.add(file.slice(SRC.length + 1));
  }
  expect(Object.keys(ALLOWED).filter((f) => !live.has(f))).toEqual([]);
});

test("exactly ONE module routes writes through the gate — so the gate is a door, not a suggestion", async () => {
  const callers: string[] = [];
  for await (const file of sourceFiles(SRC)) {
    if (/recordDispatchGuarded\s*\(/.test(await readFile(file, "utf8"))) {
      callers.push(file.slice(SRC.length + 1));
    }
  }
  // ledger.ts defines it; journey/cli.ts is the production caller. A THIRD name
  // here is not automatically wrong — but it must inject every resolver, or its
  // gates report `not-checked` and the fail-closed guard refuses the write.
  expect(callers.sort()).toEqual(["journey/cli.ts", "journey/ledger.ts"]);
});
