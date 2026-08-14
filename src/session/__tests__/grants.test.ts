import { expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { consumeGrant, issueGrant } from "../grants";

async function ws(): Promise<string> {
  return mkdtemp(join(tmpdir(), "aipe-grants-"));
}

test("with no grant issued, nothing can be consumed", async () => {
  const dir = await ws();
  expect(await consumeGrant(dir, "j1", "s1")).toBe(false);
});

test("a grant of 2 is consumable exactly twice", async () => {
  const dir = await ws();
  await issueGrant(dir, "j1", "s1", 2);
  expect(await consumeGrant(dir, "j1", "s1")).toBe(true);
  expect(await consumeGrant(dir, "j1", "s1")).toBe(true);
  expect(await consumeGrant(dir, "j1", "s1")).toBe(false);
});

test("grants are scoped per session", async () => {
  const dir = await ws();
  await issueGrant(dir, "j1", "s1", 1);
  expect(await consumeGrant(dir, "j1", "s2")).toBe(false);
  expect(await consumeGrant(dir, "j1", "s1")).toBe(true);
});

test("concurrent consumers never exceed the grant", async () => {
  const dir = await ws();
  await issueGrant(dir, "j1", "s1", 3);
  const results = await Promise.all(
    Array.from({ length: 20 }, () => consumeGrant(dir, "j1", "s1")),
  );
  expect(results.filter(Boolean).length).toBe(3);
});
