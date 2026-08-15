// A grant is a quota of session spawns the coordinator hands a specialist. It is
// spent one token-file at a time: `writeFile(..., { flag: "wx" })` fails if the
// file exists, so exactly one concurrent caller can claim each token. Counting
// an integer in a file would race — two readers see "2" and both write "1".
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

/** Reads `code` off an unknown thrown value, e.g. Node's `NodeJS.ErrnoException`. */
function errorCode(err: unknown): string | undefined {
  if (typeof err === "object" && err !== null && "code" in err) {
    const code = (err as { code?: unknown }).code;
    return typeof code === "string" ? code : undefined;
  }
  return undefined;
}

/** Rejects ids that are empty, contain a path separator, or are `.`/`..`. */
function assertSafeId(label: string, id: string): void {
  if (id.length === 0) {
    throw new Error(`${label} must not be empty`);
  }
  if (id.includes("/") || id.includes("\\")) {
    throw new Error(`${label} must not contain a path separator: ${id}`);
  }
  // The separator check above already rejects every id containing "/" or "\",
  // so the only remaining ways an id can resolve to the parent/self directory
  // are the literal segments "." and ".." — check those directly.
  if (id === "." || id === "..") {
    throw new Error(`${label} must not be "." or "..": ${id}`);
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
  // Ensure the parent chain exists, then create the per-session directory
  // non-recursively: `mkdir` without `recursive` fails with EEXIST if the
  // directory is already there, which makes the existence check itself the
  // atomic operation — exactly analogous to the `wx` flag used for token
  // claims below. This closes the TOCTOU window a separate readdir-then-mkdir
  // check would leave between two concurrent issueGrant calls for the same
  // (journey, session) pair.
  await mkdir(dirname(dir), { recursive: true });
  try {
    await mkdir(dir);
  } catch (err) {
    if (errorCode(err) !== "EEXIST") {
      throw err;
    }
    throw new Error(
      `a grant already exists for journey "${journeyId}", session "${sessionId}" — issueGrant must not be called twice for the same (journey, session) pair`,
    );
  }
  // The mkdir above is the exclusive claim on `dir`: whichever concurrent
  // caller wins it is guaranteed to be the sole writer here, so writing token
  // files with the default "w" flag (rather than "wx") is safe.
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
