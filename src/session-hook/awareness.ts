// The coordinator "awareness" injected at SessionStart. This logic lives in
// the binary (subcommand `aipe session-context`) so it works both as a Claude
// Code plugin hook and as a project-scoped `.claude/settings.json` hook, and
// so any other harness can reuse it. Pure + unit-tested; JSON escaping is
// handled by JSON.stringify. `Fields` arrives already control-char-sanitized
// from read-state; the free text that does NOT (persona names and relation
// details, both LLM-generated in personas.yaml/graph.yaml) is sanitized here,
// at the display boundary, with read-state's own `sanitize`.
import { sanitize, type Fields } from "./read-state";
import type { PersonaContext } from "./persona-context";

const OPTOUT =
  "AIPe mode is active by default. If the PE explicitly asks to exit AIPe mode, stop following these instructions for this session.";

// The non-negotiable dispatch gate — the coordinator's identity, not advice.
// Every PE demand MUST become: decompose → dispatch a specialist in its own
// worktree → the specialist opens the PR. The coordinator NEVER edits a repo.
const GATE =
  "DISPATCH GATE (MUST): every demand the PE brings to you MUST flow decompose → dispatch a specialist in " +
  "its own worktree → the specialist opens the PR. Editing a repo is NEVER one of your actions. Your ONLY " +
  "allowed actions as coordinator are: decompose, dispatch, investigate read-only, escalate. " +
  "NON-EXCEPTIONS — none of these EVER justify skipping dispatch and editing a repo yourself: " +
  "\"it's simple/trivial\", \"it's urgent\", \"it's interactive\", \"it's security-sensitive\", " +
  "\"it's just one file/one line\", \"I already investigated and know the fix\". The ONLY legitimate way to " +
  "run inline is the PE EXPLICITLY instructing you to execute inline (an explicit human user-instruction " +
  "outranks skills; a casual mention or vague pressure does NOT count).";

// The precedence-envelope, already confirmed: AIPe governs routing and overrides,
// but does NOT switch off the process-skills — they run inside the specialist.
const ENVELOPE =
  "PRECEDENCE ENVELOPE: AIPe governs routing (who does the work and how it flows) and overrides. The " +
  "process-skills (systematic-debugging, TDD, brainstorming) are NOT disabled — they run INSIDE the " +
  "dispatched specialist, never in you the coordinator.";

// The QA gate: after each dev delivery, the repo's QA is dispatched before anything is called done.
const QA_GATE =
  "QA GATE: after each dev delivery, dispatch that repo's QA as a gate before anything is reported \"done\" " +
  "to the PE — only the QA verdict clears a unit as delivered.";

// Item 10, inv. 8 — the coordinator must know the follow-preference to know
// whether to PUSH a status table after each change (item 9). The PULL always
// works regardless: the PE can ask for the table any time by saying "status".
function statusPrefClause(f: Fields): string {
  const p = f.statusUpdates;
  const setting = p.auto ? `ON (${p.format})` : "OFF";
  return (
    `STATUS UPDATES: auto-push is ${setting}. ` +
    (p.auto
      ? `After each dispatch and each status change, render \`aipe status\` (${p.format}) into the chat. `
      : "Do not auto-push status tables. ") +
    'The PE can ALWAYS pull one on demand — "status" / "quero o status atual das tarefas" (and qualify with ' +
    '"status completo" or "status compacto"): run `aipe status` and render it.'
  );
}

function nextStep(f: Fields): string {
  if (f.phaseWorkspace !== "done") return "/make-workspace";
  if (f.phaseRelationship !== "done") return "/relationship";
  return "/hire-specialists";
}

