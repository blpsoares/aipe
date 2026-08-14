// The Codex CLI adapter: a project-scoped PreToolUse hook (containment) +
// SessionStart hook (live awareness) under .codex/hooks.json, skills under
// .agents/skills/, personas as .agents/skills/<slug>/SKILL.md, MCP servers in
// .codex/config.toml.
//
// Conventions re-verified against the live docs on 2026-08-14 (the plan's
// table is a starting point, not authority — see docs/superpowers/plans/
// 2026-08-14-agentop-session-dispatch.md, "Two namespaces"). Findings:
//
//  - Hooks <https://learn.chatgpt.com/docs/hooks>:
//     - `PreToolUse` "can intercept Bash, file edits performed through
//       apply_patch, MCP tool calls, and other local function tools" — Bash
//       matched via `"matcher": "Bash"`, same as Claude Code.
//     - Decision shape matches Claude Code's exactly:
//       `{ "hookSpecificOutput": { "hookEventName": "PreToolUse",
//          "permissionDecision": "deny"|"allow", "permissionDecisionReason": "…" } }`.
//     - Feature gate: "Hooks are enabled by default. To turn them off in
//       config.toml, set: `[features] hooks = false`" — `hooks` is the
//       canonical key; `codex_hooks` still works as a deprecated alias. No
//       opt-in needed by AIPe.
//     - Project-scoped hook file: `<repo>/.codex/hooks.json` (JSON) — loads
//       ONLY when the project's `.codex/` layer is trusted; a user trusts it
//       interactively via the `/hooks` CLI command. AIPe writing the file
//       does not itself trust it — surfaced as an install note below.
//     - Also confirmed a `SessionStart` hook event exists ("When a session
//       or subagent starts: SessionStart, SubagentStart"), so
//       `startupDelivery` below uses hook mode, not the file fallback.
//  - Skills <https://learn.chatgpt.com/codex/build-skills>: project-scoped
//    skills live at `$CWD/.agents/skills` (repo-scoped) or
//    `$REPO_ROOT/.agents/skills`, NOT `.codex/skills/` — the plan's table
//    guessed `.codex/skills/`; the docs disagree, so this file follows the
//    docs. SKILL.md itself uses the same YAML-frontmatter (`name`,
//    `description`) convention as Claude Code — "The same SKILL.md files
//    work across Codex CLI, Claude Code, OpenClaw, and other compatible
//    agents" — so `wrapPersona` below is unchanged from Claude Code's.
//  - AGENTS.md <https://learn.chatgpt.com/codex/agent-configuration/agents-md>:
//    "Codex reads AGENTS.md files before doing any work," built once per
//    launched session — the always-on context file, same role it plays for
//    the generic adapter.
//  - MCP <search: "Codex CLI MCP servers config.toml mcp_servers project
//    scoped">: servers are registered under `[mcp_servers.<name>]` in
//    `config.toml` (`~/.codex/config.toml` global, `<repo>/.codex/config.toml`
//    project-scoped, trusted projects only) — NOT a `.mcp.json` file, so
//    `mcpConfigPath` below deliberately differs from Claude Code/generic.
//  - Models <https://learn.chatgpt.com/codex/models>, re-fetched 2026-08-14
//    (a prior pass here mapped `reasoning`→gpt-5.6-sol and `frontier`→gpt-5.5
//    off a keyword match on "frontier model" in gpt-5.5's blurb — wrong: it
//    quoted the phrase without checking which model it actually crowns).
//    The page's own words settle the hierarchy: gpt-5.6-sol is "Flagship
//    GPT-5.6 model with the strongest capability for complex coding, computer
//    use, research, and cybersecurity" — the strongest model in the family,
//    i.e. this repo's `frontier` tier (see claude-code.ts: frontier = the
//    strongest available model). gpt-5.5 is labelled, verbatim, "**Previous-
//    generation** frontier model for complex coding, computer use, knowledge
//    work, and research workflows" — still strong, but explicitly the older,
//    now-cheaper-relative-to-sol frontier model, i.e. this repo's `reasoning`
//    tier (strong-but-cheaper than frontier). gpt-5.6-terra is "Balanced …
//    everyday work" → `standard`. gpt-5.6-luna is "fast and affordable …
//    lowest cost in the family" → `fast`. (gpt-5.4/gpt-5.4-mini retire
//    2026-08-31 and are not used here regardless.)
//  - Containment <https://learn.chatgpt.com/docs/hooks>: Codex requires a
//    human to interactively review and TRUST each non-managed hook via the
//    `/hooks` CLI command — trust is per-hook-hash, and there is no
//    config-file way to self-declare it. The only two bypasses are (a) an
//    admin-provisioned "managed" hook via `requirements.toml` — a per-project
//    `.codex/hooks.json`, which is what AIPe writes, is NOT that — or (b) the
//    `--dangerously-bypass-hook-trust` flag, which this adapter does not set
//    (it says "dangerously" for a reason, and session dispatch has no human
//    in the loop to have made that call). AIPe's session dispatch is fully
//    non-interactive — it provisions the worktree and starts the session
//    with nobody present to ever run `/hooks` — so a Codex PreToolUse hook
//    written to disk is inert: present, well-formed, and never trusted.
//    `codexAdapter.containmentHook()` therefore returns `null` (see its
//    definition below for what would have to change for that to flip).
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { FLOW_SKILLS } from "./skills";
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

