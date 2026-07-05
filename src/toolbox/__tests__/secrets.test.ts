import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stringify } from "yaml";
import { findSecrets } from "../secrets";
import { installMcp } from "../mcp";
import type { BrainFile } from "../../context-brain/types";

test("findSecrets flags literal secrets by key, allows env references", () => {
  expect(findSecrets({ env: { PG_URL: "${PG_URL}" } })).toEqual([]);
  expect(findSecrets({ env: { PASSWORD: "hunter2literal" } })).toContain("env.PASSWORD");
  expect(findSecrets({ headers: { authorization: "sk-abcdef123456" } })).toContain("headers.authorization");
  // env-ref token under a secret-ish key is fine
  expect(findSecrets({ apiKey: "${API_KEY}" })).toEqual([]);
});

test("findSecrets flags inline URL credentials regardless of key", () => {
  expect(findSecrets({ url: "postgres://user:s3cretpw@host/db" })).toContain("url");
  expect(findSecrets({ url: "postgres://${USER}:${PASS}@host/db" })).toEqual([]);
});

async function ws(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "aipe-sec-"));
  const brain: BrainFile = { context: { name: "o", coordinator: "N" }, repos: [{ name: "embark", url: "u", path: "./embark" }] };
  await mkdir(join(dir, ".aipe"), { recursive: true });
  await writeFile(join(dir, ".aipe", "brain.yaml"), stringify(brain), "utf8");
  return dir;
}

test("installMcp refuses a literal secret, --allow-secrets overrides", async () => {
  const dir = await ws();
  try {
    const refused = await installMcp(dir, {
      name: "pg",
      scope: "workspace",
      repos: [],
      description: "db",
      config: { env: { PGPASSWORD: "literal-secret-value" } },
    });
    expect(refused.ok).toBe(false);

    const allowed = await installMcp(dir, {
      name: "pg",
      scope: "workspace",
      repos: [],
      description: "db",
      config: { env: { PGPASSWORD: "literal-secret-value" } },
      allowSecrets: true,
    });
    expect(allowed.ok).toBe(true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
