import { expect, test } from "bun:test";
import { inferKind } from "../kind";

test("a declared kind always wins", () => {
  expect(inferKind("api", ["React"], "lib")).toBe("lib");
  expect(inferKind("anything", [], "  api  ")).toBe("api");
});

test("stack is the strongest signal", () => {
  expect(inferKind("svc", ["Go", "Postgres"])).toBe("api");
  expect(inferKind("svc", ["React", "Tailwind"])).toBe("web");
  expect(inferKind("svc", ["Next.js"])).toBe("web");
});

test("name hints kick in when the stack is inconclusive", () => {
  expect(inferKind("checkout-api", ["TypeScript"])).toBe("api");
  expect(inferKind("web", ["TypeScript"])).toBe("web");
  expect(inferKind("shared-core", ["TypeScript"])).toBe("lib");
});

test("falls back to service when nothing matches", () => {
  expect(inferKind("embark", ["TypeScript", "Bun"])).toBe("service");
  expect(inferKind("thing", [])).toBe("service");
});
