#!/usr/bin/env bun
// `aipe check-update` — prints a notice if a newer release exists, else silent
// (safe in a shell startup line). `aipe upgrade` (alias `update`) self-updates
// via the official installer. Both refresh the cache that `aipe --version` and
// the interactive offer read.
import { VERSION } from "../cli";
import { checkForUpdate, updateNotice } from "./check";
import { runInstall } from "./run";

export async function checkUpdate(args: string[]): Promise<number> {
  const info = await checkForUpdate(VERSION);
  const notice = updateNotice(info);
  if (notice) console.log(notice);
  else if (args.includes("--verbose")) console.log(`aipe is up to date (${info.current}).`);
  return 0;
}

export async function upgrade(args: string[]): Promise<number> {
  const force = args.includes("--force");
  const info = await checkForUpdate(VERSION);
  if (!info.hasUpdate && !force) {
    console.log(`aipe is already up to date (${info.current}).`);
    return 0;
  }
  console.log(
    info.hasUpdate ? `Updating aipe ${info.current} → ${info.latest}…` : `Reinstalling aipe ${info.current}…`,
  );
  return runInstall();
}

if (import.meta.main) {
  checkUpdate(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch(() => process.exit(0)); // never fail a shell startup on a check
}
