// The harness containment ledger.
//
// `isContainable()` in ./types.ts answers a *binary* question — does THIS
// adapter return a containment hook or not — and that is all the dispatch law
// needs at runtime. But the product had flattened a second, wider question into
// that same binary: for every harness agentop can host (not just the four with
// an adapter), *does a reliable non-interactive interception hook exist at all?*
// "No adapter yet" and "the tool cannot be contained without a human" were both
// showing up as one undifferentiated "coming soon", which is exactly the
// misleading signal the PE flagged for Antigravity.
//
// This module records the answer in THREE states, not two, for the ten
// harnesses named in the assignment. It is a data ledger the rest of `aipe` can
// read (see `containmentFor`/`harnessesInState`); it does NOT change the
// dispatch union or the eligibility rule. The four adapter-backed ids are kept
// in lockstep with what `isContainable(getAdapter(id))` actually does by
// src/harness/__tests__/compat.test.ts — so this file cannot drift away from
// code behavior, and code behavior cannot silently drift away from this file.
//
// Every "proven" line cites a PRIMARY source (the tool's own documentation),
// with the URL and the date it was read. Where the documentation does not
// answer, the state is `unestablished` and the headline says so — a confident
// tenth line with no source would be the very defect this ledger exists to fix.

/** The three states. Ordered strong→weak→open; the test pins this order. */
export const CONTAINMENT_STATES = [
  // A reliable interception hook that blocks a command with NO human present —
  // proven against the tool's own docs.
  "containable-proven",
  // The mechanism exists but needs a human (trust/approval), or does not exist
  // at all — proven against the tool's own docs.
  "non-containable-proven",
  // Nobody has verified, or the documentation does not answer. The state the
  // old two-way vocabulary could not express.
  "unestablished",
] as const;

export type ContainmentState = (typeof CONTAINMENT_STATES)[number];

export interface ContainmentSource {
  /** Primary source: the tool's OWN documentation, never a third-party blog. */
  url: string;
  /** ISO date the page was read (YYYY-MM-DD). */
  accessed: string;
  /** Verbatim from the source — the sentence that carries the claim. */
  quote: string;
}

export interface HarnessContainment {
  /** The id agentop hosts this harness under. */
  id: string;
  label: string;
  /**
   * The AIPe adapter id when one exists, else null. Non-null entries are locked
   * to `isContainable(getAdapter(adapterId))` by the compat test — the state
   * below must match what the adapter really does.
   */
  adapterId: string | null;
  state: ContainmentState;
  /** One plain-language line: the verdict and, for `unestablished`, why. */
  headline: string;
  /** Primary sources. Non-empty for any `*-proven` state. */
  sources: ContainmentSource[];
  /** A documented reservation that qualifies an otherwise-proven state. */
  caveat?: string;
}

const D = "2026-08-30"; // the day this investigation read every source below

