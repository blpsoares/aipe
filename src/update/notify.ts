// The interactive "there's an update — want it?" offer shown after any command
// in a real terminal. SAFETY-CRITICAL: aipe is invoked constantly by
// non-interactive callers (the SessionStart hook's `aipe session-context`,
// coordinator/subagent Bash runs, pipes, CI). This must be a strict no-op in
// all of those — never print extra output, never block on a prompt — or it will
// corrupt machine-consumed output or hang an automated run.
import { askLine } from "../start/prompt";
import { parseYesNo, resolveUpdateForPrompt, snoozeUpdate, updateNotice } from "./check";
import { runInstall } from "./run";

// Commands that own the screen or emit machine-parsed output: never interrupt.
const SKIP = new Set([
  "check-update",
  "upgrade",
  "update",
  "session-context",
  "read-state",
  "serve",
  "dashboard",
]);

export async function maybeOfferUpdate(current: string, command: string): Promise<void> {
  if (process.env.AIPE_NO_UPDATE_CHECK || process.env.CI) return;
  if (!process.stdout.isTTY || !process.stdin.isTTY) return; // hooks/subagents/pipes/CI
  if (SKIP.has(command)) return;

  const info = await resolveUpdateForPrompt(current).catch(() => null);
  if (!info) return; // up to date, snoozed, or couldn't determine (offline)

  const notice = updateNotice(info);
  if (notice) console.log(`\n${notice}`);
  const answer = await askLine("Update now? (Y/n) ").catch(() => "n");
  if (parseYesNo(answer)) {
    await runInstall();
  } else {
    await snoozeUpdate(24); // respect the "no" — don't nag again for a day
    console.log("Skipped. Run `aipe upgrade` whenever you're ready.");
  }
}
