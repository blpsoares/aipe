// A grant is a quota of session spawns the coordinator hands a specialist. It is
// spent one token-file at a time: `writeFile(..., { flag: "wx" })` fails if the
// file exists, so exactly one concurrent caller can claim each token. Counting
// an integer in a file would race — two readers see "2" and both write "1".
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export function grantPath(workspaceDir: string, journeyId: string, sessionId: string): string {
  return join(workspaceDir, ".aipe", "journeys", journeyId, "grants", sessionId);
}

export async function issueGrant(
  workspaceDir: string,
  journeyId: string,
  sessionId: string,
  count: number,
): Promise<void> {
  const dir = grantPath(workspaceDir, journeyId, sessionId);
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
    tokens = (await readdir(dir)).filter((f) => f.startsWith("token-") && !f.endsWith(".spent")).sort();
  } catch {
    return false;
  }
  for (const token of tokens) {
    try {
      // Claim by creating the .spent marker exclusively — the winner is whoever
      // creates it first; everyone else gets EEXIST and moves to the next token.
      await writeFile(join(dir, `${token}.spent`), "", { encoding: "utf8", flag: "wx" });
      return true;
    } catch {
      continue;
    }
  }
  return false;
}
