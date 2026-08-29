import { expect, test } from "bun:test";
import { normalizePath, overlappingPairs, pathSetsOverlap, pathsOverlap, WHOLE } from "../paths";

// ── normalization ───────────────────────────────────────────────────────────

test("normalizePath strips ./, collapses //, strips trailing /", () => {
  expect(normalizePath("./src/foo")).toBe("src/foo");
  expect(normalizePath("src//foo///bar")).toBe("src/foo/bar");
  expect(normalizePath("src/foo/")).toBe("src/foo");
});

test("normalizePath maps empty / . / / to the whole-unit path", () => {
  expect(normalizePath("")).toBe(WHOLE);
  expect(normalizePath(".")).toBe(WHOLE);
  expect(normalizePath("/")).toBe(WHOLE);
  expect(normalizePath("   ")).toBe(WHOLE);
});

// ── exact files ──────────────────────────────────────────────────────────────

test("the same exact file overlaps itself; two distinct files are disjoint", () => {
  expect(pathsOverlap("src/a.ts", "src/a.ts")).toBe(true);
  expect(pathsOverlap("src/a.ts", "src/b.ts")).toBe(false);
  expect(pathsOverlap("src/a.ts", "src/a.tsx")).toBe(false);
});

test("distinct directory subtrees are disjoint", () => {
  expect(pathsOverlap("src/dispatch", "src/journey")).toBe(false);
  expect(pathsOverlap("src/dispatch/lock.ts", "src/journey/ledger.ts")).toBe(false);
});

// ── prefix / subtree semantics (a bare path covers everything under it) ───────

test("a directory prefix overlaps a file under it", () => {
  expect(pathsOverlap("src/dispatch", "src/dispatch/lock.ts")).toBe(true);
  expect(pathsOverlap("src/dispatch/lock.ts", "src/dispatch")).toBe(true);
  // a sibling file outside the subtree does not
  expect(pathsOverlap("src/dispatch", "src/dispatchx.ts")).toBe(false);
});

test("nested prefixes overlap; a file above a subtree does not fall inside it", () => {
  expect(pathsOverlap("src", "src/dispatch/lock.ts")).toBe(true);
  expect(pathsOverlap("src/dispatch", "src")).toBe(true);
});

// ── the whole-unit path (no declared paths) collides with everything ──────────

test("WHOLE overlaps any concrete path — the backward-compatible repo lock", () => {
  expect(pathsOverlap(WHOLE, "src/a.ts")).toBe(true);
  expect(pathsOverlap("src/a.ts", WHOLE)).toBe(true);
  expect(pathsOverlap(WHOLE, WHOLE)).toBe(true);
});

// ── globs ────────────────────────────────────────────────────────────────────

test("** matches any depth", () => {
  expect(pathsOverlap("src/**", "src/dispatch/lock.ts")).toBe(true);
  expect(pathsOverlap("src/**/lock.ts", "src/dispatch/lock.ts")).toBe(true);
  expect(pathsOverlap("src/**", "docs/readme.md")).toBe(false);
});

test("a single * matches one segment only", () => {
  expect(pathsOverlap("src/*", "src/lock.ts")).toBe(true);
  // src/* is direct children only → does not reach a nested file
  expect(pathsOverlap("src/*", "src/dispatch/lock.ts")).toBe(false);
});

test("in-segment wildcards intersect precisely", () => {
  expect(pathsOverlap("src/*.ts", "src/lock.ts")).toBe(true);
  expect(pathsOverlap("src/*.ts", "src/lock.js")).toBe(false);
  // *.ts and foo.* share foo.ts → overlap
  expect(pathsOverlap("src/*.ts", "src/foo.*")).toBe(true);
  // *.ts and *.js can never share a file
  expect(pathsOverlap("src/*.ts", "src/*.js")).toBe(false);
});

// ── path SETS ────────────────────────────────────────────────────────────────

test("pathSetsOverlap: disjoint sets coexist, any overlapping pair collides", () => {
  expect(pathSetsOverlap(["src/dispatch"], ["src/journey"])).toBe(false);
  expect(pathSetsOverlap(["src/dispatch", "src/journey"], ["src/serve"])).toBe(false);
  expect(pathSetsOverlap(["src/dispatch", "src/serve"], ["src/serve/app"])).toBe(true);
});

test("an empty set means the whole unit — collides with any other set", () => {
  expect(pathSetsOverlap([], ["src/a.ts"])).toBe(true);
  expect(pathSetsOverlap(["src/a.ts"], [])).toBe(true);
  expect(pathSetsOverlap([], [])).toBe(true);
});

test("overlappingPairs reports exactly the colliding declared paths", () => {
  const pairs = overlappingPairs(["src/dispatch", "src/serve"], ["src/serve/app", "docs"]);
  expect(pairs).toEqual([["src/serve", "src/serve/app"]]);
  expect(overlappingPairs(["src/a"], ["src/b"])).toEqual([]);
});
