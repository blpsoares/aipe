import { expect, test } from "bun:test";
import { validateContext } from "../validate";
import type { ContextInput } from "../types";

const base: ContextInput = {
  context: { name: "opvibes", coordinator: "Nicolas" },
  repos: [{ name: "embark", url: "git@github.com:opvibes/embark.git", path: "./embark" }],
};

test("accepts a valid input", () => {
  expect(validateContext(base)).toEqual({ ok: true });
});

test("rejects a context name that is not a slug", () => {
  const r = validateContext({ ...base, context: { name: "Op Vibes", coordinator: "Nicolas" } });
  expect(r.ok).toBe(false);
});

test("rejects an empty coordinator", () => {
  const r = validateContext({ ...base, context: { name: "opvibes", coordinator: "" } });
  expect(r.ok).toBe(false);
});

test("rejects an empty repo list", () => {
  const r = validateContext({ ...base, repos: [] });
  expect(r.ok).toBe(false);
});

test("rejects an invalid repo url", () => {
  const r = validateContext({ ...base, repos: [{ name: "x", url: "not-a-url", path: "./x" }] });
  expect(r.ok).toBe(false);
});

test("rejects a path that does not start with ./", () => {
  const r = validateContext({ ...base, repos: [{ name: "x", url: "git@github.com:o/x.git", path: "x" }] });
  expect(r.ok).toBe(false);
});

test("rejects duplicate repo names", () => {
  const r = validateContext({
    ...base,
    repos: [
      { name: "dup", url: "git@github.com:o/a.git", path: "./a" },
      { name: "dup", url: "git@github.com:o/b.git", path: "./b" },
    ],
  });
  expect(r.ok).toBe(false);
});

test("rejects duplicate paths", () => {
  const r = validateContext({
    ...base,
    repos: [
      { name: "a", url: "git@github.com:o/a.git", path: "./same" },
      { name: "b", url: "git@github.com:o/b.git", path: "./same" },
    ],
  });
  expect(r.ok).toBe(false);
});

test("accepts an https url with .git", () => {
  const r = validateContext({ ...base, repos: [{ name: "x", url: "https://github.com/o/x.git", path: "./x" }] });
  expect(r.ok).toBe(true);
});

test("rejects path './' (no segment)", () => {
  const r = validateContext({ ...base, repos: [{ name: "x", url: "git@github.com:o/x.git", path: "./" }] });
  expect(r.ok).toBe(false);
});

test("rejects path './/x' (empty segment)", () => {
  const r = validateContext({ ...base, repos: [{ name: "x", url: "git@github.com:o/x.git", path: ".//x" }] });
  expect(r.ok).toBe(false);
});

test("rejects path './../foo' (traversal)", () => {
  const r = validateContext({ ...base, repos: [{ name: "x", url: "git@github.com:o/x.git", path: "./../foo" }] });
  expect(r.ok).toBe(false);
});

test("accepts path './sub/dir'", () => {
  const r = validateContext({ ...base, repos: [{ name: "x", url: "git@github.com:o/x.git", path: "./sub/dir" }] });
  expect(r.ok).toBe(true);
});
