import { expect, test } from "bun:test";
import { KITS, kitNames, resolveKit } from "../registry";

test("registry knows the three curated kits", () => {
  expect(kitNames().sort()).toEqual(["pdd", "sdd-lite", "spec-kit"]);
});

test("resolveKit is case-insensitive and unknown → undefined", () => {
  expect(resolveKit("SDD-Lite")?.name).toBe("sdd-lite");
  expect(resolveKit("nope")).toBeUndefined();
});

test("every kit has content and metadata", () => {
  for (const name of kitNames()) {
    const k = KITS[name]!;
    expect(k.content.length).toBeGreaterThan(50);
    expect(k.content).toContain(`name: ${k.name}`);
    expect(k.description.length).toBeGreaterThan(0);
    expect(k.whenToUse.length).toBeGreaterThan(0);
  }
});

test("sdd-lite is the always-on floor (no routing gate); spec-kit/pdd are routed", () => {
  expect(resolveKit("sdd-lite")?.routing).toBeUndefined();
  expect(resolveKit("spec-kit")?.routing?.minSize).toBe("medium");
  expect(resolveKit("pdd")?.routing?.taskTypes).toContain("migration");
});