// No `$CODEX_PROJECT_DIR`-equivalent env var is documented for a hook
// command's shell invocation (the hooks page documents `cwd` as a JSON field
// on the PreToolUse payload, not as a substitutable shell variable). Rather
// than invent one, this relies on the same assumption the generic adapter's
// bootstrap text already makes explicit: a project-scoped hook config
// (`.codex/hooks.json`, written at the repo root) runs with the repo as its
// working directory, so the bare, flag-less invocation is enough —
// `aipe session-context` defaults `--workspace` to `process.cwd()`.
// Single source of truth for the SessionStart command string — used both to
// render the hook entry and to detect it already being present, so the two
// can't drift the way a duplicated literal would let them (same discipline as
// `CONTAINMENT_COMMAND` above for the guard hook).
const SESSION_CONTEXT_COMMAND = "aipe session-context";

const SESSION_START_HOOK = {
  matcher: "startup|resume",
  hooks: [{ type: "command", command: SESSION_CONTEXT_COMMAND }],
};

const PRE_TOOL_USE_HOOK = {
  matcher: "Bash",
  hooks: [{ type: "command", command: CONTAINMENT_COMMAND }],
};

interface CodexHooksFile {
  hooks?: { SessionStart?: unknown[]; PreToolUse?: unknown[]; [k: string]: unknown };
  [k: string]: unknown;
}

async function readHooksFile(path: string): Promise<CodexHooksFile> {
  try {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") return parsed as CodexHooksFile;
  } catch {
    // missing, empty, or malformed → start fresh
  }
  return {};
}

function hasAipeSessionContextHook(list: unknown[]): boolean {
  return list.some((entry) => JSON.stringify(entry).includes(SESSION_CONTEXT_COMMAND));
}

// The actual PreToolUse-merge logic. Kept as a plain function — rather than
// only reachable through `codexAdapter.containmentHook()` — because
// `containmentHook()` returns `null` (Codex is not containable; see its
// definition below) while `installIntegration` must still WRITE this hook to
// disk: the file stays present (and inert until a human runs `/hooks`) so
// that trusting it later is a one-step `/hooks` action, not a re-install.
function mergeContainmentHook(existing: unknown): unknown {
  const config: CodexHooksFile =
    existing && typeof existing === "object" ? { ...(existing as CodexHooksFile) } : {};
  const hooks = { ...(config.hooks ?? {}) };
  const list = Array.isArray(hooks.PreToolUse) ? [...hooks.PreToolUse] : [];
  const already = list.some((e) => JSON.stringify(e).includes(CONTAINMENT_COMMAND));
  if (!already) list.push(PRE_TOOL_USE_HOOK);
  hooks.PreToolUse = list;
  config.hooks = hooks;
  return config;
}

export async function ensureCodexHooks(workspaceDir: string): Promise<void> {
  const codexDir = join(workspaceDir, ".codex");
  const hooksPath = join(codexDir, "hooks.json");
  await mkdir(codexDir, { recursive: true });

  const config = await readHooksFile(hooksPath);
  // `hooks: null` (malformed-but-parseable) must be treated the same as
  // absent, never dereferenced — `??` catches both undefined AND null.
  config.hooks ??= {};
  const sessionStart = Array.isArray(config.hooks.SessionStart) ? config.hooks.SessionStart : [];
  if (!hasAipeSessionContextHook(sessionStart)) sessionStart.push(SESSION_START_HOOK);
  config.hooks.SessionStart = sessionStart;

  const merged = mergeContainmentHook(config);
  await writeFile(hooksPath, `${JSON.stringify(merged, null, 2)}\n`, "utf8");
}

