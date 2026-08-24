# Dossier 15 — Session-mode dispatch (`aipe session` via `agentop`)

**Status:** Built.
**Spec:** [`2026-08-14-agentop-session-dispatch-design.md`](../superpowers/specs/2026-08-14-agentop-session-dispatch-design.md).

## What this is for

A specialist is normally dispatched as an **in-process subagent**: the
coordinator reads the persona body, starts a subagent with the hiring brief,
and gets `{ status, pr, evidence }` back synchronously. That subagent shares
the coordinator's own context window and its lifetime — its work is lost if
the coordinator's session dies, and it cannot run under `ultracode` (a
session-level opt-in a subagent has no way to carry).

`aipe session dispatch` starts a specialist instead as a real, **detached**
`agentop` session (agentistics project, `agentop session batch`) — tmux-backed,
with its own full context window, grouped under the journey's task. It is a
**second route alongside subagent dispatch, not a replacement for it**:
subagent stays the default because it is synchronous, cheaper, and returns
evidence directly. Reach for session
mode when a unit is heavy or long enough that sharing the coordinator's
context would starve it, or when it genuinely needs `ultracode`.

Choosing `mode: session` (and every other axis — `intensity`, `harness`,
`tier`) is not the coordinator's call to make alone: it goes through the same
Orientation Spec approval gate as everything else (see dossier 14, which
prices the choice before the PE signs off on it).

## Eligible harnesses — and why only two, today

The eligibility rule is exact: **a harness is eligible for `mode: session`
if and only if its `HarnessAdapter` implements containment**
(`isContainable`, `src/harness/types.ts`) — AIPe never starts a session it
cannot govern. As shipped, only two adapters return a real
`containmentHook()`:

| Harness | Containable? | Why |
|---|---|---|
| `claude-code` | Yes | `PreToolUse` hook in `.claude/settings.json`. |
| `gemini` | Yes | `BeforeTool` hook in `.gemini/settings.json`. |
| `codex` | **No** | Codex requires a human to interactively review and trust each non-managed hook via its own `/hooks` command — there is no config-file way to self-declare that trust, and AIPe's session dispatch is fully unattended (it provisions the worktree and starts the session with nobody present to ever run `/hooks`). A hook written to disk is present, well-formed, and never trusted. `codexAdapter.containmentHook()` returns `null`. |
| `copilot` | **No** | Copilot CLI gates on a default-on directory-trust prompt for any folder it has not seen before — which a freshly created worktree always is — and GitHub's own docs do not confirm that repository-level hooks are exempt from it, or that the prompt is safely skippable under AIPe's non-interactive invocation. `copilotAdapter.containmentHook()` returns `null` until an official doc confirms either a safe headless path or a workspace-scoped way to pre-declare trust. |
| `antigravity`, `kimi` | Not applicable | Not registered as adapters at all; their blocking mechanisms were never verified. |

`aipe dispatch validate` rejects a session-mode unit on a non-containable
harness with `harness-not-containable <id>`, and `aipe session dispatch`
re-checks the same authority before ever starting anything (never trusting
that the earlier, advisory-only `validate` call actually ran).

A unit's `harness` (session-mode target) is independent from the
**workspace's** own harness (chosen once, at `aipe start`) — a claude-code
workspace can still dispatch a QA unit to `gemini`, as long as the `gemini`
binary is present (`aipe capabilities probe`, dossier 14). This is real
independence for a QA specialist: a different model reviewing the dev's work
rather than a second persona sharing the first one's blind spots.

## How containment works

Every containable harness's adapter renders the **same** guard command,
`aipe session guard`, into its own hook format — `PreToolUse` for Claude
Code, `BeforeTool` for Gemini — written into **the dispatched unit's own
worktree** (`<repo>/.worktrees/<journey>-<slug>/`), never into the PE's own
workspace or the coordinator's own session. `aipe session dispatch` installs
every unit's hook before starting any session in the wave — if one unit's
hook fails to install, the whole wave is refused rather than starting some
units uncontained.

The decision (`decide()`, `src/session/guard.ts`) is a single pure function,
identical across every harness:

| Command shape | Decision |
|---|---|
| Role is not `specialist` (the coordinator itself) | allow |
| `agentop session kill …` | **deny**, unconditionally — nothing in a specialist's job ever requires killing a session, including a sibling's |
| `agentop session list/attach/note/rename` | allow — a specialist may still orient itself among sibling sessions filed under the same journey |
| `agentop session <harness>` / `agentop session batch` (opening a new session) | **deny, unless a grant is available** (see below) |

The guard fails **open** on anything it cannot parse (a payload it can't
read) — a guardrail that breaks real work is worse than the drift it
prevents — but the spawn/kill table above is deliberately conservative about
matching: it looks for the token sequence `agentop session …` anywhere in
the command text, not just in command position, because shell syntax
repeatedly defeated attempts to be cleverer about it.

## `aipe session grant` — and its current limitation

`aipe session grant --journey <id> --session-id <id> --count <n>` issues a
one-time quota of session spawns to a specific `(journey, session)` pair —
the coordinator's deliberate escape valve for the rare case a sub-session is
genuinely required. Grants are single-use tokens on disk
(`.aipe/journeys/<id>/grants/<sessionId>/token-N`, claimed by atomic file
creation), so a grant of 1 cannot silently become unbounded spawning.

