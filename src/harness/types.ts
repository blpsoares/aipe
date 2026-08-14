// The seam that makes AIPe harness-agnostic. Everything a specific agent harness
// (Claude Code, a file-based/AGENTS.md harness, …) needs is *delivery to that
// harness's loader* — never what the coordinator says or what data the CLI
// computes. Each adapter owns exactly those delivery surfaces; the portable core
// (the whole aipe CLI + the awareness content) feeds them.

export type PersonaRole = "dev-fullstack" | "qa";

// The data an adapter needs to render a persona file — plain, so this package
// never imports from hire-specialists (no cycle). The caller computes `slug`.
export interface PersonaMeta {
  slug: string;
  role: PersonaRole;
  repo: string;
  package: string | null;
  stack: string[];
}

// How the coordinator "awareness" is delivered at session start.
//  - "hook": the harness runs `command` at session start (Claude Code).
//  - "file": AIPe writes a static file the harness reads (AGENTS.md etc.).
export type StartupDelivery =
  | { mode: "hook"; command: string }
  | { mode: "file"; path: string; content: string };

export interface InstallReport {
  files: string[]; // workspace-relative paths written (for user output)
  notes: string[];
}

// The guard command that every harness adapter MUST use in its containment hook.
// Do not repeat the literal string — import and use this constant to prevent typos
// that silently produce a hook that denies nothing.
export const CONTAINMENT_COMMAND = "aipe session guard";

// How a harness is told to block a command before it runs. `relPath` is the
// config file, relative to the workspace; `merge` folds the containment rule
// into that file's existing contents, idempotently.
//
// A harness whose adapter returns null cannot be contained — and is therefore
// NOT eligible for session-mode dispatch. That is the whole eligibility rule:
// AIPe never starts a session it cannot govern.
export interface ContainmentHook {
  relPath: string;
  merge: (existing: unknown) => unknown;
}

export interface HarnessAdapter {
  id: string;
  label: string;

  // The name `agentop` (the session runner used for session-mode dispatch)
  // knows this harness by — e.g. "claude", "codex", "gemini", "copilot",
  // "antigravity", "kimi". This is a DIFFERENT namespace from `id` above:
  // `id` is what AIPe and the PE-approved Orientation Spec call the adapter
  // ("claude-code", "codex", "generic", …) and what the journey ledger's
  // `harness` field stores. `claude-code` (the AIPe adapter id) is not
  // `claude` (the agentop harness name) — conflating the two, or hardcoding
  // one adapter's mapping as a literal everywhere agentop is invoked, means
  // a unit approved for one harness can silently start a session on another.
  // `null` means agentop has no equivalent for this harness, which makes it
  // not session-dispatchable for the same reason a non-containable harness
  // is (see `isContainable` below) — a caller resolving this MUST treat
  // `null` as "cannot session-dispatch", never let it reach an argv.
  agentopHarness: string | null;

  // A — write this harness's native integration into the workspace folder.
  installIntegration(workspaceDir: string): Promise<InstallReport>;

  // B — how the (portable) awareness text reaches a session.
  startupDelivery(awareness: string): StartupDelivery;

  // How this harness is told to block a command before it runs. `null` means
  // the harness cannot be contained, and is therefore not eligible for
  // session-mode dispatch.
  containmentHook(): ContainmentHook | null;

  // C — where a persona file lives inside its repo, and how it is wrapped so
  //     THIS harness auto-loads it. `personaTarget` is relative to the repo root.
  personaTarget(slug: string): { relDir: string; filename: string };
  wrapPersona(body: string, meta: PersonaMeta): string;

  // D — where a coordinator flow-skill (operate, context-brain, …) lives in the
  //     workspace for THIS harness. `installIntegration` writes it there; `aipe
  //     rehydrate` re-reads/refreshes it from the binary's embedded FLOW_SKILLS,
  //     so an installed workspace never runs a stale skill after an upgrade.
  //     Relative to the workspace root.
  flowSkillTarget(name: string): { relDir: string; filename: string };

  // E — where MCP servers are registered for this harness.
  mcpConfigPath(scope: "workspace" | "repo", repo?: string): string;

  // F — map an abstract model tier to the concrete model id this harness runs.
  //     null = no mapping (the coordinator falls back to the session default);
  //     the tier's policy gates (authorization/volume) still apply either way.
  resolveModel(tier: string): { id: string; label: string } | null;
}

export function isContainable(adapter: HarnessAdapter): boolean {
  return adapter.containmentHook() !== null;
}
