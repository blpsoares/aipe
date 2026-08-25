// The Gemini CLI adapter: a project-scoped BeforeTool hook (containment) +
// SessionStart hook (live awareness) under .gemini/settings.json, skills as
// .agents/skills/<slug>/SKILL.md (same cross-tool convention as Codex — see
// codex.ts), MCP servers registered in .gemini/settings.json's `mcpServers`
// key (no separate .mcp.json for this harness).
//
// Conventions verified against the live docs on 2026-08-14. Findings:
//
//  - Hooks <https://geminicli.com/docs/hooks/>,
//    <https://geminicli.com/docs/hooks/reference/>,
//    <https://geminicli.com/docs/hooks/writing-hooks/>:
//     - Event names differ from Claude Code/Codex: containment uses
//       `BeforeTool` ("Before a tool executes" — "Block Tool / Rewrite"),
//       not `PreToolUse`. Awareness delivery uses `SessionStart` ("When a
//       session begins (startup, resume, clear)").
//     - Matcher syntax differs BY EVENT CLASS: "Tool events (BeforeTool,
//       AfterTool): Matchers are Regular Expressions" (e.g. `"write_.*"`),
//       but "Lifecycle events: Matchers are Exact Strings (for example,
//       `"startup"`)" — and separately, `"*"` or `""` (empty string)
//       "matches all occurrences" for either class. This adapter uses `"*"`
//       for SessionStart (fires on startup/resume/clear alike) rather than
//       guessing at which exact lifecycle substrings to enumerate.
//     - The shell-execution tool's name is `run_shell_command` (confirmed at
//       <https://geminicli.com/docs/tools/shell/>: "The `run_shell_command`
//       tool allows the Gemini model to execute commands... there is no
//       separate `execute_command` tool"; its shell-string argument is named
//       `command`, matching what `aipe session guard`'s `readCommand()`
//       already reads via `tool_input.command`). Gemini has NO tool named
//       `Bash` — copying Codex/Claude Code's literal `matcher: "Bash"` here
//       would install a hook that loads but never fires for a shell command,
//       the exact "looks installed, denies nothing" failure this whole
//       feature exists to avoid. The matcher below is `run_shell_command`.
//     - Command hook shape: `{"type": "command", "command": "...",
//       "timeout": <ms, default 60000>}`, nested under
//       `"hooks": { "<EventName>": [{ "matcher": "...", "hooks": [...] }] }`
//       in `.gemini/settings.json` — confirmed by the writing-hooks example:
//       `{"hooks":{"SessionStart":[{"matcher":"startup","hooks":[{"name":
//       "init","type":"command","command":"node .gemini/hooks/init.js"}]}]}}`.
//     - stdout-JSON-only: "Your script must not print any plain text to
//       stdout other than the final JSON object... Use stderr for ALL
//       logging and debugging." `aipe session guard` (src/session/cli.ts)
//       satisfies this as-is: `guardCommand` either returns `stdout: ""`
//       (nothing printed) or a single `console.log(JSON.stringify(...))`
//       call — never any other stdout write, and it never crashes into a
//       stack trace on stdout either. Confirmed.
//     - Deny SHAPE differs from Claude Code/Codex too, not just the
//       stdout-purity rule: `docs/hooks/reference.md`'s exit-code table says
//       "`0`: Success. stdout is parsed as JSON. Preferred for all logic,"
//       and the documented BeforeTool deny payload is a TOP-LEVEL
//       `decision`/`reason` pair — the string "permissionDecision" appears
//       ZERO times anywhere in Gemini's hooks docs. The accepted VALUE for
//       `decision` is, verbatim from `docs/hooks/reference/`: `"decision":
//       Set to "deny" (or "block") to prevent the tool from executing.` —
//       "deny" and "block" are documented as equivalent for Gemini. `aipe
//       session guard` always exits 0 (see `guardCommand` in
//       src/session/cli.ts), so exit-code-2 blocking is not in play either.
//       Before this file existed, `denyJson()` in src/session/cli.ts emitted
//       ONLY the `hookSpecificOutput.permissionDecision` shape — valid JSON,
//       so it would have satisfied the stdout-purity rule while containing
//       no field Gemini recognizes as a denial, i.e. silently failing open.
//       Fixed as part of landing this adapter: `denyJson()` now also emits
//       a top-level `decision`/`reason` pair Gemini reads, alongside the
//       original shape (harmless to Claude Code/Codex, which only look at
//       `hookSpecificOutput`). That top-level value is "block", not "deny":
//       Codex's hooks docs separately document a LEGACY top-level shape,
//       `{"decision":"block","reason":"..."}` — value "block", not "deny" —
//       so "block" is the one literal both readers of this key can point to
//       in their own docs (Codex is inert today, `containmentHook()` returns
//       `null`, see src/harness/codex.ts, but the shared field shouldn't
//       ship a value undocumented for either reader). See src/session/cli.ts
//       and src/session/__tests__/cli-guard.test.ts.
//     - What an EMPTY stdout on exit 0 means is not stated anywhere in
//       Gemini's hooks docs — only the deny/allow JSON shapes are documented,
//       not the zero-bytes case. The allow path here (`guardCommand` returns
//       `stdout: ""` — see src/session/cli.ts) relies on the reasonable but
//       UNCONFIRMED assumption that empty stdout on exit 0 behaves like "no
//       opinion" / implicit allow, matching Claude Code's and Codex's
//       documented behavior for the same case. Recorded as a documented
//       unknown, not silently assumed: Gemini is a brand-new containable
//       harness with no track record here, unlike Claude Code/Codex where
//       this exact shape has been running in production.
//  - Folder trust <https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/trusted-folders.md>
//    (the geminicli.com mirror momentarily disagreed with itself on the
//    default — the GitHub source is authoritative): "The Trusted Folders
//    feature is disabled by default." A user must opt in via their OWN
//    `settings.json` (`security.folderTrust.enabled: true`) — AIPe's install
//    never touches that key, so a freshly created worktree is unaffected by
//    folder trust: `.gemini/settings.json` loads immediately, no prompt.
//    (Had folder trust been on by default, it would gate exactly the way
//    Copilot's directory-trust prompt does — see copilot.ts — and this
//    adapter's answer would flip.)
//  - Hook trust (a SEPARATE, narrower mechanism from folder trust) — per
//    `docs/hooks/best-practices.md`: "1. Detection: Gemini CLI detects the
//    hooks. 2. Identification: a unique identity is generated... 3. Warning:
//    if this specific hook identity has not been seen before, a WARNING is
//    displayed. 4. Execution: the hook is EXECUTED (unless specific security
//    settings block it). 5. Trust: the hook is marked 'trusted' for this
//    project." Step 4 runs unconditionally on first sight — the warning is
//    informational, not a blocking interactive confirmation; nothing here
//    requires a human response before the hook fires. This is the material
//    difference from Codex, where trust is a precondition for execution, not
//    a post-hoc warning alongside it.
//  - Net: BOTH of Step 1's questions come back clean — a project-scoped
//    config AIPe can write (`.gemini/settings.json`), and it takes effect
//    with no interactive step a fresh worktree wouldn't clear (folder trust
//    off by default; hook-identity warning is non-blocking). Gemini IS
//    containable. `geminiAdapter.containmentHook()` returns a real hook.
//  - Skills: no Gemini-specific skill convention is documented (no
//    `.gemini/skills/` equivalent to Claude Code's or Codex's), so this
//    follows Codex's precedent — the cross-tool `.agents/skills/` SKILL.md
//    convention — for the same reason Codex adopted it: nothing more
//    Gemini-native is documented, and SKILL.md's frontmatter format is
//    explicitly cross-tool.
//  - MCP <https://geminicli.com/docs/reference/configuration/>: "`mcpServers`
//    (object): Configuration for connecting to Model Context Protocol (MCP)
//    servers" is a top-level key in `settings.json` (not a separate
//    `.mcp.json`), matching Gemini's own file, not Claude Code's.
//  - Models <https://geminicli.com/docs/reference/configuration/> and
//    <https://geminicli.com/docs/get-started/gemini-3/>: "Gemini 3 Pro is
//    presented as the flagship model for complex operations... Gemini 2.5
//    Pro serves as a fallback when Gemini 3 Pro reaches usage limits" and
//    the auto-router's own rule: "For simple prompts, it will automatically
//    use Gemini 2.5 Flash. For complex prompts, if Gemini 3 Pro is enabled,
//    it will use Gemini 3 Pro; otherwise, it will use Gemini 2.5 Pro." That
//    sentence hands us the hierarchy directly: gemini-3-pro-preview is the
//    strongest/flagship → `frontier`; gemini-2.5-pro is its immediate
//    fallback, i.e. strong-but-one-notch-down → `reasoning` (same
//    "strong-but-cheaper-than-frontier" convention as claude-code.ts and
//    codex.ts); gemini-3-flash-preview is the "Pro-grade coding, low-latency,
//    lower cost for high-frequency dev tasks" balanced tier → `standard`;
//    gemini-2.5-flash-lite is the cheapest/fastest tier documented → `fast`.
//    Re-checked 2026-08-14: the configuration-reference page ALSO lists
//    `gemini-3.1-pro-preview` ("tier":"pro","family":"gemini-3",
//    "isPreview":true) and `gemini-3.5-flash` ("tier":"flash","family":
//    "gemini-3","isPreview":false — i.e. production, not preview) — both
//    newer than the ids mapped above, and NOT accounted for here. Kept the
//    ids above anyway, deliberately, because the get-started page — the one
//    page that actually states the FALLBACK HIERARCHY these tiers are
//    modeling, not just a model list — still names "Gemini 3 Pro" (i.e.
//    gemini-3-pro-preview) as the router's flagship and "Gemini 2.5 Flash"
//    as its simple-prompt fallback; it mentions gemini-3.1-pro-preview only
//    as "rolling out" (gated behind `/model` access, not yet the router's
//    default) and never mentions gemini-3.5-flash at all. So the two
//    Gemini docs pages disagree with each other on which ids currently sit
//    at the top of each rung: the config reference's raw model list is
//    ahead of the get-started page's stated routing/fallback logic. Until
//    the get-started page's own hierarchy text is updated to name the newer
//    ids, this mapping follows the page that actually describes the
//    hierarchy rather than the page that merely enumerates models — same
//    "trust the page that states the rule, not the page that lists
//    ingredients" judgment codex.ts's Models note applies. Flagged rather
//    than silently resolved, per this task's Finding 2.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { FLOW_SKILLS, renderFlowSkills } from "./skills";
import type { ContainmentHook, HarnessAdapter, InstallReport, PersonaMeta, PersonaRole, StartupDelivery } from "./types";
import { CONTAINMENT_COMMAND } from "./types";

