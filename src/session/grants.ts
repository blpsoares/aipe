// A grant is a quota of session spawns the coordinator hands a specialist. It is
// spent one token-file at a time: `writeFile(..., { flag: "wx" })` fails if the
// file exists, so exactly one concurrent caller can claim each token. Counting
// an integer in a file would race — two readers see "2" and both write "1".
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** Reads `code` off an unknown thrown value, e.g. Node's `NodeJS.ErrnoException`. */
function errorCode(err: unknown): string | undefined {
  if (typeof err === "object" && err !== null && "code" in err) {
    const code = (err as { code?: unknown }).code;
    return typeof code === "string" ? code : undefined;
  }
  return undefined;
}

/** Rejects ids that are empty, contain a path separator, or a `..` segment. */
function assertSafeId(label: string, id: string): void {
  if (id.length === 0) {
    throw new Error(`${label} must not be empty`);
  }
  if (id.includes("/") || id.includes("\\")) {
    throw new Error(`${label} must not contain a path separator: ${id}`);
  }
  if (id.split(/[/\\]/).includes("..")) {
    throw new Error(`${label} must not contain a ".." segment: ${id}`);
  }
}

export function grantPath(workspaceDir: string, journeyId: string, sessionId: string): string {
  assertSafeId("journeyId", journeyId);
  assertSafeId("sessionId", sessionId);
  return join(workspaceDir, ".aipe", "journeys", journeyId, "grants", sessionId);
}

export async function issueGrant(
  workspaceDir: string,
  journeyId: string,
  sessionId: string,
  count: number,
): Promise<void> {
  if (count < 0) {
    throw new Error(`grant count must not be negative: ${count}`);
  }
  const dir = grantPath(workspaceDir, journeyId, sessionId);
  let existing: string[];
  try {
    existing = (await readdir(dir)).filter((f) => f.startsWith("token-") && !f.endsWith(".spent"));
  } catch (err) {
    if (errorCode(err) !== "ENOENT") {
      throw err;
    }
    existing = [];
  }
  if (existing.length > 0) {
    throw new Error(
      `a grant already exists for journey "${journeyId}", session "${sessionId}" — issueGrant must not be called twice for the same (journey, session) pair`,
    );
  }
  await mkdir(dir, { recursive: true });
  for (let i = 0; i < count; i++) {
    await writeFile(join(dir, `token-${i}`), "", "utf8");
  }
}

export async function consumeGrant(
  workspaceDir: string,
  journeyId: string,
  sessionId: string,
): Promise<boolean> {
  const dir = grantPath(workspaceDir, journeyId, sessionId);
  let tokens: string[];
  try {
    tokens = (await readdir(dir))
      .filter((f) => f.startsWith("token-") && !f.endsWith(".spent"))
      .sort((a, b) => Number(a.slice("token-".length)) - Number(b.slice("token-".length)));
  } catch (err) {
    if (errorCode(err) === "ENOENT") {
      return false;
    }
    throw err;
  }
  for (const token of tokens) {
    try {
      // Claim by creating the .spent marker exclusively — the winner is whoever
      // creates it first; everyone else gets EEXIST and moves to the next token.
      await writeFile(join(dir, `${token}.spent`), "", { encoding: "utf8", flag: "wx" });
      return true;
    } catch (err) {
      if (errorCode(err) === "EEXIST") {
        continue;
      }
      throw err;
    }
  }
  return false;
}