**This quota cannot take effect yet.** Consuming a grant requires the guard
to know *which* session is asking — that identity has to come from
`AGENTOP_SESSION_ID` in the specialist's own environment — but `agentop`
does not stamp that variable into the sessions it starts today. `aipe
session grant` still writes the quota (exit 0), but prints:

```
NOTE grant: cannot take effect yet — agentop does not stamp AGENTOP_SESSION_ID
into the specialist's environment, so this quota cannot be consumed until
that lands. Do not treat this OK as the specialist being authorised.
```

Treat a successful `grant` as "recorded", never as "the specialist can now
open a session" — it cannot, yet, regardless of what was issued.

## Commands

- **`aipe session dispatch --journey <id> [--workspace <dir>]`** — for every
  ledger unit marked `mode: session`, `status: dispatched` with no
  `sessionId` yet: reads the approved `orientation.md`, slices out that
  unit's section, composes a prompt (persona body + spec slice + the return
  contract below), installs the containment hook into the unit's worktree,
  and starts the whole wave with one `agentop session batch --task
  aipe/<journey>`. Prompt files are written to
  `.aipe/journeys/<id>/prompts/<fqid>.md` and **kept** as the audit trail of
  exactly what each specialist was told. Refuses outright (nothing is
  started) if `agentop` is absent/below `1.9.0`, if `orientation.md` is
  missing or empty, or if any resolved unit's harness turns out
  non-containable.
- **`aipe session collect --journey <id> [--timeout <s>] [--workspace <dir>]`**
  — the coordinator's active wait on a dispatched wave. Polls
  `agentop session list --json` cross-referenced against the ledger until
  every unit settles or the timeout passes, and classifies each one:
  - `landed` — a record with evidence exists.
  - `running` — session still alive past the timeout; the **PE** decides
    whether to wait or `agentop session kill` — the coordinator never kills
    a session itself.
  - `dead-silent` — the session ended without recording anything. The
    coordinator inspects the branch read-only (`git log`) and either
    re-dispatches with a brief that says "continue from what is on the
    branch", or escalates — **never a blind re-dispatch**.
  - `redirected` — the PE talked to the specialist directly via `agentop
    session attach` and changed its direction; the specialist recorded that
    (see the return contract) before acting on it. The coordinator must fold
    the change into the Orientation Spec or escalate — a redirected unit
    must never pass the QA gate against an unreconciled spec.
- **`aipe session doctor`** — reports whether `agentop` is installed and
  meets the minimum version (`1.9.0` — the first release verified to carry
  `session batch`/`list` with `--json`). Prints install instructions
  otherwise — either `curl -fsSL https://agentop.openvibes.tech/cli | bash`
  or `npm i -g @agentistics/agentop` (a thin wrapper that fetches the same
  binary; Linux x86_64 only, today) — and is explicit that the npm package
  literally named `agentop` (unscoped) is an unrelated project (a `top`-like
  dashboard) — installing it would put the wrong binary on `PATH`.
- **`aipe session guard [--role <role>]`** — internal: the command every
  containment hook actually invokes. Reads the harness's hook payload on
  stdin, prints the decision in whichever JSON shape that harness expects.
  Not something a PE runs directly.

## The return contract

A detached session has no return value — nothing it prints is read by
anyone. The prompt `aipe session dispatch` composes ends with the contract
that replaces a subagent's return: operate strictly inside the worktree
(within the package path, for a monorepo unit); work spec-driven, then
test-first; verify before claiming done and gather evidence; push the branch
and open a PR; **then record the result in the ledger** —
`aipe journey record --status delivered --pr <url> --evidence-cmd … `
— and only then stop. If the assignment cannot be answered as written, it
records `--status escalated` instead. If anyone gives it an instruction
outside its brief, it records `--status redirected --reason "…"` **before**
acting on it. Every instruction is phrased as an outcome or an `aipe`
subcommand — never a Claude-Code-only construct like a slash command — so
the same contract is honest for a Gemini session too.

## Ledger fields this subsystem adds

Per unit, on `JourneyDispatch` (`src/journey/types.ts`): `mode`
(`"subagent" | "session"`, default subagent), `intensity`
(`"normal" | "ultracode"`), `harness` (adapter id), `sessionId` (agentop's
session id, once started), and `redirectReason` (required whenever a
`redirected` status is recorded). All are optional and absent on legacy
ledgers, which continue to parse unchanged.

## Left open (documented)

- Codex/Copilot session-mode containment — blocked on each CLI shipping a
  documented non-interactive trust path (see the table above).
- `aipe session grant` redemption — blocked on `agentop` stamping
  `AGENTOP_SESSION_ID` into the session environment.
- Running a specialist session at the repo root instead of its worktree —
  deliberately out of scope; the worktree is what makes same-repo
  parallelism, the QA gate, and `aipe dispatch claim`'s physical lock
  meaningful at all.
- A dedicated supervisor session per journey — the coordinator waits
  actively instead (`aipe session collect`), so the PE's own session stays
  occupied during a wave.