export const HARNESS_CONTAINMENT: readonly HarnessContainment[] = [
  {
    id: "claude-code",
    label: "Claude Code",
    adapterId: "claude-code",
    state: "containable-proven",
    headline:
      "PreToolUse hook denies a command from settings.json; user-level hooks run with no trust prompt. The reference adapter.",
    sources: [
      {
        url: "https://code.claude.com/docs/en/hooks",
        accessed: D,
        quote:
          'Exit 2 means a blocking error. On events that can block, exit 2 blocks whether or not you print JSON: even a JSON permissionDecision of "allow" can\'t override it.',
      },
    ],
  },
  {
    id: "gemini",
    label: "Gemini CLI",
    adapterId: "gemini",
    state: "containable-proven",
    headline:
      "BeforeTool hook blocks run_shell_command; folder trust is disabled by default, so a fresh worktree loads .gemini/settings.json with no prompt.",
    sources: [
      {
        url: "https://google-gemini.github.io/gemini-cli/docs/cli/trusted-folders.html",
        accessed: D,
        quote: "The Trusted Folders feature is disabled by default.",
      },
    ],
  },
  {
    id: "codex",
    label: "OpenAI Codex CLI",
    adapterId: "codex",
    state: "non-containable-proven",
    headline:
      "A non-managed hook is inert until a human trusts it via /hooks (trust is per-hook-hash). Reconfirmed 2026-08-30 — unchanged.",
    sources: [
      {
        url: "https://learn.chatgpt.com/docs/hooks",
        accessed: D,
        quote:
          "Before a non-managed hook can run, Codex requires you to review and trust the exact hook definition. Codex records trust against the hook's current hash, so new or changed hooks are marked for review and skipped until trusted.",
      },
      {
        url: "https://learn.chatgpt.com/docs/hooks",
        accessed: D,
        quote:
          "For one-off automation that already vets hook sources outside Codex, pass --dangerously-bypass-hook-trust to run enabled hooks without requiring persisted hook trust for that invocation.",
      },
    ],
    caveat:
      "The only non-interactive path is an admin-managed hook via requirements.toml, or the per-invocation --dangerously-bypass-hook-trust flag — neither is a workspace-relative hook AIPe can self-declare. No `codex hooks trust request` command appears in the official docs (only in third-party writeups and a GitHub feature request).",
  },
  {
    id: "copilot",
    label: "GitHub Copilot CLI",
    adapterId: "copilot",
    state: "non-containable-proven",
    headline:
      "Default-on directory trust gates a fresh worktree, and repository hooks are not stated to be exempt. Reconfirmed 2026-08-30 — unchanged.",
    sources: [
      {
        url: "https://docs.github.com/en/copilot/how-tos/copilot-cli/set-up-copilot-cli/configure-copilot-cli",
        accessed: D,
        quote:
          "When you start a GitHub Copilot CLI session, you'll be asked to confirm that you trust the files in, and below, the directory from which you launched the CLI.",
      },
      {
        url: "https://docs.github.com/en/copilot/reference/hooks-reference",
        accessed: D,
        quote:
          "Policy hooks are available regardless of folder trust state.",
      },
    ],
    caveat:
      "Only policy hooks are singled out as exempt from folder trust, which implies repository-level hooks (what AIPe writes to .github/hooks/aipe.json) are subject to it. GitHub's own docs do not state whether -p/programmatic mode skips the trust prompt; the only claim to that effect is a third-party blog.",
  },
  {
    id: "cursor",
    label: "Cursor",
    adapterId: null,
    state: "non-containable-proven",
    headline:
      "beforeShellExecution can deny a command, but project hooks load only in a trusted workspace — a human trust step a fresh worktree does not clear.",
    sources: [
      {
        url: "https://cursor.com/docs/hooks",
        accessed: D,
        quote:
          "When team members open the project in a trusted workspace, Cursor automatically loads and runs the project hooks.",
      },
      {
        url: "https://cursor.com/docs/hooks",
        accessed: D,
        quote:
          "User-level hooks (~/.cursor/hooks.json) are not available in cloud agents.",
      },
    ],
    caveat:
      "The deny mechanism (beforeShellExecution → permission \"deny\", or exit code 2) is real, but its documented auto-load path is gated on workspace trust; the only trust-free path, user-level hooks, is explicitly unavailable to cloud agents, and no doc confirms headless --print enforcement.",
  },
  {
    id: "antigravity",
    label: "Antigravity",
    adapterId: null,
    state: "unestablished",
    headline:
      "A genuine candidate: docs show a config-file PreToolUse decision:\"deny\" hard-block with NO documented trust gate — but they do not confirm the hooks file loads under an unattended headless run. NOT proven non-containable.",
    sources: [
      {
        url: "https://antigravity.google/docs/ide/hooks/",
        accessed: D,
        quote:
          '"deny": Hard blocks execution immediately.',
      },
      {
        url: "https://antigravity.google/docs/ide/hooks/",
        accessed: D,
        quote:
          "Hooks are configured in a hooks.json file located in your customization directory (e.g., .agents/ in your workspace or ~/.gemini/config/).",
      },
    ],
    caveat:
      "Unlike Codex/Copilot/Cursor, no human-trust precondition is documented, and \"deny\" is an automatic decision distinct from the interactive \"ask\"/\"force_ask\" — so the mechanism reads as non-interactive by construction. What the docs do NOT state: whether hooks.json loads automatically or needs a manual activation/enable step, and whether it runs in a fully headless no-human session. That gap is the reason the state is `unestablished` rather than `containable-proven`. This is the answer to the PE's flag: the documentation does not fully resolve it, but it is a real adapter candidate, not the same as the proven-non-containable harnesses it was lumped with.",
  },
  {
    id: "factory-droid",
    label: "Factory Droid",
    adapterId: null,
    state: "containable-proven",
    headline:
      "commandBlocklist can never run — no approval prompt, holds even under --skip-permissions-unsafe — plus a PreToolUse deny hook in .factory/hooks.json.",
    sources: [
      {
        url: "https://docs.factory.ai/autonomy-and-safety/auto-run",
        accessed: D,
        quote:
          "Blocklist entries can never run: there is no approval prompt, and the block holds even under full autonomy, auto-run, or --skip-permissions-unsafe.",
      },
      {
        url: "https://docs.factory.ai/reference/hooks-reference",
        accessed: D,
        quote:
          'The PreToolUse event runs "After Droid builds tool parameters and before the tool runs"; exit code 2 blocks the tool call, or permissionDecision "deny" blocks it.',
      },
    ],
    caveat:
      "The airtight, explicitly-headless guarantee is the commandBlocklist (a static denylist, verified to hold under --skip-permissions-unsafe). The PreToolUse hook meets every other bar (config-file, automatic, deny-before-execution, no trust step) but the docs do not verbatim state it fires during `droid exec` headless runs. Not yet AIPe-verified end-to-end.",
  },
  {
    id: "kimi-code",
    label: "Kimi CLI",
    adapterId: null,
    state: "containable-proven",
    headline:
      "PreToolUse hook in ~/.kimi-code/config.toml blocks before the tool runs (exit 2 / permissionDecision deny), with no trust gate — but the design is fail-open.",
    sources: [
      {
        url: "https://moonshotai.github.io/kimi-code/en/customization/hooks",
        accessed: D,
        quote:
          "Triggered before a tool call (before permission checks); the tool will not execute if blocked.",
      },
      {
        url: "https://moonshotai.github.io/kimi-code/en/customization/hooks",
        accessed: D,
        quote: "Exit code: 2 means block, other non-zero values default to allow.",
      },
    ],
    caveat:
      "Fail-open by design: only exit code 2 (or an explicit JSON deny) blocks — every other outcome, including a crash or timeout, defaults to allow, and Moonshot itself warns the hook \"should not be used as the sole security barrier.\" A correctly-authored deny hook blocks reliably and headlessly; containment is only as strong as the hook script's robustness. Not yet AIPe-verified end-to-end.",
  },
  {
    id: "opencode",
    label: "opencode",
    adapterId: null,
    state: "containable-proven",
    headline:
      'permission "deny" blocks a bash command and stays enforced under --auto; config and plugins auto-load at startup with no trust step.',
    sources: [
      {
        url: "https://opencode.ai/docs/permissions",
        accessed: D,
        quote: '"deny" — block the action.',
      },
      {
        url: "https://opencode.ai/docs/permissions",
        accessed: D,
        quote:
          "Explicit \"deny\" rules are still enforced. Auto mode only changes requests that would otherwise ask for approval.",
      },
    ],
    caveat:
      "Default-permissive: most permissions default to allow, and under --auto only *explicitly* denied commands are blocked. Reliable containment requires authoring an explicit default-deny-plus-allowlist (e.g. `\"bash\": { \"*\": \"deny\", ... }`), not relying on defaults. Not yet AIPe-verified end-to-end.",
  },
  {
    id: "pi",
    label: "pi (earendil-works/pi)",
    adapterId: null,
    state: "containable-proven",
    headline:
      "beforeToolCall/tool_call hook blocks a Bash command before it executes; user/global and -e extensions load with no trust gate.",
    sources: [
      {
        url: "https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md",
        accessed: D,
        quote:
          "Fired after tool_execution_start, before the tool executes. Can block.",
      },
      {
        url: "https://github.com/earendil-works/pi/blob/main/packages/agent/README.md",
        accessed: D,
        quote:
          'It can block execution and attach terminate: true to the blocked result (e.g. { block: true, reason: "bash is disabled", terminate: true }).',
      },
    ],
    caveat:
      "Containment holds only if the deny hook ships as a global/user (~/.pi/agent/extensions/) or CLI `-e` extension: project-local .pi/extensions are gated behind interactive project-trust resolution. \"pi\" identified as the open-source terminal agent earendil-works/pi (a.k.a. badlogic/pi-mono). Not yet AIPe-verified end-to-end.",
  },
] as const;

/** The ten ids, in ledger order. A distinct set from the four-id dispatch union. */
export const INVESTIGATED_HARNESS_IDS: readonly string[] = HARNESS_CONTAINMENT.map((h) => h.id);

export function containmentFor(id: string): HarnessContainment | undefined {
  return HARNESS_CONTAINMENT.find((h) => h.id === id);
}

export function harnessesInState(state: ContainmentState): HarnessContainment[] {
  return HARNESS_CONTAINMENT.filter((h) => h.state === state);
}
