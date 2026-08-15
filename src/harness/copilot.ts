// The GitHub Copilot CLI adapter: writes a repository-level preToolUse hook +
// sessionStart hook to `.github/hooks/aipe.json`, skills under
// .agents/skills/ (same cross-tool SKILL.md convention as Codex/Gemini —
// nothing Copilot-native is documented), personas as
// .agents/skills/<slug>/SKILL.md, MCP servers cross-read from `.mcp.json`
// (Copilot documents reading the Claude-Code-shaped file directly).
//
// Conventions verified against the live docs on 2026-08-14. Findings:
//
//  - Hooks <https://docs.github.com/en/copilot/reference/hooks-reference>:
//     - Event name is lowercase `preToolUse` ("PascalCase `PreToolUse` is
//       also accepted for VS Code compatibility", but the canonical/primary
//       form documented is lowercase — matching the task's own pinned test).
//     - Repository-level file: "`.github/hooks/*.json` in the repository
//       root" — a directory of merged files, so this adapter picks a fixed
//       name, `aipe.json`, inside it.
//     - Config shape: `{"version":1,"hooks":{"preToolUse":[{"type":"command",
//       "bash":"...","powershell":"...", ...}]}}` — Copilot's command hook
//       uses `bash`/`powershell` fields (OS-specific scripts), NOT a single
//       cross-platform `command` field like Claude Code/Codex/Gemini. This
//       adapter sets `bash` to the exact `CONTAINMENT_COMMAND` string (the
//       dispatch/worktree/agentop toolchain this repo targets is POSIX) and
//       leaves `powershell` unset rather than inventing an untested
//       PowerShell equivalent.
//     - Deny shape: TOP-LEVEL `{"permissionDecision":"allow"|"deny"|"ask",
//       "permissionDecisionReason":"..."}` — confirmed NOT nested under a
//       `hookSpecificOutput` object (unlike Claude Code/Codex). `aipe
//       session guard`'s current `denyJson()` only emits the
//       `hookSpecificOutput`-nested shape (fixed for Gemini's top-level
//       `decision`/`reason` pair as part of landing this task's Gemini
//       adapter — see src/session/cli.ts) — it does NOT yet emit Copilot's
//       top-level `permissionDecision`. Left unfixed here deliberately:
//       `copilotAdapter.containmentHook()` returns `null` (see below), so no
//       real install ever depends on this shape landing correctly; wiring it
//       up would be dead code for an adapter nothing dispatches through.
//       Recorded here as exactly what would need to happen if a later change
//       flips this adapter to containable.
//     - Exit codes: "exit code 2 is treated as a deny... non-zero exit...
//       denies the tool call... but timeouts are always fail-open." `aipe
//       session guard` always exits 0, so this path is moot regardless of
//       the shape question above.
//
//  - Directory trust — THE reason this adapter is not containable. Per
//    <https://docs.github.com/en/copilot/how-tos/copilot-cli/set-up-copilot-cli/configure-copilot-cli>:
//    "When you start a GitHub Copilot CLI session, you'll be asked to
//    confirm that you trust the files in, and below, the directory from
//    which you launched the CLI." This is default-ON behavior for ANY
//    directory Copilot CLI has not seen before — unlike Gemini's folder
//    trust, which is "disabled by default" (see gemini.ts's header comment)
//    and therefore never gates a fresh AIPe worktree at all. A freshly
//    created worktree is, by construction, absent from the CLI's trust
//    record, so it hits this default-on prompt.
//     - There IS a config-file way to pre-declare trust — "Edit the contents
//       of the `trustedFolders` array" in `~/.copilot/config.json` — a real,
//       non-interactive mechanism, genuinely unlike Codex's "no config-file
//       way to self-declare trust" at all. This adapter does NOT use it,
//       for two reasons that together make it a materially different case
//       from the SessionStart/BeforeTool hook file:
//         1. It is a GLOBAL user file, not a workspace-relative one. Every
//          other config surface this project writes for containment is
//          workspace-relative BY REQUIREMENT (see ContainmentHook.relPath in
//          ./types.ts) specifically so it lives and dies with the worktree
//          and never leaks scope onto unrelated sessions of the same
//          harness. An entry in `trustedFolders` for this worktree's
//          absolute path would OUTLIVE the worktree (nothing deletes it on
//          cleanup) and would have to be appended/removed as an out-of-band
//          side effect that has no analogue anywhere else in this codebase.
//         2. Whether it actually gates hook-loading (as opposed to only the
//          general-purpose read/modify/execute confirmation) is UNCONFIRMED
//          in the docs. The one sentence in the hooks reference that
//          mentions trust at all — "[policy hooks] are available regardless
//          of folder trust state" — singles out policy hooks as the
//          exception, which only makes sense to say if some OTHER hook tier
//          (project-level, i.e. exactly what this adapter would write) is
//          ordinarily subject to folder trust state. Repository-level hooks
//          are never explicitly stated to be exempt.
//     - What happens under AIPe's actual invocation shape — non-interactive,
//       no TTY, nobody present to answer the confirmation — is NOT stated in
//       GitHub's own docs. The only claim found (a third-party blog, not
//       docs.github.com) says the prompt "may not appear" in `-p`/headless
//       mode; GitHub's own configure-copilot-cli page, asked directly,
//       returns no statement either way. An unconfirmed third-party claim is
//       not a documented guarantee.
//     - Net: a default-on trust gate a fresh worktree does not satisfy,
//       textual evidence that non-policy hooks are ordinarily subject to it,
//       and no OFFICIAL confirmation of safe non-interactive behavior. This
//       is the same shape of problem Codex had (a trust precondition AIPe's
//       fully unattended dispatch cannot clear) even though the specific
//       mechanism differs (directory trust vs. per-hook-hash trust) and a
//       config-file trust list exists here where Codex had none. Per the
//       eligibility rule: AIPe never starts a session it cannot govern, and
//       "silently wrong is worse than ineligible" — so `containmentHook()`
//       returns `null`.
//     - What would flip this: an official GitHub doc confirming either (a)
//       Copilot CLI running under `-p`/programmatic mode skips the directory
//       trust prompt AND repository hooks still load, or (b) a
//       workspace-scoped (not `~/.copilot/`) way to pre-declare trust that
//       lives inside the worktree and disappears with it.
//
//  - Skills: no Copilot-native persona/skill directory is documented (no
//    `.copilot/skills/`), so this follows the same cross-tool
//    `.agents/skills/` SKILL.md convention as Codex and Gemini.
//  - MCP <https://docs.github.com/en/copilot/reference/hooks-reference>
//    ("Hooks locations"): "Cross-tool `.claude/settings.json` and
//    `.claude/settings.local.json` files in the repository are also read" —
//    Copilot CLI is documented to read Claude Code's own config surfaces
//    directly, so `mcpConfigPath` reuses `.mcp.json`, same as Claude
//    Code/generic, rather than inventing a Copilot-only path.
//  - Models, re-verified 2026-08-14 against CLI-specific pages (not the
//    general cross-client supported-models table, which lists many models
//    without a CLI-specific capability ranking):
//    <https://docs.github.com/en/copilot/how-tos/copilot-cli/cli-best-practices>:
//    "Claude Opus 4.5 (default): Most capable but more costly... Complex
//    architecture, difficult debugging, nuanced refactoring" → the
//    documented CLI default AND flagship → `frontier`. "Claude Sonnet 4.5:
//    Fast, cost-effective, handles most work well... Day-to-day coding, most
//    routine tasks" → the balanced, everyday tier → `standard`.
//    <https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-programmatic-reference>:
//    recommends "a fast, lower cost model such as a Claude Haiku model" for
//    straightforward work → `fast` = claude-haiku-4.5; and "a more powerful
//    model, such as a GPT Codex model" for demanding/complex-reasoning work
//    (`gpt-5.3-codex`, listed as an example `--model` value on the same
//    page) → `reasoning`.
//    CONFLICT, re-checked 2026-08-14: `cli-best-practices` — the OTHER GitHub
//    page cited just above for the frontier/standard tiers — lists "GPT-5.2
//    Codex" (not 5.3) for the identical "difficult debugging, nuanced
//    refactoring"-class reasoning use case. GitHub's own two pages disagree
//    with each other on the version number for this exact tier: one worked
//    example says `gpt-5.3-codex`, one best-practices list says "GPT-5.2
//    Codex". Kept `gpt-5.3-codex` here because `cli-programmatic-reference`
//    gives it as a literal, copy-pasteable `--model` flag value — the exact
//    string this field needs to be valid input for the CLI — while
//    `cli-best-practices` names "GPT-5.2 Codex" only as prose in a
//    human-readable guidance list, with no accompanying flag-value spelling
//    to confirm whether it means `gpt-5.2-codex` or is itself a stale label
//    for the same underlying model line. A working, documented literal
//    outranks an undated prose mention when the field's contract is "must be
//    a value the CLI accepts." Not silently resolved: this is the version
//    conflict this task's Finding 2 asked to be flagged, not adjudicated
//    away as a settled fact.
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

