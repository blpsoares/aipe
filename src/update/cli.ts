#!/usr/bin/env bun
// `aipe check-update` — prints a notice if a newer release exists, else stays
// silent (so it's safe to wire into a shell startup line). Refreshes the cache
// that `aipe --version` reads. Pass --verbose to also confirm when up to date.
import { VERSION } from "../cli";
import { checkForUpdate, updateNotice } from "./check";

export async function run(args: string[]): Promise<number> {
  const info = await checkForUpdate(VERSION);
  const notice = updateNotice(info);
  if (notice) {
    console.log(notice);
  } else if (args.includes("--verbose")) {
    console.log(`aipe is up to date (${info.current}).`);
  }
  return 0;
}

if (import.meta.main) {
  run(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch(() => process.exit(0)); // never fail a shell startup on a check
}
