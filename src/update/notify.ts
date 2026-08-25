import { askLine } from "../start/prompt";
import { updateBanner } from "./banner";
import { parseYesNo, resolveUpdateForPrompt, snoozeUpdate } from "./check";
import { updateChecksDisabled, upgrade } from "./cli";

// Commands that must never be interrupted by a prompt: hooks and machine-read
// output (their stdout is parsed), long-lived servers, and the update commands
// themselves (which would recurse).
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
  if (updateChecksDisabled() || process.env.CI) return;
  if (!process.stdout.isTTY || !process.stdin.isTTY) return; // hooks/subagents/pipes/CI
  if (SKIP.has(command)) return;

  const info = await resolveUpdateForPrompt(current).catch(() => null);
  if (!info) return; // up to date, snoozed, or couldn't determine (offline)

  process.stdout.write(updateBanner(info));
  const answer = await askLine("Upgrade now? (Y/n) ").catch(() => "n");
  if (parseYesNo(answer)) {
    // The real upgrade — not `curl | sh`, which truncates the binary we are
    // running. It also rehydrates the workspaces and restarts the web console.
    await upgrade([]);
  } else {
    await snoozeUpdate(24); // respect the "no" — don't nag again for a day
    console.log("Skipped. Run `aipe upgrade` whenever you're ready.");
  }
}
