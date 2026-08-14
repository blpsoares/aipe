import { expect, test } from "bun:test";
import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { consumeGrant, grantPath, issueGrant } from "../grants";

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

test("re-issuing a grant for the same journey and session throws", async () => {
  const dir = await ws();
  await issueGrant(dir, "j1", "s1", 5);
  await expect(issueGrant(dir, "j1", "s1", 2)).rejects.toThrow(/j1/);
  await expect(issueGrant(dir, "j1", "s1", 2)).rejects.toThrow(/s1/);
});

test("a different session in the same journey still succeeds", async () => {
  const dir = await ws();
  await issueGrant(dir, "j1", "s1", 1);
  await issueGrant(dir, "j1", "s2", 1);
  expect(await consumeGrant(dir, "j1", "s1")).toBe(true);
  expect(await consumeGrant(dir, "j1", "s2")).toBe(true);
});

test("a negative count throws", async () => {
  const dir = await ws();
  await expect(issueGrant(dir, "j1", "s1", -1)).rejects.toThrow(/must not be negative/);
});

test("an id containing a path separator throws", async () => {
  const dir = await ws();
  await expect(issueGrant(dir, "j1/../evil", "s1", 1)).rejects.toThrow(/path separator/);
  await expect(issueGrant(dir, "j1", "s1/evil", 1)).rejects.toThrow(/path separator/);
});

test("an id containing a .. segment throws", async () => {
  const dir = await ws();
  await expect(issueGrant(dir, "..", "s1", 1)).rejects.toThrow();
  await expect(issueGrant(dir, "j1", "..", 1)).rejects.toThrow();
});

test("a lone \".\" journey id throws", async () => {
  const dir = await ws();
  await expect(issueGrant(dir, ".", "s1", 1)).rejects.toThrow(/journeyId/);
});

test("a lone \".\" session id throws", async () => {
  const dir = await ws();
  await expect(issueGrant(dir, "j1", ".", 1)).rejects.toThrow(/sessionId/);
});

test("two concurrent issueGrant calls for the same pair: exactly one fulfils", async () => {
  const dir = await ws();
  const results = await Promise.allSettled([
    issueGrant(dir, "j1", "s1", 3),
    issueGrant(dir, "j1", "s1", 5),
  ]);
  const fulfilled = results.filter((r) => r.status === "fulfilled");
  const rejected = results.filter((r) => r.status === "rejected");
  expect(fulfilled.length).toBe(1);
  expect(rejected.length).toBe(1);
  if (rejected[0]?.status === "rejected") {
    expect(rejected[0].reason).toBeInstanceOf(Error);
    expect((rejected[0].reason as Error).message).toMatch(/j1/);
    expect((rejected[0].reason as Error).message).toMatch(/s1/);
  }

  // The surviving quota must equal the winner's count, not the sum of both.
  const winnerCount = results[0]?.status === "fulfilled" ? 3 : 5;
  let consumed = 0;
  while (await consumeGrant(dir, "j1", "s1")) {
    consumed++;
  }
  expect(consumed).toBe(winnerCount);
});

test("a 12-token grant is consumed in numeric order", async () => {
  const dir = await ws();
  await issueGrant(dir, "j1", "s1", 12);
  const grantDir = grantPath(dir, "j1", "s1");
  const claimedOrder: string[] = [];
  for (let i = 0; i < 12; i++) {
    const before = new Set((await readdir(grantDir)).filter((f) => f.endsWith(".spent")));
    expect(await consumeGrant(dir, "j1", "s1")).toBe(true);
    const after = (await readdir(grantDir)).filter((f) => f.endsWith(".spent"));
    const newlySpent = after.find((f) => !before.has(f));
    if (newlySpent === undefined) {
      throw new Error("expected a new .spent marker to appear");
    }
    claimedOrder.push(newlySpent);
  }
  expect(claimedOrder).toEqual(
    Array.from({ length: 12 }, (_, i) => `token-${i}.spent`),
  );
  expect(await consumeGrant(dir, "j1", "s1")).toBe(false);
});
