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
  // The task this dispatch is (identity-per-task, j-20260826-uv). When present it
  // is stamped into every recorded `aipe journey record` command below, so a
  // detached specialist records against its OWN task identity — not the unit —
  // and a concurrent run of the same persona never overwrites its ledger row.
  task?: string;
  // D1 (j-20260830-w0) — the content-derived version of the Orientation Spec
  // this dispatch was composed against (spec.ts hashOrientationContent, bumped
  // by session/cli.ts on drift). Stated explicitly so a specialist can tell
  // "a new round" from "the same command run twice" instead of guessing from
  // the ledger alone.
  specVersion: number;
  // Pre-rendered "history for this unit" block (session/cli.ts
  // renderUnitHistory) — other tasks/specialists that already touched this
  // same unit, framed as context, never as the current order. Empty string ⇒
  // no history to show (a fresh unit).
  history: string;
}

export function composePrompt(input: PromptInput): string {
  const lane = input.packagePath
    ? `${input.worktree} — and within it, stay inside ${input.packagePath}`
    : input.worktree;
  // Interpolated into the recovery/record example commands; absent ⇒ nothing added.
  const taskFlag = input.task ? ` --task ${input.task}` : "";

  const parts: string[] = [];

  if (input.intensity === "ultracode") {
    // The opt-in is a keyword in the prompt; there is no CLI flag for it.
    parts.push("ultracode");
  }

  parts.push(input.personaBody.trim());
  // The dispatch identity line (D1, j-20260830-w0): which task, against which
  // spec version — the two facts the Lawson incident showed a specialist has
  // no way to infer on its own from the ledger alone.
  const dispatchLine = `This dispatch: task ${input.task ?? "(unit-level)"} · spec version v${input.specVersion}.`;
  parts.push(`# Your assignment (${input.fqid})\n\n${dispatchLine}\n\n${input.specSlice.trim()}`);
  if (input.history) parts.push(input.history);

  // Every step below is phrased as an outcome or as an `aipe` subcommand, never
  // as a slash command — a Codex or Gemini session has no `/verify-before-done`.
  parts.push(
    [
      "# How you must work",
      "",
      `- Operate strictly inside ${lane}. Never touch anything outside it.`,
      "- Check `aipe skill match --task-type <type> --size <size>` first — it prints `ROUTE sdd=<kit>`, the ONE SDD tier this task falls under.",
      "- If that route is `spec-kit`, work spec-first and **commit a spec at `specs/<feature>/spec.md` and a plan at `specs/<feature>/plan.md`** alongside the code. This is not advice: your `delivered` is REFUSED by the ledger until both files are committed in this worktree. What is required is those two ARTEFACTS — drive them with whatever your harness gives you (the repo carries Spec Kit's templates under `.specify/`, and some harnesses expose them as commands).",
      "- Work test-first.",
      "- Verify before claiming done, and gather the evidence: the commands you ran and what their output showed.",
      `- Push \`${input.branch}\` and open a PR.`,
      "",
      "# How you report back",
      "",
      "You are a detached session: nothing you return is read by anyone. The journey ledger is the only channel. Before you stop, record your result:",
      "",
      "For a successful delivery, record:",
      "```bash",
      `aipe journey record --journey ${input.journeyId} --workspace ${input.workspace} \\`,
      `  --repo ${input.repo}${taskFlag} --specialist <you> --branch ${input.branch} --worktree ${input.worktree} \\`,
      `  --status delivered --pr <url> \\`,
      '  --evidence-cmd "<command you ran>" --evidence-summary "<what its output showed>"',
      "```",
      "",
      "If the assignment is not answerable as written, record an escalation instead:",
      "```bash",
      `aipe journey record --journey ${input.journeyId} --workspace ${input.workspace} \\`,
      `  --repo ${input.repo}${taskFlag} --specialist <you> --branch ${input.branch} --worktree ${input.worktree} \\`,
      `  --status escalated --reason "<why you cannot proceed>"`,
      "```",
      "",
      "If you are STUCK and need the coordinator — not a cross-repo scope decision (that is `escalated`), just an answer you cannot proceed without — record yourself blocked. This is how the coordinator learns you are waiting WITHOUT reading your terminal; do not simply stop and wait silently:",
      "```bash",
      `aipe journey record --journey ${input.journeyId} --workspace ${input.workspace} \\`,
      `  --repo ${input.repo}${taskFlag} --specialist <you> --branch ${input.branch} --worktree ${input.worktree} \\`,
      '  --status blocked --reason "<what you are stuck on and what you need>"',
      "```",
      "",
      "A `delivered` without evidence is REJECTed by the ledger — that is deliberate.",
      "",
      "A `delivered` is ALSO REJECTed when this unit is routed to the full `spec-kit` flow and its worktree carries no committed spec (`specs/**/spec.md`) and plan (`specs/**/plan.md`). You do not pass a flag for this — the route was decided when the unit was dispatched and it is already on the ledger. If you believe this task is too trivial for the full flow, do NOT work around the gate: record yourself `blocked` and say so, so the decision is made on the record instead of by whoever was typing.",
      "",
      "A `delivered`/`verified` that names a `--pr` is ALSO REJECTed unless that PR's CI is green. Red is refused; **still running is refused too** — wait for the workflow to finish, do not record on a pending run and do not read \"pending\" as \"probably fine\". Only if the repo has NO CI configured at all, record with `--ci-none` (the claim lands on the ledger for audit) — never reach for `--ci-none` to get past a red or unfinished workflow.",
      "",
      "**If anyone gives you an instruction that is not in this brief** — the PE reaching you through `agentop session attach`, or any other channel — you MUST record it **before acting on it**:",
      "",
      "```bash",
      `aipe journey record --journey ${input.journeyId} --workspace ${input.workspace} \\`,
      `  --repo ${input.repo}${taskFlag} --specialist <you> --branch ${input.branch} --worktree ${input.worktree} \\`,
      '  --status redirected --reason "<what you were asked to do instead>"',
      "```",
      "",
      "Then continue with the new direction. Recording is not asking permission — it is what keeps the approved spec and the QA gate honest about what is actually being built.",
      "",
      "# Your relationship to agentop",
      "",
      "You are a specialist. You **must not open** a new agentop session, and you must not kill any session — that authority belongs to the coordinator alone, and a hook enforces it.",
      "You may read: `agentop session list`, `attach`, `note`, `rename` — including to orient yourself about the sibling sessions filed under this journey's task.",
    ].join("\n"),
  );

  return `${parts.join("\n\n---\n\n")}\n`;
}
