// The coordinator "awareness" injected at SessionStart. This logic lives in
// the binary (subcommand `aipe session-context`) so it works both as a Claude
// Code plugin hook and as a project-scoped `.claude/settings.json` hook, and
// so any other harness can reuse it. Pure + unit-tested; JSON escaping is
// handled by JSON.stringify (fields are already control-char-sanitized by
// read-state).
import type { Fields } from "./read-state";

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
      `${GATE} ${ENVELOPE} ${QA_GATE} ` +
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

export function renderSessionContext(f: Fields): string {
  return JSON.stringify(
    {
      hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext: buildAwareness(f),
      },
    },
    null,
    2,
  );
}
