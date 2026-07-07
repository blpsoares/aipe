import { expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { wirePdd } from "../pdd";

test("wirePdd writes the marketplace + enables the plugin", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pdd-"));
  const path = await wirePdd(dir);
  const s = JSON.parse(await readFile(path, "utf8"));
  expect(s.extraKnownMarketplaces["parity-driven-development"].source).toEqual({
    source: "github",
    repo: "blpsoares/parity-driven-development",
  });
  expect(s.enabledPlugins["pdd@parity-driven-development"]).toBe(true);
});

test("wirePdd preserves existing settings and is idempotent", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pdd-"));
  await mkdir(join(dir, ".claude"), { recursive: true });
  await writeFile(
    join(dir, ".claude", "settings.json"),
    JSON.stringify({ enabledPlugins: { "superpowers@superpowers-dev": true }, hooks: { X: 1 } }),
    "utf8",
  );
  const path = await wirePdd(dir);
  await wirePdd(dir); // idempotent
  const s = JSON.parse(await readFile(path, "utf8"));
  expect(s.enabledPlugins["superpowers@superpowers-dev"]).toBe(true); // preserved
  expect(s.enabledPlugins["pdd@parity-driven-development"]).toBe(true); // added
  expect(s.hooks).toEqual({ X: 1 }); // untouched
});
