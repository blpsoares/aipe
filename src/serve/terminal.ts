// A persistent-shell terminal session for the web console. AIPe's zero-dependency
// rule forbids a native PTY (node-pty), so this is a *command console* rather than
// a full terminal: one long-lived `$SHELL` per session whose cwd/env/state persist
// across commands, with stdout+stderr streamed back and ANSI color forced on.
// Full-screen TUI programs (vim, less) are out of scope — documented.
//
// Each command is framed with a rare sentinel printed after it, so the client
// knows a turn ended and with what exit code:  \x01AIPE_DONE:<code>\x01

const SENTINEL = /\x01AIPE_DONE:(-?\d+)\x01/;
const PREFIX = "\x01AIPE_DONE:";

// Splits a raw buffer into clean output + completed turn exit codes, holding back
// any trailing bytes that might still become a sentinel. Pure and testable.
export function frame(buffer: string): { clean: string; turns: number[]; rest: string } {
  let work = buffer;
  let clean = "";
  const turns: number[] = [];
  let m: RegExpMatchArray | null;
  while ((m = work.match(SENTINEL)) !== null) {
    const idx = m.index ?? 0;
    clean += work.slice(0, idx);
    turns.push(Number(m[1]));
    work = work.slice(idx + m[0].length);
  }
  const lastSoh = work.lastIndexOf("\x01");
  if (lastSoh >= 0) {
    const tail = work.slice(lastSoh);
    const partial = PREFIX.startsWith(tail) || /^\x01AIPE_DONE:-?\d*$/.test(tail);
    if (partial) {
      clean += work.slice(0, lastSoh);
      return { clean, turns, rest: tail };
    }
  }
  return { clean: clean + work, turns, rest: "" };
}

export interface TerminalOpts {
  cwd: string;
  shell?: string;
  env?: Record<string, string>;
  onData: (chunk: string) => void; // clean output (sentinel stripped)
  onTurnEnd: (exitCode: number) => void; // a command finished
  onExit: (code: number | null) => void; // the shell process itself exited
}

export interface TerminalSession {
  run(command: string): void; // execute one command line in the persistent shell
  close(): void;
}

export function defaultShell(env: NodeJS.ProcessEnv = process.env): string {
  return env.SHELL && env.SHELL.trim() ? env.SHELL : process.platform === "win32" ? "cmd.exe" : "bash";
}

export function createTerminalSession(opts: TerminalOpts): TerminalSession {
  const shell = opts.shell ?? defaultShell();
  const proc = Bun.spawn([shell], {
    cwd: opts.cwd,
    env: {
      ...process.env,
      FORCE_COLOR: "1",
      CLICOLOR_FORCE: "1",
      TERM: "xterm-256color",
      ...opts.env,
    },
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });

  let buffer = "";
  const handle = (text: string): void => {
    const { clean, turns, rest } = frame(buffer + text);
    buffer = rest;
    if (clean) opts.onData(clean);
    for (const code of turns) opts.onTurnEnd(code);
  };

  const decoder = new TextDecoder();
  const pump = async (stream: ReadableStream<Uint8Array>): Promise<void> => {
    const reader = stream.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      handle(decoder.decode(value, { stream: true }));
    }
  };
  void pump(proc.stdout as ReadableStream<Uint8Array>);
  void pump(proc.stderr as ReadableStream<Uint8Array>);
  void proc.exited.then((code) => opts.onExit(code));

  const write = (s: string): void => {
    try {
      proc.stdin.write(s);
      proc.stdin.flush();
    } catch {
      // shell gone; onExit will have fired
    }
  };

  return {
    run(command: string): void {
      // Run the command, then print the sentinel carrying its exit code. The
      // sentinel's own output is stripped by frame() before it reaches the client.
      write(`${command}\nprintf '\\n\\001AIPE_DONE:%d\\001\\n' "$?"\n`);
    },
    close(): void {
      try {
        proc.kill();
      } catch {
        // already dead
      }
    },
  };
}
