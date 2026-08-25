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
  //
  // `role`, when given, is baked LITERALLY into the rendered hook's guard
  // invocation (`aipe session guard --role <role>`) — never delivered via an
  // env var, because agentop's `session batch`/`session <harness>` has no
  // flag to inject one into the session it starts (confirmed against the
  // real v1.13.7 binary). Two call sites use this differently, on purpose:
  //   - Installing into the PE's OWN workspace (installIntegration /
  //     ensureSessionStartHook here, ensureGeminiHooks in gemini.ts) calls
  //     this with NO role, so the coordinator's own PreToolUse/BeforeTool
  //     hook never says `--role specialist` — the coordinator must keep
  //     unrestricted `agentop session` access.
  //   - Installing into a DISPATCHED unit's worktree (dispatchCommand, see
  //     src/session/cli.ts) calls this with `"specialist"`, so that
  //     worktree's hook — and only that worktree's hook — denies the
  //     specialist role's session spawns/kills per `decide()` in
  //     src/session/guard.ts.
  // Omitting the argument MUST NOT default to "specialist" — that would hand
  // the coordinator's own workspace the specialist's restrictions.
  containmentHook(role?: string): ContainmentHook | null;

  // B2 — install the startup (awareness) delivery into ANY directory.
  //
  // `installIntegration` does this for the workspace; this does it for a single
  // REPO, which is what `/hire-specialists` and `aipe rehydrate` need so a
  // session opened directly inside a repo gets that repo's persona-scoped
  // context instead of the coordinator's.
  //
  // It exists because those two call sites used to import
  // `ensureSessionStartHook` straight from the Claude Code adapter. That is a
  // hole in this seam, not a shortcut: choosing Gemini still wrote `.claude/`
  // hooks into every repo — a path Gemini never reads — so the personas were
  // installed and silently inert. Anything that installs into a repo goes
  // through here.
  //
  // Idempotent, and preserves foreign entries already in the file.
  ensureStartupHook(targetDir: string): Promise<void>;

  // C — where a persona file lives inside its repo, and how it is wrapped so
  //     THIS harness auto-loads it. `personaTarget` is relative to the repo root.
  personaTarget(slug: string): { relDir: string; filename: string };
  wrapPersona(body: string, meta: PersonaMeta): string;

  // C2 — where a persona's *agent type* file goes, or null when the harness has
  //      no such concept.
  //
  // A skill is loaded into the session you are already in; an agent type is a
  // thing the coordinator can DISPATCH as its own separate context. Only Claude
  // Code models the second one. Everywhere else the persona exists purely as a
  // skill, and `null` says so — rather than writing an `agents/` file the
  // harness will never read, which would look installed and do nothing.
  agentTarget(slug: string): { relDir: string; filename: string } | null;

  // D — where a named skill file lives in the workspace (or a repo) for THIS
  //     harness. Used for the coordinator flow-skills (operate, context-brain,
  //     …) AND for toolbox skills installed into a repo: both are "a named
  //     markdown skill this harness loads", and separate accessors would only
  //     let the two drift apart per harness. `installIntegration` writes the
  //     flow-skills there; `aipe rehydrate` refreshes them from the binary's
  //     embedded FLOW_SKILLS, so an installed workspace never runs a stale
  //     skill after an upgrade. Relative to the workspace (or repo) root.
  flowSkillTarget(name: string): { relDir: string; filename: string };

  // D2 — the paths this harness owns inside a workspace, workspace-relative.
  //
  // Drives the publish allowlist and the scaffolded README, so a published
  // workspace carries the integration the PE actually chose instead of a
  // hardcoded `.claude`. `.aipe/` is always published and is deliberately NOT
  // listed here — it is AIPe's own directory, not any harness's.
  integrationPaths(): string[];

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