const ROLE_LABEL: Record<PersonaRole, string> = {
  "dev-fullstack": "Fullstack specialist",
  qa: "QA specialist (delivery gate)",
};

const ROLE_NOTE: Record<PersonaRole, string> = {
  "dev-fullstack": "",
  qa: " Runs as the MUST delivery gate: dispatched after each dev delivery to verify it before anything is reported done.",
};

const SESSION_CONTEXT_COMMAND = "aipe session-context";

// Lifecycle-event matcher: `"*"` matches all occurrences (startup, resume,
// AND clear) rather than guessing at which of the three exact strings to
// enumerate as separate entries.
const SESSION_START_HOOK = {
  matcher: "*",
  hooks: [{ type: "command", command: SESSION_CONTEXT_COMMAND }],
};

// `run_shell_command`, NOT `Bash` — see the file-header "Hooks" note. `command`
// already carries `--role <role>` baked in when one applies — see the `role`
// note on `containmentHook()` in ./types.ts.
function beforeToolHook(command: string) {
  return { matcher: "run_shell_command", hooks: [{ type: "command", command }] };
}

interface GeminiSettings {
  hooks?: { SessionStart?: unknown[]; BeforeTool?: unknown[]; [k: string]: unknown };
  [k: string]: unknown;
}

async function readSettings(path: string): Promise<GeminiSettings> {
  try {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") return parsed as GeminiSettings;
  } catch {
    // missing, empty, or malformed → start fresh
  }
  return {};
}

