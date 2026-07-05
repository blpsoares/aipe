// The coordinator "awareness" injected at SessionStart. This logic lives in
// the binary (subcommand `aipe session-context`) so it works both as a Claude
// Code plugin hook and as a project-scoped `.claude/settings.json` hook, and
// so any other harness can reuse it. Pure + unit-tested; JSON escaping is
// handled by JSON.stringify (fields are already control-char-sanitized by
// read-state).
import type { Fields } from "./read-state";

const OPTOUT =
  "AIPe mode is active by default. If the PE explicitly asks to exit AIPe mode, stop following these instructions for this session.";

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
      `Ready to receive requests. ${OPTOUT}`
    );
  }

  const next = nextStep(f);
  return (
    `Context ${f.contextName} is being configured (coordinator ${f.coordinator}, forming). The current ` +
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