export const codexAdapter: HarnessAdapter = {
  id: "codex",
  label: "Codex CLI",
  agentopHarness: "codex",

  async installIntegration(workspaceDir: string): Promise<InstallReport> {
    // 1. merge the SessionStart + PreToolUse hooks into .codex/hooks.json
    //    (idempotent; preserves any foreign entries already there).
    await ensureCodexHooks(workspaceDir);

    // 2. write the onboarding/operation flow skills under .agents/skills/.
    for (const [name, body] of Object.entries(FLOW_SKILLS)) {
      const { relDir, filename } = this.flowSkillTarget(name);
      const dir = join(workspaceDir, relDir);
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, filename), body, "utf8");
    }

    return {
      files: [".codex/hooks.json", `.agents/skills/ (${Object.keys(FLOW_SKILLS).length} skills)`],
      notes: [
        "SessionStart hook → aipe session-context",
        "PreToolUse hook → aipe session guard (containment)",
        `${Object.keys(FLOW_SKILLS).length} AIPe skills installed`,
        "Codex loads project-local .codex/ hooks only once the project is trusted — run `/hooks` in the Codex CLI to trust them",
      ],
    };
  },

  startupDelivery(): StartupDelivery {
    // Codex documents a SessionStart hook event, so — like Claude Code —
    // awareness is delivered live (computed on every session by
    // `aipe session-context`) rather than as a static file.
    return { mode: "hook", command: "aipe session-context" };
  },

  // `null`: Codex is NOT containable, and therefore not eligible for
  // session-mode dispatch (see `isContainable` in ./types.ts). This is not a
  // gap to patch quietly — it's the eligibility rule working as designed:
  // AIPe never starts a session it cannot govern.
  //
  // Why null despite `installIntegration` writing a real PreToolUse hook to
  // `.codex/hooks.json`: per learn.chatgpt.com/docs/hooks, Codex only loads a
  // project's non-managed hooks after a human interactively TRUSTS them via
  // the `/hooks` CLI command — trust is per-hook-hash, with no config-file
  // way to self-declare it. The two documented bypasses are (a) an
  // admin-provisioned "managed" hook via `requirements.toml`, which a
  // per-project `.codex/hooks.json` is not, and (b) the
  // `--dangerously-bypass-hook-trust` flag, which this adapter deliberately
  // does not pass. AIPe's session dispatch is fully non-interactive — worktree
  // creation, `.codex/hooks.json` write, and session start all happen with no
  // human present to ever run `/hooks` — so a dispatched Codex session's
  // containment hook is on disk and inert. Reporting containable here would
  // let `isContainable` say true while nothing actually blocks a command:
  // silently wrong is worse than ineligible.
  //
  // What would make this containable: either (1) an automated, verifiable
  // trust step — e.g. if Codex ships a non-interactive `/hooks`-equivalent
  // (a CLI flag or API that trusts a hook by hash without a human present),
  // this adapter could invoke it as part of `installIntegration` and this
  // accessor could return non-null once that call succeeds; or (2) dispatch
  // itself verifying trust state before relying on it — reading whatever
  // local record Codex's own trust store produces and refusing to
  // session-dispatch the moment it finds "untrusted", rather than assuming
  // trust because a file was written. Absent either, `null` is the only
  // honest answer.
  containmentHook(): ContainmentHook | null {
    return null;
  },

  personaTarget(slug: string): { relDir: string; filename: string } {
    return { relDir: join(".agents", "skills", slug), filename: "SKILL.md" };
  },

  flowSkillTarget(name: string): { relDir: string; filename: string } {
    return { relDir: join(".agents", "skills", name), filename: "SKILL.md" };
  },

  wrapPersona(body: string, meta: PersonaMeta): string {
    // Same YAML-frontmatter SKILL.md convention as Claude Code — see the
    // file-header comment: SKILL.md is a cross-tool format.
    const stackLabel = meta.stack.length > 0 ? meta.stack.join(", ") : "unknown stack";
    const scope = meta.package ? `${meta.repo}/${meta.package}` : meta.repo;
    const unit = meta.package ? "package" : "repo";
    const description = `${ROLE_LABEL[meta.role]} for the ${scope} ${unit} (${stackLabel}). Dispatched by the coordinator for tasks scoped to ${scope}, or worn directly when a session opens inside the ${meta.repo} repo.${ROLE_NOTE[meta.role]}`;
    return `---\nname: ${meta.slug}\ndescription: ${description}\n---\n\n${body.trim()}\n`;
  },

  mcpConfigPath(scope: "workspace" | "repo", repo?: string): string {
    // Codex registers MCP servers under [mcp_servers.<name>] in config.toml,
    // not a .mcp.json file — deliberately different from Claude Code/generic.
    return scope === "repo" && repo ? join(repo, ".codex", "config.toml") : join(".codex", "config.toml");
  },

  resolveModel(tier: string): { id: string; label: string } | null {
    // See the file-header "Models" note: gpt-5.6-sol is the current flagship
    // ("strongest capability for complex coding … research") → `frontier`;
    // gpt-5.5 is explicitly "Previous-generation frontier model" → the
    // strong-but-cheaper `reasoning` tier, matching claude-code.ts's
    // convention (frontier = strongest available; reasoning = one notch down).
    const map: Record<string, { id: string; label: string }> = {
      fast: { id: "gpt-5.6-luna", label: "GPT-5.6 Luna" },
      standard: { id: "gpt-5.6-terra", label: "GPT-5.6 Terra" },
      reasoning: { id: "gpt-5.5", label: "GPT-5.5" },
      frontier: { id: "gpt-5.6-sol", label: "GPT-5.6 Sol" },
    };
    return map[tier] ?? null;
  },
};
