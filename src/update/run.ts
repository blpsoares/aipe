// Runs the official installer to self-update. Overwriting the running binary is
// safe on POSIX (the current process keeps the old inode; the update takes
// effect on the next invocation). Shared by `aipe upgrade` and the interactive
// "Update now?" offer. Returns the installer's exit code.
import { INSTALL_CMD } from "./check";

export async function runInstall(): Promise<number> {
  const proc = Bun.spawn(["sh", "-c", INSTALL_CMD], {
    stdout: "inherit",
    stderr: "inherit",
    stdin: "inherit",
  });
  const code = await proc.exited;
  if (code === 0) {
    console.log("Updated — the new version takes effect on your next `aipe` command.");
    console.log("In each existing workspace, run `aipe rehydrate` to sync its coordinator skills to this version.");
  } else {
    console.log(`Update failed (exit ${code}). Run it manually: ${INSTALL_CMD}`);
  }
  return code;
}
