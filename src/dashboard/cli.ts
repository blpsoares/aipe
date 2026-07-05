#!/usr/bin/env bun
// `aipe dashboard` — a live terminal view of the company: coordinator + hired
// specialists, each worker's current status, the journey pipeline, worktrees,
// and toolbox. Reads .aipe/ + `git worktree` each tick; no LLM. Use --once (or
// pipe to a non-TTY) for a single frame.
import { buildSnapshot } from "./snapshot";
import { renderDashboard } from "./render";

function getFlag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const value = args[i + 1];
  if (value === undefined || value.startsWith("--")) return undefined;
  return value;
}

const CLEAR = "\x1b[H\x1b[2J\x1b[3J";

function stamp(): string {
  // Date is available in the compiled binary (this is not a workflow script).
  return `updated ${new Date().toISOString().replace("T", " ").slice(0, 19)}`;
}

export async function run(args: string[]): Promise<number> {
  const workspace = getFlag(args, "--workspace") ?? process.cwd();
  const once = args.includes("--once") || !process.stdout.isTTY;
  const interval = Math.max(500, Number(getFlag(args, "--interval") ?? "2000") || 2000);
  const color = process.stdout.isTTY;

  if (once) {
    const snapshot = await buildSnapshot(workspace);
    console.log(renderDashboard(snapshot, { color, now: stamp() }));
    return 0;
  }

  let running = true;
  const stop = () => {
    running = false;
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  while (running) {
    const snapshot = await buildSnapshot(workspace);
    const frame = renderDashboard(snapshot, { color, now: stamp() });
    process.stdout.write(`${CLEAR}${frame}\n\n\x1b[90mCtrl-C to exit · refreshing every ${Math.round(interval / 1000)}s\x1b[0m\n`);
    await sleep(interval);
  }
  process.stdout.write("\x1b[0m\n");
  return 0;
}

if (import.meta.main) {
  run(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((err) => {
      console.log(`ERROR ${err}`);
      process.exit(1);
    });
}
