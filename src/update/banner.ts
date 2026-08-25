// The "there is a new version" output. Kept apart from the logic so the
// wording can be tested without spawning anything.
import type { UpdateInfo } from "./check";

const ESC = "\x1b";
export const R = `${ESC}[0m`;
export const B = `${ESC}[1m`;
export const D = `${ESC}[2m`;
export const Y = `${ESC}[33m`;
export const AM = `${ESC}[38;5;208m`;
export const GR = `${ESC}[92m`;
export const WH = `${ESC}[97m`;
export const RD = `${ESC}[91m`;

const SEP = `${D}${"─".repeat(52)}${R}`;

/** Pure: the ordinary "new version available" banner. */
export function updateBanner(info: Pick<UpdateInfo, "current" | "latest">): string {
  return (
    `\n${SEP}\n` +
    `  ${Y}${B}⚡ New aipe version available${R}\n` +
    `${SEP}\n` +
    `  ${D}Current:${R} ${WH}${info.current}${R}\n` +
    `  ${D}Latest: ${R} ${GR}${B}${info.latest}${R}\n` +
    `${SEP}\n\n` +
    `  ${B}Run ${AM}aipe upgrade${R}${B} — it installs the new binary, rehydrates${R}\n` +
    `  ${B}your workspaces and restarts the web console for you.${R}\n` +
    `${SEP}\n\n`
  );
}

/** Pure: a critical release that is installing itself right now. Informational
 *  — there is nothing for the user to run. */
export function criticalInstallingBanner(info: Pick<UpdateInfo, "current" | "latest">, logPath: string): string {
  return (
    `\n  ${AM}${B}⚡ Critical aipe update${R}\n` +
    `  ${D}${info.current} → ${R}${GR}${B}${info.latest}${R}\n` +
    `  Installing it in the background; your workspaces and web console are restarted when it lands.\n` +
    `  ${D}Log: ${logPath}${R}\n\n`
  );
}

/** Pure: a critical release the user has to install by hand. */
export function criticalManualBanner(info: Pick<UpdateInfo, "current" | "latest">, how: string): string {
  return (
    `\n  ${AM}${B}⚡ Critical aipe update${R}\n` +
    `  ${D}${info.current} → ${R}${GR}${B}${info.latest}${R}\n` +
    `  ${how}\n\n`
  );
}
