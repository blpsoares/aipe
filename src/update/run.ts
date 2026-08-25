import { INSTALL_CMD } from "./check";

/**
 * The installer-script fallback: `curl -fsSL … | sh`.
 *
 * Only for the cases the self-installer refuses — a source checkout, where
 * process.execPath is the bun runtime rather than an aipe binary. It must NOT
 * be the normal upgrade path: install.sh writes with `curl -o <target>`, and
 * when <target> is the executable currently running the write fails with
 * ETXTBSY (`curl: (23) Failure writing output to destination`), leaving the
 * binary truncated. `aipe upgrade` stages and renames instead — see install.ts.
 */
export async function runInstall(): Promise<number> {
  const proc = Bun.spawn(["sh", "-c", INSTALL_CMD], {
    stdout: "inherit",
    stderr: "inherit",
    stdin: "inherit",
  });
  const code = await proc.exited;
  if (code === 0) {
    console.log("Installed — the new version takes effect on your next `aipe` command.");
    console.log("In each existing workspace, run `aipe rehydrate` to sync its coordinator skills to this version.");
  } else {
    console.log(`Install failed (exit ${code}). Run it manually: ${INSTALL_CMD}`);
  }
  return code;
}