const SESSION_CONTEXT_COMMAND = "aipe session-context";

const SESSION_START_HOOK = { type: "command", bash: SESSION_CONTEXT_COMMAND };
const PRE_TOOL_USE_HOOK = { type: "command", bash: CONTAINMENT_COMMAND, matcher: "bash" };

interface CopilotHooksFile {
  version?: number;
  hooks?: { sessionStart?: unknown[]; preToolUse?: unknown[]; [k: string]: unknown };
  [k: string]: unknown;
}

async function readHooksFile(path: string): Promise<CopilotHooksFile> {
  try {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") return parsed as CopilotHooksFile;
  } catch {
    // missing, empty, or malformed → start fresh
  }
  return {};
}

function hasAipeSessionContextHook(list: unknown[]): boolean {
  return list.some((entry) => JSON.stringify(entry).includes(SESSION_CONTEXT_COMMAND));
}

// The actual preToolUse-merge logic. Kept as a plain function — rather than
// only reachable through `copilotAdapter.containmentHook()` — because
// `containmentHook()` returns `null` (Copilot is not containable; see the
// file header) while `installIntegration` must still WRITE this hook to
// disk: the file stays present so that if a future change resolves the
// directory-trust question, enabling it doesn't require a re-install.
function mergeContainmentHook(existing: unknown): unknown {
  const config: CopilotHooksFile =
    existing && typeof existing === "object" ? { ...(existing as CopilotHooksFile) } : {};
  config.version ??= 1;
  const hooks = { ...(config.hooks ?? {}) };
  const list = Array.isArray(hooks.preToolUse) ? [...hooks.preToolUse] : [];
  const already = list.some((e) => JSON.stringify(e).includes(CONTAINMENT_COMMAND));
  if (!already) list.push(PRE_TOOL_USE_HOOK);
  hooks.preToolUse = list;
  config.hooks = hooks;
  return config;
}

