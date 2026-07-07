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

export interface HarnessAdapter {
  id: string;
  label: string;

  // A — write this harness's native integration into the workspace folder.
  installIntegration(workspaceDir: string): Promise<InstallReport>;

  // B — how the (portable) awareness text reaches a session.
  startupDelivery(awareness: string): StartupDelivery;

  // C — where a persona file lives inside its repo, and how it is wrapped so
  //     THIS harness auto-loads it. `personaTarget` is relative to the repo root.
  personaTarget(slug: string): { relDir: string; filename: string };
  wrapPersona(body: string, meta: PersonaMeta): string;

  // E — where MCP servers are registered for this harness.
  mcpConfigPath(scope: "workspace" | "repo", repo?: string): string;

  // F — map an abstract model tier to the concrete model id this harness runs.
  //     null = no mapping (the coordinator falls back to the session default);
  //     the tier's policy gates (authorization/volume) still apply either way.
  resolveModel(tier: string): { id: string; label: string } | null;
}
