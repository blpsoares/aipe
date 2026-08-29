#!/usr/bin/env bun
// cli.ts — the I/O half of `aipe shell-hook install | uninstall | status`.
//
// Every decision is already made by `rc.ts`; this file reads rc files, writes
// them, and reports. Two rules govern it, borrowed from how agentop administers
// the user's .bashrc:
//
//  1. INSTALLING IS THE USER'S ACT. Nothing here runs by itself. The consent is
//     given ONCE, explicitly (`aipe shell-hook install`); after that the CLI may
//     repeat the check every terminal without asking again. Onboarding may OFFER
//     the command (see `suggestInstallLine`), never run it.
//  2. THE FILE IS NOT OURS. Writes go through `rc.ts`, which preserves every line
//     it did not write and REFUSES a file it cannot read unambiguously. On a
//     refusal, nothing is written to that file at all.
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileState, planInstall, planUninstall, type FileState } from "./rc";

/** The shell rc files we manage. Different login shells source different files
 *  (bash → ~/.bashrc, zsh → ~/.zshrc), so a bash-only hook is invisible to zsh
 *  users. We install into whichever already exist. */
export function rcCandidates(home: string): string[] {
  return [join(home, ".bashrc"), join(home, ".zshrc")];
}

/** ~/.bashrc → "~/.bashrc" for user-facing messages. */
function tilde(home: string, p: string): string {
  return home && p.startsWith(home) ? `~${p.slice(home.length)}` : p;
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export interface CmdResult {
  code: number;
  lines: string[];
}

/**
 * Install the guarded block into every present rc (creating ~/.bashrc when none
 * exists, the historical default). Idempotent, and refuses any file it cannot
 * edit safely — reporting the refusal and exiting non-zero, but never writing.
 */
export async function installShellHook(home: string): Promise<CmdResult> {
  const candidates = rcCandidates(home);
  const present = candidates.filter((rc) => existsSync(rc));
  const targets = present.length ? present : [join(home, ".bashrc")];

  const lines: string[] = [];
  let failed = false;

  for (const rc of targets) {
    const name = tilde(home, rc);
    const existed = existsSync(rc);
    let content = "";
    if (existed) {
      try {
        content = await readFile(rc, "utf8");
      } catch (e) {
        lines.push(`  ${name}: could not read (${msg(e)}) — left untouched.`);
        failed = true;
        continue;
      }
    }
    const plan = planInstall(content);
    if (plan.action === "refuse") {
      lines.push(`  ${name}: ${plan.reason} — REFUSED, nothing written. Fix it by hand, then retry.`);
      failed = true;
    } else if (plan.action === "unchanged") {
      lines.push(`  ${name}: already installed — unchanged.`);
    } else {
      try {
        await writeFile(rc, plan.next, "utf8");
        const what =
          plan.action === "update" ? "updated" : existed ? "installed" : "created and installed";
        lines.push(`  ${name}: ${what}.`);
      } catch (e) {
        lines.push(`  ${name}: could not write (${msg(e)}).`);
        failed = true;
      }
    }
  }

  const header = failed ? "aipe shell-hook install — completed with errors:" : "aipe shell-hook install:";
  const footer = failed
    ? []
    : [
        "",
        "  Every new shell now runs a guarded, silent `aipe check-update` — it is",
        "  cache-only on open (a refresh runs detached), and does nothing if aipe",
        "  is not on PATH. Remove it any time with `aipe shell-hook uninstall`.",
      ];
  return { code: failed ? 1 : 0, lines: [header, ...lines, ...footer] };
}

/** Remove the marked block from every rc that has it. Exact-marker match, so it
 *  takes back precisely what install wrote and touches nothing else. */
export async function uninstallShellHook(home: string): Promise<CmdResult> {
  const lines: string[] = [];
  let failed = false;
  let removedAny = false;

  for (const rc of rcCandidates(home)) {
    if (!existsSync(rc)) continue;
    const name = tilde(home, rc);
    let content = "";
    try {
      content = await readFile(rc, "utf8");
    } catch (e) {
      lines.push(`  ${name}: could not read (${msg(e)}) — left untouched.`);
      failed = true;
      continue;
    }
    const plan = planUninstall(content);
    if (plan.action === "refuse") {
      lines.push(`  ${name}: ${plan.reason} — REFUSED, nothing changed. Remove the block by hand.`);
      failed = true;
    } else if (plan.action === "absent") {
      lines.push(`  ${name}: not installed — nothing to remove.`);
    } else {
      try {
        await writeFile(rc, plan.next, "utf8");
        lines.push(`  ${name}: removed.`);
        removedAny = true;
      } catch (e) {
        lines.push(`  ${name}: could not write (${msg(e)}).`);
        failed = true;
      }
    }
  }

  if (lines.length === 0) lines.push("  no ~/.bashrc or ~/.zshrc found — nothing to remove.");
  const header = failed ? "aipe shell-hook uninstall — completed with errors:" : "aipe shell-hook uninstall:";
  const footer = !failed && removedAny ? ["", "  Removed. New shells will no longer check for aipe updates."] : [];
  return { code: failed ? 1 : 0, lines: [header, ...lines, ...footer] };
}

export interface StatusReport extends CmdResult {
  /** Aggregate over the rc files that EXIST: `installed` when the block is in all
   *  of them, `absent` when in none, `partial` when in some but not all. */
  verdict: "installed" | "absent" | "partial" | "none";
  files: { rc: string; state: FileState | "no-file" }[];
}

/** Report where the hook is installed and what is missing. */
export async function statusShellHook(home: string): Promise<StatusReport> {
  const files: { rc: string; state: FileState | "no-file" }[] = [];
  for (const rc of rcCandidates(home)) {
    if (!existsSync(rc)) {
      files.push({ rc, state: "no-file" });
      continue;
    }
    try {
      files.push({ rc, state: fileState(await readFile(rc, "utf8")) });
    } catch {
      files.push({ rc, state: "malformed" });
    }
  }

  const existing = files.filter((f) => f.state !== "no-file");
  const installedIn = existing.filter((f) => f.state === "installed" || f.state === "stale");
  let verdict: StatusReport["verdict"];
  if (existing.length === 0) verdict = "none";
  else if (installedIn.length === 0) verdict = "absent";
  else if (installedIn.length === existing.length) verdict = "installed";
  else verdict = "partial";

  const label: Record<FileState | "no-file", string> = {
    installed: "installed",
    stale: "installed (an older line — run `aipe shell-hook install` to refresh)",
    absent: "not installed",
    malformed: "MALFORMED — a corrupt aipe block; fix it by hand",
    "no-file": "no such file",
  };
  const lines = files.map((f) => `  ${tilde(home, f.rc).padEnd(10)} ${label[f.state]}`);
  const summary: Record<StatusReport["verdict"], string> = {
    installed: "Installed in every shell rc you have.",
    absent: "Not installed. Run `aipe shell-hook install`.",
    partial: "Partial — installed in some shell rc but not all. Run `aipe shell-hook install`.",
    none: "No ~/.bashrc or ~/.zshrc found. Run `aipe shell-hook install` to create ~/.bashrc.",
  };
  return { code: 0, verdict, files, lines: ["aipe shell-hook status:", ...lines, "", `  ${summary[verdict]}`] };
}

/**
 * The one-line OFFER onboarding may print — never an install.
 *
 * Null when the hook is already installed in every rc the user has (a suggestion
 * to run a command you have already run is noise), or when a file is malformed
 * (we do not nudge someone toward a command that will refuse). Never throws — a
 * setup flow must not fail over a hint.
 */
export async function suggestInstallLine(home: string): Promise<string | null> {
  try {
    const report = await statusShellHook(home);
    if (report.verdict === "installed") return null;
    if (report.files.some((f) => f.state === "malformed")) return null;
    return (
      "Tip: `aipe shell-hook install` makes every new terminal quietly check for aipe " +
      "updates (guarded, cache-only, and silent when you are current). Nothing is written " +
      "to your shell rc until you run it."
    );
  } catch {
    return null;
  }
}

/** Pick the home directory: `--home <dir>` (for driving/testing), else $HOME. */
function resolveHome(args: string[]): string {
  const i = args.indexOf("--home");
  const v = i >= 0 ? args[i + 1] : undefined;
  return v !== undefined && !v.startsWith("--") ? v : homedir();
}

const USAGE = [
  "Usage: aipe shell-hook <install|uninstall|status> [--home <dir>]",
  "",
  "Teach every new terminal to check for an aipe update — guarded, silent, and cache-only.",
  "",
  "  install    add a guarded block to ~/.bashrc and ~/.zshrc (creates ~/.bashrc if none exist)",
  "  uninstall  remove exactly that block, touching nothing else",
  "  status     show where it is installed and what is missing",
  "",
  "The block runs `command -v aipe >/dev/null 2>&1 && aipe check-update 2>/dev/null`, so a",
  "missing aipe never breaks your shell. Installing is your call — nothing writes to your rc",
  "on its own; `uninstall` takes back exactly what `install` wrote.",
].join("\n");

export async function run(args: string[]): Promise<number> {
  const sub = args.find((a) => !a.startsWith("--"));
  const home = resolveHome(args);

  if (sub === undefined || sub === "help") {
    console.log(USAGE);
    return sub === undefined ? 1 : 0;
  }

  let result: CmdResult;
  switch (sub) {
    case "install":
      result = await installShellHook(home);
      break;
    case "uninstall":
      result = await uninstallShellHook(home);
      break;
    case "status":
      result = await statusShellHook(home);
      break;
    default:
      console.log(`ERROR unknown shell-hook command "${sub}"`);
      console.log(USAGE);
      return 1;
  }
  for (const line of result.lines) console.log(line);
  return result.code;
}

// Re-export so callers importing the command also get the marker line for tests/help.
export { block, HOOK_LINE } from "./rc";

if (import.meta.main) {
  run(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((err) => {
      console.log(`ERROR ${err}`);
      process.exit(1);
    });
}
