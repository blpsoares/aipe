// Palette parity + anti-divergence guard (SDD §9, j-20260829-dp).
//
// The console adopted the SITE's design tokens (packages/aipe-site/src/index.css
// in openvibes-embark) VERBATIM: a violet brand and — the point — one semantic
// token PER ledger state (`--st-*`). This guard makes the two invariants the
// coordinator asked for provable in CI:
//   1. Every ledger state is painted through its own `--st-*` token, never a
//      hand-picked generic — so two places can't color the same state
//      differently (that is how the divergence was born).
//   2. The `--st-*` values match the site's, in BOTH themes — so a silent drift
//      from the site is a failing test, not a surprise the PE finds by eye.
// The site lives in another repo; until a shared token package exists (SDD §9,
// cross-repo, coordinator's matter), these pinned values ARE the contract.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { stateVar, STATE_KEYS } from "../runtime/statusMeta";
import { orgColor } from "../runtime/org";
import { DISPATCH_STATUSES } from "../../../journey/types";

const tokensCss = readFileSync(join(import.meta.dir, "../styles/tokens.css"), "utf8");

// Pinned from openvibes-embark:packages/aipe-site/src/index.css @ origin/main.
// RGB triples (space-separated) so `rgb(var(--x) / <a>)` alpha keeps working.
const SITE_ST_LIGHT: Record<string, string> = {
  dispatched: "28 104 214",
  running: "168 106 8",
  delivered: "8 128 116",
  verified: "22 143 57",
  failed: "200 38 38",
  escalated: "188 80 12",
  merged: "132 58 226",
  redirected: "12 130 148",
  removed: "92 98 118",
};
const SITE_ST_DARK: Record<string, string> = {
  dispatched: "76 154 255",
  running: "245 172 60",
  delivered: "32 202 182",
  verified: "61 210 100",
  failed: "255 104 104",
  escalated: "255 146 62",
  merged: "199 116 236",
  redirected: "44 205 226",
  removed: "128 134 158",
};
// Only the tokens the console adopts as canonical TRIPLES are pinned here. The
// site's `--line`/`--line-soft` are consumed raw as colors by base.css, so they
// live as resolved-color aliases (`--line`/`--line-2`), not triples — excluded.
const SITE_CHASSIS_LIGHT: Record<string, string> = {
  "surface-1": "255 255 255",
  "surface-2": "240 242 248",
  "surface-3": "231 234 243",
  text: "20 21 31",
  muted: "74 78 96",
  faint: "118 123 143",
  brand: "98 66 224",
  "brand-strong": "82 52 206",
};
const SITE_CHASSIS_DARK: Record<string, string> = {
  "surface-1": "16 17 26",
  text: "233 234 242",
  brand: "141 125 255",
};

const countOf = (needle: string) => tokensCss.split(needle).length - 1;

describe("state coloring goes through --st-* (invariant 1)", () => {
  test("every ledger status maps to a defined --st-* token", () => {
    for (const status of DISPATCH_STATUSES) {
      const v = stateVar(status);
      expect(v).toMatch(/^rgb\(var\(--st-[a-z]+\)\)$/);
      const key = v.slice("rgb(var(--st-".length, -2);
      expect(STATE_KEYS as readonly string[]).toContain(key);
      // the token it names must actually be declared in tokens.css
      expect(tokensCss).toContain(`--st-${key}:`);
    }
  });

  test("orgColor paints worker state with --st-*, never a generic hue", () => {
    for (const s of ["active", "dispatched", "delivered", "verified", "escalated", "failed", "redirected", "available", "idle", undefined]) {
      expect(orgColor(s)).toMatch(/^rgb\(var\(--st-[a-z]+\)\)$/);
    }
    // regression from the whole-branch review: redirected must not read as idle
    expect(orgColor("redirected")).not.toBe(orgColor("available"));
  });

  test("running and redirected are now distinct hues (the site models them apart)", () => {
    expect(stateVar("redirected")).not.toBe(stateVar("escalated"));
    expect(stateVar("delivered")).not.toBe(stateVar("verified"));
    expect(stateVar("verified")).not.toBe(stateVar("merged"));
  });
});

describe("--st-* values match the site, both themes (invariant 2)", () => {
  for (const [key, light] of Object.entries(SITE_ST_LIGHT)) {
    test(`--st-${key} light = "${light}"`, () => {
      // present in the two light contexts: bare :root and :root[data-theme="light"]
      expect(countOf(`--st-${key}: ${light};`)).toBe(2);
    });
  }
  for (const [key, dark] of Object.entries(SITE_ST_DARK)) {
    test(`--st-${key} dark = "${dark}"`, () => {
      // present in the two dark contexts: @media(prefers dark) and [data-theme="dark"]
      expect(countOf(`--st-${key}: ${dark};`)).toBe(2);
    });
  }
});

describe("chassis tokens adopted from the site", () => {
  for (const [key, light] of Object.entries(SITE_CHASSIS_LIGHT)) {
    test(`--${key} light = "${light}"`, () => {
      expect(countOf(`--${key}: ${light};`)).toBe(2);
    });
  }
  for (const [key, dark] of Object.entries(SITE_CHASSIS_DARK)) {
    test(`--${key} dark = "${dark}"`, () => {
      expect(countOf(`--${key}: ${dark};`)).toBe(2);
    });
  }
  test("brand is violet, not the old emerald accent", () => {
    expect(tokensCss).toContain("--brand: 98 66 224");
    expect(tokensCss).not.toContain("#059669");
  });
});
