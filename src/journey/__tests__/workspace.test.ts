import { expect, test } from "bun:test";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { resolveLedgerWorkspace } from "../workspace";

test("a directory with no .aipe/ is refused — nowhere to search", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-nows-"));
  const r = resolveLedgerWorkspace(dir);
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.reason).toContain(".aipe/");
});

test("a directory that holds .aipe/ resolves to the absolute workspace path", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aipe-ws-"));
  await mkdir(join(dir, ".aipe"), { recursive: true });
  const r = resolveLedgerWorkspace(dir);
  expect(r.ok).toBe(true);
  if (r.ok) expect(r.workspace).toBe(resolve(dir));
});

test("a path that does not exist is refused (not read as an empty workspace)", () => {
  const r = resolveLedgerWorkspace("/no/such/dir/aipe-does-not-exist-xyz");
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.reason).toContain("does not exist");
});

test("the machine state directory is not a workspace, even though its .aipe exists", () => {
  // Running an aipe command from $HOME must not treat ~/.aipe (the machine
  // state dir) as a workspace — mirrors looksLikeWorkspace's belt-and-braces.
  const stateDir = "/tmp/fake-home/.aipe";
  const r = resolveLedgerWorkspace("/tmp/fake-home", { exists: () => true, stateDir });
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.reason).toContain("state directory");
});
