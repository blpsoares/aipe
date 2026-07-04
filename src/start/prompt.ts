// Terminal prompts for `aipe start`. The navigation logic (classifyKey,
// reduceNav, renderMenu) is pure and unit-tested; the raw-mode IO wrappers
// (selectInteractive, askLine) are thin glue that can only run in a real TTY.
import { createInterface } from "node:readline/promises";

export type Key = "up" | "down" | "enter" | "cancel" | "other";

export function classifyKey(raw: string): Key {
  if (raw === "\x1b[A" || raw === "k") return "up";
  if (raw === "\x1b[B" || raw === "j") return "down";
  if (raw === "\r" || raw === "\n") return "enter";
  if (raw === "\x03" || raw === "\x04" || raw === "\x1b" || raw === "q") return "cancel";
  return "other";
}

export interface NavState {
  index: number;
  done: boolean;
  cancelled: boolean;
}

export function reduceNav(state: NavState, key: Key, count: number): NavState {
  switch (key) {
    case "up":
      return { ...state, index: (state.index - 1 + count) % count };
    case "down":
      return { ...state, index: (state.index + 1) % count };
    case "enter":
      return { ...state, done: true };
    case "cancel":
      return { ...state, done: true, cancelled: true };
    default:
      return state;
  }
}

export interface MenuOption {
  label: string;
  disabled?: boolean;
}

export function renderMenu(title: string, options: MenuOption[], index: number): string {
  const lines = [title];
  options.forEach((opt, i) => {
    const pointer = i === index ? "❯" : " ";
    const tag = opt.disabled ? "  (coming soon)" : "";
    lines.push(`${pointer} ${opt.label}${tag}`);
  });
  lines.push("");
  lines.push("↑/↓ to move · Enter to select · Ctrl-C to cancel");
  return lines.join("\n");
}

/** Arrow-key selector. Returns the chosen index, or null if not a TTY / cancelled. */
export async function selectInteractive(title: string, options: MenuOption[]): Promise<number | null> {
  const stdin = process.stdin;
  if (!stdin.isTTY) return null;

  const block = (index: number): string => renderMenu(title, options, index);
  const lineCount = block(0).split("\n").length;

  process.stdout.write("\x1b[?25l"); // hide cursor
  process.stdout.write(`${block(0)}\n`);
  stdin.setRawMode(true);
  stdin.resume();

  let state: NavState = { index: 0, done: false, cancelled: false };

  return new Promise<number | null>((resolve) => {
    const cleanup = (): void => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener("data", onData);
      process.stdout.write("\x1b[?25h"); // show cursor
    };
    const onData = (buf: Buffer): void => {
      state = reduceNav(state, classifyKey(buf.toString()), options.length);
      // redraw: move up over the previous block and repaint
      process.stdout.write(`\x1b[${lineCount}A\x1b[0J`);
      process.stdout.write(`${block(state.index)}\n`);
      if (state.done) {
        cleanup();
        resolve(state.cancelled ? null : state.index);
      }
    };
    stdin.on("data", onData);
  });
}

export async function askLine(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}
