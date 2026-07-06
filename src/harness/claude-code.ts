import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { FLOW_SKILLS } from "./skills";
import type { HarnessAdapter, InstallReport, PersonaMeta, PersonaRole, StartupDelivery } from "./types";

const ROLE_LABEL: Record<PersonaRole, string> = {
  "dev-fullstack": "Fullstack specialist",
  qa: "QA specialist",
};

const SESSION_START_HOOK = {
  matcher: "startup|resume|clear|compact",
  hooks: [{ type: "command", command: 'aipe session-context --workspace "$CLAUDE_PROJECT_DIR"' }],
};

interface Settings {
  hooks?: { SessionStart?: unknown[]; [k: string]: unknown };
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

// The Claude Code adapter: a project-scoped SessionStart hook + skills under
// .claude/, personas as .claude/skills/<slug>/SKILL.md, MCP in .mcp.json.
export const claudeCodeAdapter: HarnessAdapter = {
  id: "claude-code",
  label: "Claude Code",

  async installIntegration(workspaceDir: string): Promise<InstallReport> {
    const claudeDir = join(workspaceDir, ".claude");
    const settingsPath = join(claudeDir, "settings.json");
    await mkdir(claudeDir, { recursive: true });

    // 1. merge the SessionStart hook into settings.json (idempotent)
    const settings = await readSettings(settingsPath);
    settings.hooks ??= {};
    const sessionStart = Array.isArray(settings.hooks.SessionStart) ? settings.hooks.SessionStart : [];
    if (!hasAipeHook(sessionStart)) sessionStart.push(SESSION_START_HOOK);
    settings.hooks.SessionStart = sessionStart;
    await writeFile(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");

    // 2. write the onboarding/operation flow skills
    for (const [name, body] of Object.entries(FLOW_SKILLS)) {
      const dir = join(claudeDir, "skills", name);
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, "SKILL.md"), body, "utf8");
    }

    return {
      files: [".claude/settings.json", `.claude/skills/ (${Object.keys(FLOW_SKILLS).length} skills)`],
      notes: [
        "SessionStart hook → aipe session-context",
        `${Object.keys(FLOW_SKILLS).length} AIPe skills installed`,
      ],
    };
  },

  startupDelivery(): StartupDelivery {
    // Claude Code injects context by running the hook command every session;
    // the awareness text is computed live by `aipe session-context`, so nothing
    // static is written here.
    return { mode: "hook", command: 'aipe session-context --workspace "$CLAUDE_PROJECT_DIR"' };
  },

  personaTarget(slug: string): { relDir: string; filename: string } {
    return { relDir: join(".claude", "skills", slug), filename: "SKILL.md" };
  },

  wrapPersona(body: string, meta: PersonaMeta): string {
    const stackLabel = meta.stack.length > 0 ? meta.stack.join(", ") : "unknown stack";
    const scope = meta.module ? `${meta.repo}/${meta.module}` : meta.repo;
    const unit = meta.module ? "module" : "repo";
    const description = `${ROLE_LABEL[meta.role]} for the ${scope} ${unit} (${stackLabel}). Dispatched by the coordinator for tasks scoped to ${scope}, or worn directly when a session opens inside the ${meta.repo} repo.`;
    return `---\nname: ${meta.slug}\ndescription: ${description}\n---\n\n${body.trim()}\n`;
  },

  mcpConfigPath(scope: "workspace" | "repo", repo?: string): string {
    return scope === "repo" && repo ? join(repo, ".mcp.json") : ".mcp.json";
  },
};
