// rc.ts — the pure half of `aipe shell-hook`.
//
// Every DECISION about a shell rc file lives here: what the guarded block is,
// whether one is already present, and what an install/uninstall/status would do
// to a given piece of text. It never touches the disk — it takes rc content as a
// string and returns a plan. `cli.ts` is the half that reads files, writes them,
// and reports. This mirrors how agentop splits its pure `claude-hooks.ts` from
// the I/O `cli-hooks.ts`.
//
// The block it manages is one guarded POSIX line, valid in bash AND zsh:
//
//   # >>> aipe update check >>>
//   command -v aipe >/dev/null 2>&1 && aipe check-update 2>/dev/null || true
//   # <<< aipe update check <<<
//
// `command -v aipe` is the whole safety story. If the binary is gone from PATH
// (the exact situation of someone who just uninstalled aipe), the left side
// fails, `&&` short-circuits, and NOTHING else on the line runs — the shell is
// never broken by a missing binary. `check-update` itself is cache-only on the
// hot path (it reads a shared cache and refreshes it in a DETACHED process), so
// the line adds no network wait to opening a terminal.
//
// The trailing `|| true` is a small improvement over the agentop line this
// mirrors: without it, an absent aipe leaves `$?` at 1, and since this is the
// last line a login rc sources, a prompt that shows the last exit code would
// paint a stray "1" on every new terminal after an uninstall. `|| true` keeps
// `$?` pristine — the line is silent in every sense.

/** Opening/closing markers. Kept STABLE forever so uninstall stays exact — a
 *  changed marker would orphan every block already written into people's rc. */
export const BEGIN = "# >>> aipe update check >>>";
export const END = "# <<< aipe update check <<<";

/** The one guarded line. POSIX, so identical in bash and zsh. */
export const HOOK_LINE = "command -v aipe >/dev/null 2>&1 && aipe check-update 2>/dev/null || true";

/** The full block text (markers + line), with NO trailing newline. */
export function block(): string {
  return `${BEGIN}\n${HOOK_LINE}\n${END}`;
}

/** A well-formed block found in rc content, by character offset.
 *  `start` is the first char of the BEGIN line; `end` is one past the last char
 *  of the END line (i.e. it does NOT include the newline that follows END). */
export interface BlockSpan {
  start: number;
  end: number;
  /** The exact substring `content.slice(start, end)` — markers included. */
  text: string;
}

export type Scan = { ok: true; blocks: BlockSpan[] } | { ok: false; reason: string };

/**
 * Locate the aipe block(s) in rc content.
 *
 * A marker only counts when it is the ENTIRE trimmed line — so a marker quoted
 * inside an `echo "…"` or documented in a comment is never mistaken for the real
 * thing. Anything that cannot be a single well-formed block — a BEGIN with no
 * END, an END with no BEGIN, a nested BEGIN, or two complete blocks — is a
 * refusal (`ok:false`). The rule is deliberate: a file we cannot read
 * unambiguously is a file we will not write to.
 */
export function scan(content: string): Scan {
  const blocks: BlockSpan[] = [];
  const lines = content.split("\n");
  let offset = 0;
  let open: number | null = null; // start offset of an unclosed BEGIN
  for (const line of lines) {
    const lineStart = offset;
    const lineEnd = offset + line.length; // before the "\n" that split() removed
    const trimmed = line.trim();
    if (trimmed === BEGIN) {
      if (open !== null) return { ok: false, reason: "a second opening marker before the first was closed" };
      open = lineStart;
    } else if (trimmed === END) {
      if (open === null) return { ok: false, reason: "a closing marker with no matching opening marker" };
      blocks.push({ start: open, end: lineEnd, text: content.slice(open, lineEnd) });
      open = null;
    }
    offset = lineEnd + 1; // skip the removed "\n"
  }
  if (open !== null) return { ok: false, reason: "an opening marker with no matching closing marker" };
  if (blocks.length > 1) return { ok: false, reason: `${blocks.length} aipe blocks found (expected at most one)` };
  return { ok: true, blocks };
}

export type InstallPlan =
  | { action: "insert"; next: string }
  | { action: "update"; next: string }
  | { action: "unchanged" }
  | { action: "refuse"; reason: string };

/** Where a fresh block goes: appended, separated from existing content by a
 *  single newline. An empty file gets the block with no leading blank line. */
function withBlock(content: string): string {
  const blk = block();
  return content === "" ? `${blk}\n` : `${content}\n${blk}\n`;
}

/**
 * Decide what installing would do to `content`. Idempotent: an already-present,
 * current block is `unchanged`; a present-but-drifted block is updated in place
 * (the surrounding text is preserved); a malformed file is refused untouched.
 */
export function planInstall(content: string): InstallPlan {
  const s = scan(content);
  if (!s.ok) return { action: "refuse", reason: s.reason };
  if (s.blocks.length === 0) return { action: "insert", next: withBlock(content) };
  const b = s.blocks[0]!;
  if (b.text === block()) return { action: "unchanged" };
  return { action: "update", next: content.slice(0, b.start) + block() + content.slice(b.end) };
}

export type UninstallPlan =
  | { action: "remove"; next: string }
  | { action: "absent" }
  | { action: "refuse"; reason: string };

/**
 * Decide what uninstalling would do. `remove` is the EXACT inverse of `insert`:
 * it consumes the one separator newline before BEGIN and the newline after END,
 * so a round-trip install→uninstall restores the original byte-for-byte. A
 * malformed file is refused untouched.
 */
export function planUninstall(content: string): UninstallPlan {
  const s = scan(content);
  if (!s.ok) return { action: "refuse", reason: s.reason };
  if (s.blocks.length === 0) return { action: "absent" };
  const b = s.blocks[0]!;
  let start = b.start;
  if (start > 0 && content[start - 1] === "\n") start -= 1; // the separator we added
  let end = b.end;
  if (content[end] === "\n") end += 1; // the newline after END
  return { action: "remove", next: content.slice(0, start) + content.slice(end) };
}

export type FileState = "installed" | "stale" | "absent" | "malformed";

/** The state of the block in one rc file's content. */
export function fileState(content: string): FileState {
  const s = scan(content);
  if (!s.ok) return "malformed";
  if (s.blocks.length === 0) return "absent";
  return s.blocks[0]!.text === block() ? "installed" : "stale";
}
