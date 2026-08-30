// Layout regression guard for the Atividade board (j-20260829-dp gate, B1).
//
// The bug: `.acol-body` is a flex column; its cards had no `flex-shrink:0`, so
// flexbox squeezed 62 cards to ~2px each (empty cards, dead scroll, clipped
// content) instead of keeping their height and letting the column scroll. The
// one-line fix is `.acol-body .acard { flex:0 0 auto }`.
//
// WHY a CSS-source guard and not a rendered-layout test: the view suite runs in
// happy-dom, which computes NO layout (offsetHeight/scrollHeight are 0), which is
// exactly why 1585 green tests missed the collapse. With no browser available in
// CI, the deterministic thing that catches a re-break is asserting the invariant
// in the stylesheet itself: a flex-column card list MUST give its cards a
// non-shrinking flex. If a browser is wired up later, add a rendered assertion
// (column taller than viewport → cards keep height, container scrolls).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";

const norm = readFileSync(join(import.meta.dir, "../styles/base.css"), "utf8").replace(/\s+/g, " ");

// The declaration block for the rule whose selector is EXACTLY `selector`.
function block(selector: string): string {
  const at = norm.indexOf(`${selector} {`);
  if (at < 0) return "";
  return norm.slice(at, norm.indexOf("}", at));
}

describe("Atividade board layout invariants (B1)", () => {
  test(".acol-body is a flex column (the context that makes shrink dangerous)", () => {
    const b = block(".acol-body");
    expect(b).toContain("display: flex");
    expect(b).toContain("flex-direction: column");
  });

  test("cards inside the flex column DO NOT shrink (else they collapse to ~2px)", () => {
    const b = block(".acol-body .acard");
    expect(b).not.toBe("");
    // accept `flex: 0 0 auto` or an explicit `flex-shrink: 0`
    expect(/flex: 0 0 auto|flex-shrink: 0/.test(b)).toBe(true);
  });
});
