import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { FLOW_SKILLS, renderFlowSkills } from "./skills";
import type { ContainmentHook, HarnessAdapter, InstallReport, PersonaMeta, PersonaRole, StartupDelivery } from "./types";
import { CONTAINMENT_COMMAND } from "./types";

const ROLE_LABEL: Record<PersonaRole, string> = {
  "dev-fullstack": "Fullstack specialist",
  qa: "QA specialist (delivery gate)",
};

// Role-specific tail appended to a persona's description. The QA persona is the
// mandatory gate the coordinator MUST run after each dev delivery — surfaced here
// so the posture travels with the persona file itself.
const ROLE_NOTE: Record<PersonaRole, string> = {
  "dev-fullstack": "",
  qa: " Runs as the MUST delivery gate: dispatched after each dev delivery to verify it before anything is reported done.",
};

const SESSION_START_HOOK = {
  matcher: "startup|resume|clear|compact",
  hooks: [{ type: "command", command: 'aipe session-context --workspace "$CLAUDE_PROJECT_DIR"' }],
};

// The SessionEnd counterpart: a clean close releases the coordinator's registered
// identity so it leaves no ghost behind (j-20260829-5q). Reuses the same binary
// subcommand with --release. SessionEnd has no matcher (it is not tool-scoped).
const SESSION_END_HOOK = {
  hooks: [{ type: "command", command: 'aipe session-context --release --workspace "$CLAUDE_PROJECT_DIR"' }],
};

// Builds the PreToolUse hook entry. `command` already carries `--role <role>`
// baked in when one applies — see the `role` note on `containmentHook()` in
// ./types.ts.
function preToolUseHook(command: string) {
  return { matcher: "Bash", hooks: [{ type: "command", command }] };
}

interface Settings {
  hooks?: { SessionStart?: unknown[]; SessionEnd?: unknown[]; PreToolUse?: unknown[]; [k: string]: unknown };
  [k: string]: unknown;
}

async function readSettings(path: string): Promise<Settings> {
  try {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") return parsed as Settings;
  } catch {
    // missing or malformed → start fresh
  }
  return {};
}

function hasAipeHook(list: unknown[]): boolean {
  return list.some((entry) => JSON.stringify(entry).includes("aipe session-context"));
}

function hasAipeReleaseHook(list: unknown[]): boolean {
  return list.some((entry) => JSON.stringify(entry).includes("aipe session-context --release"));
}

