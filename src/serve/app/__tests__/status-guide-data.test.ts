import { test, expect } from "bun:test";
import { canonicalGuide, transientGuide, rejectedGuide, ALL_DISPATCH_STATUSES, EVIDENCE_STATUSES } from "../runtime/status-guide";
import { STR } from "../runtime/i18n";

test("the canonical guide covers EVERY real DispatchStatus, none extra (no drift)", () => {
  const guided = new Set(canonicalGuide().map((e) => e.key));
  for (const s of ALL_DISPATCH_STATUSES) expect(guided.has(s)).toBe(true);
  expect(guided.size).toBe(ALL_DISPATCH_STATUSES.length);
});

test("every guide entry names what it means, what causes it, what unblocks it, and who acts", () => {
  const entries = [...canonicalGuide(), ...transientGuide(), ...rejectedGuide()];
  for (const e of entries) {
    for (const k of [e.meaning, e.cause, e.unblock, e.who, ...e.laws]) {
      // Each field is an i18n key that must resolve in both languages (t() falls
      // back to en, so asserting en covers both; pt is checked below).
      expect(STR.en[k]).toBeDefined();
      expect(STR.pt[k]).toBeDefined();
    }
  }
});

test("the reject page names the evidence-required statuses precisely", () => {
  // delivered + verified + failed (D4, j-20260830-w0) are the claims the
  // ledger rejects without proof — a QA rejection must show what it checked
  // too, or it is indistinguishable from a session that died with no verdict.
  expect([...EVIDENCE_STATUSES].sort()).toEqual(["delivered", "failed", "verified"]);
  expect(rejectedGuide().some((e) => e.key === "no-evidence")).toBe(true);
});
