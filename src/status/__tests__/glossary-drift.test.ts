// Two surfaces show the PE the same states in Portuguese: this CLI table and the
// console (`src/serve/app/runtime/i18n.ts`). Two vocabularies for one set of
// states is one vocabulary too many — a person who reads "Aprovado" here and
// "Verificado" there has to learn that they are the same thing, which is exactly
// the translator the acceptance criterion forbids.
//
// They are NOT identical today, and this test says so out loud instead of
// letting the difference sit undetected. The CLI follows issue #109, where the
// PE wrote the words himself; the console predates it. Every divergence is
// listed below WITH which surface is authoritative and why. Change either side
// and this test fails, which forces the question to be answered once, by a
// person, rather than drifting further.
//
// Read as TEXT, never imported: i18n.ts pulls in @preact/signals, and dragging
// the browser bundle into the CLI to check a string would be a worse cure.
import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { statusWord } from "../tables";

const I18N = join(import.meta.dir, "..", "..", "serve", "app", "runtime", "i18n.ts");

// state → [what the CLI table says, what the console says today]
const KNOWN_DIVERGENCE: Record<string, { cli: string; console: string; why: string }> = {
  dispatched: {
    cli: "Designado",
    console: "Despachado",
    why: "#109 — the PE wrote 'Designado'; 'Despachado' is the dispatch machine's word, and the table's whole point is not to need that vocabulary",
  },
  verified: {
    cli: "Aprovado",
    console: "Verificado",
    why: "#109 — 'Aprovado' says a gate PASSED it; 'Verificado' only says it was looked at",
  },
};

async function consoleStrings(): Promise<Record<string, string>> {
  const src = await readFile(I18N, "utf8");
  // the pt block's status entries: s_<state>:"<word>"
  const out: Record<string, string> = {};
  const pt = src.slice(src.indexOf("  pt: {"));
  for (const m of pt.matchAll(/s_([a-z]+)\s*:\s*"([^"]+)"/g)) out[m[1]!] = m[2]!;
  return out;
}

test("where the CLI and the console agree, they agree exactly", async () => {
  const con = await consoleStrings();
  for (const [state, word] of Object.entries(con)) {
    if (state in KNOWN_DIVERGENCE) continue;
    const mine = statusWord(state as Parameters<typeof statusWord>[0]);
    // only states the CLI actually renders
    if (mine === state) continue;
    expect(`${state}:${mine}`).toBe(`${state}:${word}`);
  }
});

test("every listed divergence is REAL — a stale entry would hide a fresh drift", async () => {
  const con = await consoleStrings();
  for (const [state, d] of Object.entries(KNOWN_DIVERGENCE)) {
    expect(statusWord(state as Parameters<typeof statusWord>[0])).toBe(d.cli);
    expect(con[state]).toBe(d.console);
    expect(d.cli).not.toBe(d.console); // if they ever match, delete the entry
    expect(d.why.length).toBeGreaterThan(20); // a divergence with no reason is a bug
  }
});
