// Composes what a dispatched session is told. A detached session gets no second
// question from the PE, so this text is its entire world: identity, scope, and
// the contract that replaces a subagent's return value.
import type { Intensity } from "./types";

export interface PromptInput {
  personaBody: string;
  specSlice: string;
  worktree: string;
  packagePath: string | null;
  branch: string;
  repo: string;
  journeyId: string;
  workspace: string;
  fqid: string;
  intensity: Intensity;
}

export function composePrompt(input: PromptInput): string {
  const lane = input.packagePath
    ? `${input.worktree} — and within it, stay inside ${input.packagePath}`
    : input.worktree;

  const parts: string[] = [];

  if (input.intensity === "ultracode") {
    // The opt-in is a keyword in the prompt; there is no CLI flag for it.
    parts.push("ultracode");
  }

  parts.push(input.personaBody.trim());
  parts.push(`# Your assignment (${input.fqid})\n\n${input.specSlice.trim()}`);

  // Every step below is phrased as an outcome or as an `aipe` subcommand, never
  // as a slash command — a Codex or Gemini session has no `/verify-before-done`.
  parts.push(
    [
      "# How you must work",
      "",
      `- Operate strictly inside ${lane}. Never touch anything outside it.`,
      "- Check `aipe skill match --task-type <type> --size <size>` first; if an SDD kit matches, derive a short package spec + plan and commit it alongside the code.",
      "- Work test-first.",
      "- Verify before claiming done, and gather the evidence: the commands you ran and what their output showed.",
      `- Push \`${input.branch}\` and open a PR.`,
      "",
      "# How you report back",
      "",
      "You are a detached session: nothing you return is read by anyone. The journey ledger is the only channel. Before you stop, record your result:",
      "",
      "```bash",
      `aipe journey record --journey ${input.journeyId} --workspace ${input.workspace} \\`,
      `  --repo ${input.repo} --specialist <you> --branch ${input.branch} --worktree ${input.worktree} \\`,
      "  --status <delivered|escalated> --pr <url> \\",
      '  --evidence-cmd "<command you ran>" --evidence-summary "<what its output showed>"',
      "```",
      "",
      "A `delivered` without evidence is REJECTed by the ledger — that is deliberate. If the assignment is not answerable as written, record `--status escalated` with the reason instead of guessing.",
      "",
      "# Your relationship to agentop",
      "",
      "You are a specialist (`AIPE_ROLE=specialist`). You **must not open** a new agentop session, and you must not kill any session — that authority belongs to the coordinator alone, and a hook enforces it.",
      "You may read: `agentop session list`, `attach`, `note`, `rename` — including to orient yourself about the sibling sessions filed under this journey's task.",
    ].join("\n"),
  );

  return `${parts.join("\n\n---\n\n")}\n`;
}
