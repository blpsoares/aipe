import { expect, test } from "bun:test";
import { validateContext } from "../validate";
import type { ContextInput } from "../types";

const base: ContextInput = {
  context: { name: "opvibes", coordinator: "Nicolas" },
  repos: [{ name: "embark", url: "git@github.com:opvibes/embark.git", path: "./embark" }],
};

test("aceita um input válido", () => {
  expect(validateContext(base)).toEqual({ ok: true });
});

test("rejeita nome de contexto que não é slug", () => {
  const r = validateContext({ ...base, context: { name: "Op Vibes", coordinator: "Nicolas" } });
  expect(r.ok).toBe(false);
});

test("rejeita coordenador vazio", () => {
  const r = validateContext({ ...base, context: { name: "opvibes", coordinator: "" } });
  expect(r.ok).toBe(false);
});

test("rejeita lista de repos vazia", () => {
  const r = validateContext({ ...base, repos: [] });
  expect(r.ok).toBe(false);
});

test("rejeita url de repo inválida", () => {
  const r = validateContext({ ...base, repos: [{ name: "x", url: "not-a-url", path: "./x" }] });
  expect(r.ok).toBe(false);
});

test("rejeita path que não começa com ./", () => {
  const r = validateContext({ ...base, repos: [{ name: "x", url: "git@github.com:o/x.git", path: "x" }] });
  expect(r.ok).toBe(false);
});

test("rejeita nomes de repo duplicados", () => {
  const r = validateContext({
    ...base,
    repos: [
      { name: "dup", url: "git@github.com:o/a.git", path: "./a" },
      { name: "dup", url: "git@github.com:o/b.git", path: "./b" },
    ],
  });
  expect(r.ok).toBe(false);
});

test("rejeita paths duplicados", () => {
  const r = validateContext({
    ...base,
    repos: [
      { name: "a", url: "git@github.com:o/a.git", path: "./same" },
      { name: "b", url: "git@github.com:o/b.git", path: "./same" },
    ],
  });
  expect(r.ok).toBe(false);
});

test("aceita url https com .git", () => {
  const r = validateContext({ ...base, repos: [{ name: "x", url: "https://github.com/o/x.git", path: "./x" }] });
  expect(r.ok).toBe(true);
});
