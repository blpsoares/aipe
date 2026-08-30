# What is not supported, and why

A system that runs autonomous agents non-interactively has to be honest about
where it stops. The most important boundary is which harnesses can be dispatched
in **session mode** — and the answer is *not* "the ones we have adapters for."
Some harnesses have full, working adapters and are still refused for session
dispatch, on purpose. This is the argument for that refusal, and the degraded path
that remains when it applies.

## The eligibility rule

Session-mode dispatch is non-interactive **by construction**: the coordinator
opens a detached session and walks away. Governing that session means blocking a
dangerous command *before it runs*, with a hook that is **trusted without a human
present**. So the rule is one line: a harness whose adapter cannot produce such a
hook is not session-eligible. In code it is exactly
`containmentHook() !== null` (`src/harness/types.ts:155`); a `null` hook means the
harness cannot be contained, and *AIPe never starts a session it cannot govern.*

There is a second, independent path to the same "no": a harness `agentop` has no
name for cannot be addressed as a session at all (`agentopHarness: null`,
`src/harness/types.ts:61`). Either fact alone is disqualifying.

## The two adapter-backed refusals — for genuinely different reasons

Of the harnesses with a live adapter, `codex` and `copilot` are both
non-containable, and the difference between *why* is the whole point — a single
"unsupported" label would hide it.

**Codex: the hook is written but never trusted.** The codex adapter really does
write a well-formed pre-tool hook to disk (`src/harness/codex.ts:178`). It is
inert anyway. Codex only loads a project's non-managed hook after a human
interactively **trusts** it through its `/hooks` command — trust is per-hash, and
there is no config-file way to self-declare it. A non-interactive dispatch can
never clear that gate, so `containmentHook()` returns `null` *deliberately*
(`src/harness/codex.ts:210`): a hook present on disk that blocks nothing is
*silently wrong*, and silently wrong is worse than plainly ineligible. Writing the
hook, then reporting `null`, is the adapter refusing to let `isContainable` lie.

**Copilot: the worktree is always new.** A different mechanism reaches the same
verdict. Copilot's CLI asks the user to confirm trust for any directory it has not
seen before, and that confirmation is **default-on**. A dispatched worktree is, by
construction, new — absent from the CLI's trust record — so it always hits that
prompt (`src/harness/copilot.ts:44`). The global `trustedFolders` escape would
outlive the worktree and its effect on hook-loading is unconfirmed, so the adapter
returns `null` rather than gamble on it.

**Why the difference matters.** Codex's block is about *trust of a specific hook*;
Copilot's is about *trust of the directory the hook lives in*. Gemini proves the
distinction is real and not vendor prejudice: Gemini's folder trust is **disabled
by default**, so a fresh worktree is unaffected and Gemini *is* containable
(`src/harness/gemini.ts:82`). The adapter's own comment states the mirror: had
Gemini's trust been default-on, its answer would flip to Copilot's. The rule keys
on a mechanism — *can a hook be trusted with no human present* — not on a brand.

## Beyond the four adapters: the containment ledger — three states, not two

The four adapters answer the binary *runtime* question — contained or not — for
the harnesses AIPe actually dispatches. But "does a reliable non-interactive hook
exist *at all*?" is a wider question, and the product had been flattening it: "no
adapter yet" and "cannot be contained without a human" both surfaced as one
undifferentiated *"coming soon"* — the misleading signal the PE flagged for
Antigravity. `src/harness/compat.ts` records the answer in **three** states, not
two, over the ten harnesses `agentop` can host:

- **containable-proven** — a hook blocks with no human present, proven against the
  tool's own docs: `claude-code`, `gemini`, `factory-droid`, `kimi-code`,
  `opencode`, `pi`.
- **non-containable-proven** — the mechanism needs a human, or does not exist,
  proven against the tool's own docs: `codex`, `copilot`, `cursor`. Cursor is the
  refused case with no adapter: its deny hook is real, but project hooks load only
  in a *trusted workspace* and user-level hooks are unavailable to cloud agents —
  a human trust step a fresh worktree does not clear.
- **unestablished** — nobody has verified, or the docs do not answer. Today its
  only member is `antigravity`: its docs show a config-file `deny` hard-block with
  no documented trust gate — a genuine adapter candidate — but do not confirm the
  hooks file loads under an unattended headless run. It is *not* proven refused; it
  is honestly open. This is the state the old two-way vocabulary could not express,
  and the direct answer to the Antigravity flag.

This ledger is **data the rest of AIPe reads, not a change to dispatch**: it does
not widen the four-id dispatch union or alter the eligibility rule. The four
adapter-backed rows are locked to `isContainable(getAdapter(id))` by
`src/harness/__tests__/compat.test.ts`, so the ledger cannot drift from code and
code cannot silently drift from the ledger. Every *proven* line cites a primary
source (the tool's own documentation) with the date it was read. Membership is
data and moves as harnesses are investigated (`harnessesInState`), so this list is
today's reading of `src/harness/compat.ts`, not a fixed count — read the module
for the current partition rather than trusting a line number here.

## The gate runs where sessions actually start

`aipe dispatch validate` is only advisory, and `--harness` on a ledger record is
unvalidated — so a unit can *name* a non-containable harness. The binding refusal
is therefore re-run on the path that actually opens a session: a codex or copilot
unit is refused with a non-zero exit **before any hook is written or any session
runs** (`src/session/cli.ts:466`). Eligibility is checked twice on purpose,
because the advisory check is not the one that starts processes.

## The degraded path: the generic, file-based adapter

When no native adapter fits — any harness that merely reads an `AGENTS.md`-style
file — the generic adapter is the additive fallback. It is honest about being
degraded:

- It **cannot** block-before-execute, so it is never session-eligible; it is the
  one adapter whose `agentopHarness` is also `null` (`src/harness/generic.ts:32`).
  Both facts point the same way.
- Awareness reaches the session as a **static file**, not a live hook — a snapshot
  written once, not recomputed each session. If the coordinator's context changes,
  a generic harness will not see it until the file is rewritten.
- Personas are plain markdown with no auto-load frontmatter, and there is no
  dispatchable agent-type — only Claude Code models that.

**When to use it:** to *install content* into a harness AIPe has no native adapter
for — never to *contain a session*. It is a working demonstrator of the adapter
seam, and its end-to-end behaviour inside a real non-Claude harness has not been
validated in a live session. Use it knowing that.

## Other honest limits

- **Subagent grants cannot yet take effect.** `aipe session grant` writes a quota,
  but consuming it needs `AGENTOP_SESSION_ID` in the specialist's environment, and
  `agentop` does not stamp that yet. The CLI issues the grant and says so plainly;
  a successful `OK` does not mean the specialist is now authorized (see
  `skills/operate/SKILL.md`).
- **The cost index is not a budget.** It is a coarse relative proxy (mode × tier ×
  intensity), not token or dollar metering — see `execution-envelope.md`.
- **The managed overlap exception is unproven in the field.** The
  wait → rebase → resolve → review-over-merge recovery exists in code and tests but
  was not observed racing in the recorded scenario (`walkthrough.md`).

---

**What breaks if you ignore this.** The containment rule is the safety property
of the whole session-dispatch system; making a non-containable harness
session-eligible "to be helpful" is precisely the hole the double-checked gate
exists to close. And the generic adapter's honesty — reporting `null`, shipping a
static snapshot — is not a limitation to paper over; it is the adapter refusing to
look installed while doing nothing. Extended reference for the seam:
`docs/harnesses.md`; build-time record: `docs/dossie/11-harness-adapters.md`.
