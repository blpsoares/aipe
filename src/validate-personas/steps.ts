// The manual, live-session validation protocol. This is the ONE thing the
// preflight cannot do headless (spec §1): observe whether a persona identity
// survives a third-party skill in a real interactive session. Emitted by the
// CLI and quoted verbatim in the dossier so the PE runs exactly this.
export function liveValidationSteps(): string {
  return [
    "── Manual load-order validation (requires a live interactive session) ──",
    "",
    "The static preconditions above are green. The remaining check can only be",
    "done by a human in a real Claude Code session — it is NOT run by this tool.",
    "",
    "1. Open a Claude Code session with a persona's repo as the working dir, e.g.:",
    "     cd <workspace>/<repo> && claude",
    "   (the persona SKILL.md lives at .claude/skills/<slug>/ and auto-loads).",
    "",
    "2. Confirm the persona loaded: ask the assistant \"who are you and what",
    "   repo are you specialized in?\" — it should answer as the persona",
    "   (name + repo/module), not as a generic assistant.",
    "",
    "3. Invoke a third-party skill on top, e.g.:",
    "     /superpowers:brainstorming  (or any installed skill)",
    "   on a trivial prompt (\"let's brainstorm a tiny CLI\").",
    "",
    "4. OBSERVE — the thing to record:",
    "   - Does the persona's identity remain referenced during and AFTER the",
    "     third-party skill runs? (expected: yes — persona survives)",
    "   - Does anything in the third-party skill overwrite the persona framing?",
    "     (expected: no)",
    "",
    "Expected result: the persona identity survives; the third-party skill layers",
    "ON TOP of it rather than replacing it. Record what you actually observe",
    "(survived / overridden / partial) in docs/dossie/09-persona-load-order.md.",
  ].join("\n");
}