export async function ensureCopilotHooks(workspaceDir: string): Promise<void> {
  const hooksDir = join(workspaceDir, ".github", "hooks");
  const hooksPath = join(hooksDir, "aipe.json");
  await mkdir(hooksDir, { recursive: true });

  const config = await readHooksFile(hooksPath);
  config.hooks ??= {};
  const sessionStart = Array.isArray(config.hooks.sessionStart) ? config.hooks.sessionStart : [];
  if (!hasAipeSessionContextHook(sessionStart)) sessionStart.push(SESSION_START_HOOK);
  config.hooks.sessionStart = sessionStart;

  const merged = mergeContainmentHook(config);
  await writeFile(hooksPath, `${JSON.stringify(merged, null, 2)}\n`, "utf8");
}

export const copilotAdapter: HarnessAdapter = {
  id: "copilot",
  label: "Copilot CLI",
  agentopHarness: "copilot",

  async installIntegration(workspaceDir: string): Promise<InstallReport> {
    // 1. merge the sessionStart + preToolUse hooks into .github/hooks/aipe.json
    //    (idempotent; preserves any foreign entries already there).
    await ensureCopilotHooks(workspaceDir);

    // 2. write the onboarding/operation flow skills under .agents/skills/.
    for (const [name, body] of Object.entries(FLOW_SKILLS)) {
      const { relDir, filename } = this.flowSkillTarget(name);
      const dir = join(workspaceDir, relDir);
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, filename), body, "utf8");
    }

    return {
      files: [".github/hooks/aipe.json", `.agents/skills/ (${Object.keys(FLOW_SKILLS).length} skills)`],
      notes: [
        "sessionStart hook → aipe session-context",
        "preToolUse hook → aipe session guard (containment)",
        `${Object.keys(FLOW_SKILLS).length} AIPe skills installed`,
        "Copilot CLI's default-on directory-trust confirmation is not resolvable non-interactively — this harness is not eligible for session-mode dispatch (see src/harness/copilot.ts)",
      ],
    };
  },

  startupDelivery(): StartupDelivery {
    // Copilot documents a sessionStart hook event, so awareness is delivered
    // live rather than as a static file.
    return { mode: "hook", command: "aipe session-context" };
  },

  // `null`: see the file-header block comment. Copilot's default-on
  // directory-trust confirmation is a gate a freshly created, never-before-
  // seen worktree does not clear, and GitHub's own docs never confirm safe
  // non-interactive behavior for it — the same shape of problem that ruled
  // out Codex, via a different mechanism.
  containmentHook(_role?: string): ContainmentHook | null {
    return null;
  },

  personaTarget(slug: string): { relDir: string; filename: string } {
    return { relDir: join(".agents", "skills", slug), filename: "SKILL.md" };
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

  mcpConfigPath(scope: "workspace" | "repo", repo?: string): string {
    // Copilot CLI is documented to read Claude Code's own `.claude/settings*`
    // files directly ("Hooks locations" — cross-tool section); reusing
    // `.mcp.json` here follows the same "don't invent a Copilot-only path
    // when the docs point at an existing one" rule.
    return scope === "repo" && repo ? join(repo, ".mcp.json") : ".mcp.json";
  },

  resolveModel(tier: string): { id: string; label: string } | null {
    // See the file-header "Models" note: claude-opus-4.5 is the documented
    // CLI default AND flagship ("Most capable but more costly") → `frontier`;
    // claude-sonnet-4.5 is the balanced everyday tier → `standard`;
    // claude-haiku-4.5 is the docs' own "fast, lower cost" recommendation →
    // `fast`; gpt-5.3-codex is the docs' "more powerful... for complex
    // tasks" recommendation → `reasoning`.
    const map: Record<string, { id: string; label: string }> = {
      fast: { id: "claude-haiku-4.5", label: "Claude Haiku 4.5" },
      standard: { id: "claude-sonnet-4.5", label: "Claude Sonnet 4.5" },
      reasoning: { id: "gpt-5.3-codex", label: "GPT-5.3 Codex" },
      frontier: { id: "claude-opus-4.5", label: "Claude Opus 4.5" },
    };
    return map[tier] ?? null;
  },
};