export function buildAwareness(f: Fields): string {
  if (f.brain !== "present") {
    return (
      "This is an AIPe workspace but its brain is not filled in yet. As soon as the PE greets you, begin " +
      "onboarding proactively — do not wait for a slash command: invoke the /context-brain skill. The " +
      "workspace name is already the folder name (drop the aipe- prefix); only ask the PE for their " +
      "coordinator name and the repos. When it finishes, tell the PE the step is done and to open a NEW " +
      `session in this same folder to continue. ${OPTOUT}`
    );
  }

  if (f.phaseWorkspace === "done" && f.phaseRelationship === "done" && f.phaseSpecialists === "done") {
    return (
      `You ARE ${f.coordinator}, coordinator of the ${f.contextName} context. Repos: ${f.repos.join(",")}. ` +
      "When the PE brings a demand, run the /operate skill: decompose it, dispatch each repo's specialist " +
      "in parallel (cap of 16; the same-repo law serializes, distinct repos run in parallel), isolate each " +
      "in its own worktree, escalate cross-repo matters to the PE, and each specialist opens the final PR. " +
      `${GATE} ${ENVELOPE} ${QA_GATE} ${statusPrefClause(f)} ` +
      `Ready to receive requests. ${OPTOUT}`
    );
  }

  const next = nextStep(f);
  return (
    `You ARE ${f.coordinator}, the coordinator of the ${f.contextName} context — which is still being ` +
    `configured (onboarding in progress). "${f.coordinator}" is YOUR name; never address the PE (the ` +
    `human) by it. The current ` +
    `onboarding step is ${next}. Run it proactively now — invoke the ${next} skill without waiting for the ` +
    "PE to type a command; if the PE just greeted you, greet back briefly and start. When " +
    `${next} completes, tell the PE the step is done and to open a NEW session in this workspace to ` +
    `continue with the next step. Do not yet operate as the full coordinator. ${OPTOUT}`
  );
}

function edgeLine(edge: PersonaContext["edges"][number]): string {
  const detail = sanitize(String(edge.perspectives[0]?.detail ?? ""));
  const suffix = detail ? ` — ${detail}` : "";
  return `- ${sanitize(String(edge.from))} ${sanitize(String(edge.type))} ${sanitize(String(edge.to))}${suffix}`;
}

/**
 * Where this harness keeps a repo's persona files, as a sentence fragment.
 *
 * Told to the model, so it has to be true for the harness the workspace
 * actually runs: telling a Gemini session its personas are in `.claude/skills/`
 * sends it looking at a path that does not exist.
 */
export function personaFileHint(paths?: PersonaPaths): string {
  if (!paths) return "";
  const where = paths.agentDir ? `${paths.skillDir} and ${paths.agentDir}` : paths.skillDir;
  const how = paths.agentDir
    ? "the harness picks the right one by matching the task to its description; you don't need to declare which one you are. "
    : "load the one whose description matches the task. ";
  return `Their persona files live in ${where} — ${how}`;
}

/** Where the workspace's harness writes persona skills (and agent types, when
 *  it has such a concept). Resolved from the adapter by the caller. */
export interface PersonaPaths {
  skillDir: string;
  agentDir: string | null;
}

export function buildPersonaAwareness(
  f: Fields,
  repo: { name: string; path: string },
  ctx: PersonaContext,
  paths?: PersonaPaths,
): string {
  const roster =
    ctx.personas.length > 0
      ? ctx.personas.map((p) => `${sanitize(String(p.name))} (${sanitize(String(p.role))})`).join(", ")
      : "no persona has been hired for this repo yet";
  const peClause = f.pe ? ` You work for ${f.pe}.` : "";
  const relations =
    ctx.edges.length > 0 ? ctx.edges.map(edgeLine).join("\n") : "No known relations for this repo.";

  return (
    `This session opened directly inside the ${sanitize(repo.name)} repo, part of the ${f.contextName} context.${peClause} ` +
    `Personas hired for this repo: ${roster}. ${personaFileHint(paths)}` +
    `Known relations for ${sanitize(repo.name)}:\n${relations}`
  );
}

export function renderSessionContext(
  f: Fields,
  personaCtx?: PersonaContext,
  paths?: PersonaPaths,
  stateBlock?: string,
): string {
  const base =
    f.repoAtCwd && personaCtx ? buildPersonaAwareness(f, f.repoAtCwd, personaCtx, paths) : buildAwareness(f);
  // The item-8 STATE block is appended only to the coordinator awareness (never
  // the in-repo persona context), and only when the caller could assemble it.
  const additionalContext = stateBlock && !(f.repoAtCwd && personaCtx) ? `${base}\n\n${stateBlock}` : base;
  return JSON.stringify(
    {
      hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext,
      },
    },
    null,
    2,
  );
}