function hasAipeSessionContextHook(list: unknown[]): boolean {
  return list.some((entry) => JSON.stringify(entry).includes(SESSION_CONTEXT_COMMAND));
}

// Writes ONLY the SessionStart hook — see the identical decision (and its
// full reasoning) on ensureSessionStartHook in claude-code.ts: the
// BeforeTool containment merge that used to happen here installed a
// role-less `aipe session guard` at the workspace/repo root, which
// `decide()` always allows regardless of command, so it never contained
// anything — only added a subprocess to every shell call in the PE's own
// sessions. Real containment is installed per unit, with the specialist role
// baked in, directly into that unit's worktree by dispatchCommand.
export async function ensureGeminiHooks(workspaceDir: string): Promise<void> {
  const geminiDir = join(workspaceDir, ".gemini");
  const settingsPath = join(geminiDir, "settings.json");
  await mkdir(geminiDir, { recursive: true });

  const settings = await readSettings(settingsPath);
  settings.hooks ??= {};
  const sessionStart = Array.isArray(settings.hooks.SessionStart) ? settings.hooks.SessionStart : [];
  if (!hasAipeSessionContextHook(sessionStart)) sessionStart.push(SESSION_START_HOOK);
  settings.hooks.SessionStart = sessionStart;

  await writeFile(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
}

export const geminiAdapter: HarnessAdapter = {
  id: "gemini",
  label: "Gemini CLI",
  agentopHarness: "gemini",

  async installIntegration(workspaceDir: string): Promise<InstallReport> {
    // 1. merge the SessionStart + BeforeTool hooks into .gemini/settings.json
    //    (idempotent; preserves any foreign entries already there).
    await ensureGeminiHooks(workspaceDir);

    // 2. write the onboarding/operation flow skills under .agents/skills/.
    for (const [name, body] of Object.entries(renderFlowSkills(this))) {
      const { relDir, filename } = this.flowSkillTarget(name);
      const dir = join(workspaceDir, relDir);
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, filename), body, "utf8");
    }

    return {
      files: [".gemini/settings.json", `.agents/skills/ (${Object.keys(FLOW_SKILLS).length} skills)`],
      notes: [
        "SessionStart hook → aipe session-context",
        `${Object.keys(FLOW_SKILLS).length} AIPe skills installed`,
        // Containment (BeforeTool → aipe session guard) is installed per unit,
        // WITH the specialist role, directly into that unit's worktree at
        // `aipe session dispatch` time — never here (see ensureGeminiHooks).
      ],
    };
  },

  // The workspace install and the per-repo install are the SAME hook write —
  // `installIntegration` just also lays down the flow-skills.
  ensureStartupHook: ensureGeminiHooks,

  startupDelivery(): StartupDelivery {
    // Gemini documents a SessionStart hook event, so — like Claude Code and
    // Codex — awareness is delivered live rather than as a static file.
    return { mode: "hook", command: "aipe session-context" };
  },

  containmentHook(role?: string): ContainmentHook {
    // See the `role` note on HarnessAdapter#containmentHook in ./types.ts:
    // baked into the command literally, never delivered via env var.
    const command = role ? `${CONTAINMENT_COMMAND} --role ${role}` : CONTAINMENT_COMMAND;
    return {
      relPath: join(".gemini", "settings.json"),
      merge(existing: unknown): unknown {
        const settings: GeminiSettings =
          existing && typeof existing === "object" ? { ...(existing as GeminiSettings) } : {};
        const hooks = { ...(settings.hooks ?? {}) };
        const list = Array.isArray(hooks.BeforeTool) ? [...hooks.BeforeTool] : [];
        const already = list.some((e) => JSON.stringify(e).includes(command));
        if (!already) list.push(beforeToolHook(command));
        hooks.BeforeTool = list;
        settings.hooks = hooks;
        return settings;
      },
    };
  },

  personaTarget(slug: string): { relDir: string; filename: string } {
    return { relDir: join(".agents", "skills", slug), filename: "SKILL.md" };
  },

  // No agent-type concept in this harness: a persona exists purely as a skill.
  // Writing an `agents/` file here would look installed and be inert.
  agentTarget(_slug: string): null {
    return null;
  },

  flowSkillTarget(name: string): { relDir: string; filename: string } {
    return { relDir: join(".agents", "skills", name), filename: "SKILL.md" };
  },

  wrapPersona(body: string, meta: PersonaMeta): string {
    const stackLabel = meta.stack.length > 0 ? meta.stack.join(", ") : "unknown stack";
    const scope = meta.package ? `${meta.repo}/${meta.package}` : meta.repo;
    const unit = meta.package ? "package" : "repo";
    const description = `${ROLE_LABEL[meta.role]} for the ${scope} ${unit} (${stackLabel}). Dispatched by the coordinator for tasks scoped to ${scope}, or worn directly when a session opens inside the ${meta.repo} repo.${ROLE_NOTE[meta.role]}`;
    return `---\nname: ${meta.slug}\ndescription: ${description}\n---\n\n${body.trim()}\n`;
  },

  // Gemini reads settings from `.gemini/` and skills from `.agents/`.
  integrationPaths(): string[] {
    return [".gemini", ".agents"];
  },

  mcpConfigPath(scope: "workspace" | "repo", repo?: string): string {
    // Gemini registers MCP servers under the `mcpServers` key inside its own
    // settings.json — not a separate .mcp.json file.
    return scope === "repo" && repo ? join(repo, ".gemini", "settings.json") : join(".gemini", "settings.json");
  },

  resolveModel(tier: string): { id: string; label: string } | null {
    // See the file-header "Models" note: gemini-3-pro-preview is the current
    // flagship ("presented as the flagship model for complex operations") →
    // `frontier`; gemini-2.5-pro is its documented fallback, i.e. the
    // strong-but-one-notch-down tier → `reasoning`; gemini-3-flash-preview is
    // the "Pro-grade coding... lower cost" balanced tier → `standard`;
    // gemini-2.5-flash-lite is the cheapest/fastest tier → `fast`.
    const map: Record<string, { id: string; label: string }> = {
      fast: { id: "gemini-2.5-flash-lite", label: "Gemini 2.5 Flash-Lite" },
      standard: { id: "gemini-3-flash-preview", label: "Gemini 3 Flash" },
      reasoning: { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
      frontier: { id: "gemini-3-pro-preview", label: "Gemini 3 Pro" },
    };
    return map[tier] ?? null;
  },
};