// Writes ONLY the SessionStart hook (→ `aipe session-context`) — never the
// PreToolUse containment hook. This used to also merge
// `claudeCodeAdapter.containmentHook()!.merge(settings)` in here, which wrote
// a role-LESS `aipe session guard` PreToolUse hook into the workspace/repo
// root on every `aipe start` / `hire-specialists` / `rehydrate`, including
// workspaces that never use session mode. That hook is genuinely inert:
// `decide()` (src/session/guard.ts) short-circuits to `{ action: "allow" }`
// for any role other than "specialist", and a role-less command is exactly
// what this call site rendered — so it never denied anything, only added a
// `bun`/`aipe` subprocess to every Bash tool call in the PE's OWN sessions.
// The containment that actually matters is installed separately, per unit,
// WITH the specialist role baked in, directly into that unit's own worktree
// by `installWorktreeContainmentHook` in src/session/cli.ts (a different
// file entirely — a worktree is a separate git checkout, so nothing written
// here ever reached it anyway). Removing the merge here changes no
// specialist's containment; it only stops paying for a hook that always said
// yes. `containmentHook()` itself is unchanged and still used directly by
// dispatchCommand for the worktree install.
export async function ensureSessionStartHook(targetDir: string): Promise<void> {
  const claudeDir = join(targetDir, ".claude");
  const settingsPath = join(claudeDir, "settings.json");
  await mkdir(claudeDir, { recursive: true });

  const settings = await readSettings(settingsPath);
  settings.hooks ??= {};
  const sessionStart = Array.isArray(settings.hooks.SessionStart) ? settings.hooks.SessionStart : [];
  if (!hasAipeHook(sessionStart)) sessionStart.push(SESSION_START_HOOK);
  settings.hooks.SessionStart = sessionStart;

  // The SessionEnd release hook is written alongside the start hook — the pair is
  // one unit: register on open, release on clean close.
  const sessionEnd = Array.isArray(settings.hooks.SessionEnd) ? settings.hooks.SessionEnd : [];
  if (!hasAipeReleaseHook(sessionEnd)) sessionEnd.push(SESSION_END_HOOK);
  settings.hooks.SessionEnd = sessionEnd;

  await writeFile(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
}

// The Claude Code adapter: a project-scoped SessionStart hook + skills under
// .claude/, personas as .claude/skills/<slug>/SKILL.md, MCP in .mcp.json.
export const claudeCodeAdapter: HarnessAdapter = {
  id: "claude-code",
  label: "Claude Code",
  agentopHarness: "claude",

  async installIntegration(workspaceDir: string): Promise<InstallReport> {
    // 1. merge the SessionStart hook into settings.json (idempotent)
    await ensureSessionStartHook(workspaceDir);

    // 2. write the onboarding/operation flow skills
    for (const [name, body] of Object.entries(renderFlowSkills(this))) {
      const { relDir, filename } = this.flowSkillTarget(name);
      const dir = join(workspaceDir, relDir);
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, filename), body, "utf8");
    }

    return {
      files: [".claude/settings.json", `.claude/skills/ (${Object.keys(FLOW_SKILLS).length} skills)`],
      notes: [
        "SessionStart hook → aipe session-context",
        `${Object.keys(FLOW_SKILLS).length} AIPe skills installed`,
        // Containment (PreToolUse → aipe session guard) is installed per unit,
        // WITH the specialist role, directly into that unit's worktree at
        // `aipe session dispatch` time — never here (see ensureSessionStartHook).
      ],
    };
  },

  // The workspace install and the per-repo install are the SAME hook write —
  // `installIntegration` just also lays down the flow-skills.
  ensureStartupHook: ensureSessionStartHook,

  startupDelivery(): StartupDelivery {
    // Claude Code injects context by running the hook command every session;
    // the awareness text is computed live by `aipe session-context`, so nothing
    // static is written here.
    return { mode: "hook", command: 'aipe session-context --workspace "$CLAUDE_PROJECT_DIR"' };
  },

  containmentHook(role?: string): ContainmentHook {
    // See the `role` note on HarnessAdapter#containmentHook in ./types.ts:
    // baked into the command literally, never delivered via env var.
    const command = role ? `${CONTAINMENT_COMMAND} --role ${role}` : CONTAINMENT_COMMAND;
    return {
      relPath: join(".claude", "settings.json"),
      merge(existing: unknown): unknown {
        const settings: Settings =
          existing && typeof existing === "object" ? { ...(existing as Settings) } : {};
        const hooks = { ...(settings.hooks ?? {}) };
        const list = Array.isArray(hooks.PreToolUse) ? [...hooks.PreToolUse] : [];
        const already = list.some((e) => JSON.stringify(e).includes(command));
        if (!already) list.push(preToolUseHook(command));
        hooks.PreToolUse = list;
        settings.hooks = hooks;
        return settings;
      },
    };
  },

  personaTarget(slug: string): { relDir: string; filename: string } {
    return { relDir: join(".claude", "skills", slug), filename: "SKILL.md" };
  },

  // Claude Code is the one harness with a subagent concept, so it is the one
  // harness that gets an agent-type file.
  agentTarget(slug: string): { relDir: string; filename: string } {
    return { relDir: join(".claude", "agents"), filename: `${slug}.md` };
  },

  flowSkillTarget(name: string): { relDir: string; filename: string } {
    return { relDir: join(".claude", "skills", name), filename: "SKILL.md" };
  },

  wrapPersona(body: string, meta: PersonaMeta): string {
    const stackLabel = meta.stack.length > 0 ? meta.stack.join(", ") : "unknown stack";
    const scope = meta.package ? `${meta.repo}/${meta.package}` : meta.repo;
    const unit = meta.package ? "package" : "repo";
    const description = `${ROLE_LABEL[meta.role]} for the ${scope} ${unit} (${stackLabel}). Dispatched by the coordinator for tasks scoped to ${scope}, or worn directly when a session opens inside the ${meta.repo} repo.${ROLE_NOTE[meta.role]}`;
    return `---\nname: ${meta.slug}\ndescription: ${description}\n---\n\n${body.trim()}\n`;
  },

  integrationPaths(): string[] {
    return [".claude"];
  },

  mcpConfigPath(scope: "workspace" | "repo", repo?: string): string {
    return scope === "repo" && repo ? join(repo, ".mcp.json") : ".mcp.json";
  },

  resolveModel(tier: string): { id: string; label: string } | null {
    const map: Record<string, { id: string; label: string }> = {
      fast: { id: "claude-haiku-4-5-20251001", label: "Haiku 4.5" },
      standard: { id: "claude-sonnet-5", label: "Sonnet 5" },
      reasoning: { id: "claude-opus-4-8", label: "Opus 4.8" },
      frontier: { id: "claude-fable-5", label: "Fable 5" },
    };
    return map[tier] ?? null;
  },
};
