# Session-mode dispatch via agentop — design

**Status:** Approved, ready for planning.
**Origin:** brainstorming session, 2026-08-14.

## Purpose

Today a specialist is always dispatched as an **in-process subagent**: the
coordinator reads the persona body, starts a subagent with the hiring brief,
and receives `{ status, pr, evidence }` back synchronously. That subagent
lives inside the coordinator's session — it shares the session's lifetime, and
its work is lost if the coordinator dies.

`agentop` (v1.9.0+, from the agentistics project) can start **real, detached
assistant sessions**, tmux-backed, grouped under a task:

```
agentop session batch --task "<name>" [--cwd <path>] [--model <id>] [--effort <lvl>] \
                      --session "<harness>[@<cwd>]: <prompt>" [--session "..."] [--json]
agentop session list --json | open "<task>" | attach | kill | note
```

That maps almost 1:1 onto an AIPe dispatch wave: `--task` is the journey, each
`--session` is a unit, and `@<cwd>` is the worktree `aipe worktree create`
already provisions. Dispatching this way gives each specialist its **own full
context window** — and lets a unit run under `ultracode`, which is a
session-level opt-in that a subagent cannot carry.

This spec adds session-mode dispatch as a **second route** alongside the
existing subagent route, without changing worktrees, the dispatch law, the
journey ledger, or the QA gate.

### Non-goal

Replacing subagent dispatch. Subagent stays the default: it is synchronous,
cheaper, and returns evidence directly. Session mode is for heavy or long
units where a dedicated context window (and possibly `ultracode`) earns its
cost.

## Dependency: agentop is a soft dependency

`agentop` **cannot** be a `package.json` dependency. Two facts:

- The installed tool is a native ELF binary at `~/.local/bin/agentop`, part of
  the agentistics project — not published to npm.
- The npm package named `agentop` is an **unrelated project**
  (`ktamas77/agentop`, v0.5.8, a `top`-like dashboard for agent sessions).
  Depending on it would install the wrong software.

So agentop enters as a **soft dependency with a preflight**:

- `src/session/probe()` returns `{ present, version, ok }` against a minimum
  version, shelling out to `agentop --version`.
- `aipe doctor` (and the `make-workspace` preflight) reports it and prints
  install instructions when missing or stale.
- Without agentop, AIPe operates exactly as it does today. Only `mode: session`
  becomes unavailable, with an explicit message — nothing silently degrades.

## Architecture

Three new pieces, each with one purpose.

### `src/session/` — the agentop wrapper

The **only** part of AIPe that knows agentop exists. Rationale: the repo's
stated invariant is that everything past raw agent output on disk is a
deterministic, tested `aipe` subcommand. Composing
`--session "claude@/path: <40-line brief>"` by model judgement in a shell
string is a quoting bug waiting to happen; behind a subcommand the brief goes
by file and the shell never sees its content.

Surface:

- `probe(): Promise<{ present: boolean; version: string | null; ok: boolean }>` —
  **1.9.0** is the version verified to carry `session batch`/`open`/`list`
  with `--json`, but the effective minimum is the first release that stamps
  `AGENTOP_SESSION_ID` (see "The one change agentop needs"), since containment
  depends on it.
- `dispatch(journey, units, opts): Promise<SessionId[]>` — composes one prompt
  file per unit, runs a single `agentop session batch --task aipe/<journey>
  --json`, returns the started ids.
- `poll(journey): Promise<UnitState[]>` — cross-references
  `agentop session list --json` with the journey ledger.

agentop is invoked through an **injectable runner**, so tests never execute the
binary.

New CLI subcommands (registered under a `session` command in `src/cli.ts`):

- `aipe session dispatch --journey <id> --workspace <dir>`
- `aipe session collect --journey <id> --workspace <dir> [--timeout <s>]`
- `aipe session guard` — called by the PreToolUse hook, reads the hook payload
  on stdin, prints the decision.

### `src/dispatch/` — a `mode` axis on the batch

`DispatchEntry` (`src/dispatch/types.ts`) gains:

```ts
mode?: "subagent" | "session";   // default: "subagent"
intensity?: "normal" | "ultracode";  // default: "normal"
```

`validateBatch` (`src/dispatch/law.ts`) keeps its existing role — concurrency
cap, same-package serialization, known-specialist check — and gains two
rejections:

- `agentop-unavailable` when any entry is `mode: "session"` and `probe()` fails.
- `session-cap-exceeded` when session-mode entries exceed their own cap.
- `harness-not-containable` when a session-mode entry targets a harness whose
  adapter does not implement containment (see below).

`DispatchEntry` also gains an optional `harness?: string` (default: the
workspace harness), so a QA unit can be pointed at a different model from the
dev unit it reviews.

**On the cap:** `MAX_CONCURRENT = 16` (`src/dispatch/types.ts:16`) was
calibrated for subagents. Sixteen real Claude sessions — each with its own
context window, some running `ultracode` and fanning out Workflow agents — is a
different order of cost. Session mode gets its own cap of **4** concurrent
sessions per wave, adjudicated by the same `validateBatch`. The subagent cap
stays at 16; a mixed wave is checked against both.

### Containment: a property of the harness adapter

Blocking a command before it runs is **not** a Claude Code exclusive. Verified
mechanisms across the harnesses agentop can start:

| Harness | Mechanism | Decision shape |
| --- | --- | --- |
| Harness | Mechanism | Config location | Decision shape |
| --- | --- | --- | --- |
| Claude Code | `PreToolUse`, matcher `Bash`, external command | `.claude/settings.json` | `permissionDecision: "deny"` |
| Codex CLI | `PreToolUse`, matcher `Bash`, external command; **on by default** | `~/.codex/hooks.json` or `config.toml` | `hookSpecificOutput.permissionDecision: "deny"`, or exit 2 + stderr |
| Gemini CLI | `BeforeTool` hook, regex matcher, `type: command`; plus a policy engine with `commandPrefix`/`commandRegex` deny as a static second layer | `.gemini/settings.json` | JSON on stdout — and nothing else on stdout |
| Copilot CLI | `preToolUse` hook, plus the `--deny-tool 'shell(...)'` flag | `.github/hooks/` (repo) or `~/.copilot/settings.json` | `permissionDecision: "deny"` / `behavior: "deny"` |
| antigravity, kimi | **not verified** | — | — |

Codex's is near-identical to Claude Code's; Gemini and Copilot differ in event
name and output shape but do the same job. So the cost is not "does a
mechanism exist" — it is four config files, four event names, three output
shapes to write and keep working.

That is exactly the cost `HarnessAdapter` (`src/harness/types.ts`) already
exists to absorb: it is the abstraction that answers "where does the persona
go, what is the MCP config path" per harness. So:

**`HarnessAdapter` gains `containmentHook()`**, and `installIntegration` writes
it in that harness's own format. Every one of them invokes the same
`aipe session guard`; only the wrapper differs. The "is this a session spawn?"
question stays a single pure, tested function — never a regex loose in a shell
script, and never duplicated per harness.

**Eligibility rule** — this replaces the earlier "claude only" restriction:

> A harness is eligible for `mode: session` **if and only if** its adapter
> implements containment.

Claude Code, Codex, Gemini and Copilot qualify, and **all four adapters are in
scope**. `antigravity` and `kimi` do not, until someone verifies their mechanism
and implements the adapter method — `validateBatch` rejects them with
`harness-not-containable`.

This unlocks the thing that was actually worth having: a QA specialist running
on a **different model** from the dev that wrote the code, which is real
independence rather than a second persona sharing the first one's blind spots.

Verified per-harness conventions the three new adapters target:

| Harness | Personas / skills | Always-on context | MCP config |
| --- | --- | --- | --- |
| Codex CLI | `.codex/skills/<slug>/SKILL.md` | `AGENTS.md` | `config.toml` |
| Gemini CLI | `.gemini/commands/*.toml` | `GEMINI.md` | `.gemini/mcp/servers.json` |
| Copilot CLI | `.github/agents/<slug>.agent.md` | `AGENTS.md` | `~/.copilot/settings.json` |

These are the starting points, not gospel: each adapter's implementation begins
by re-verifying them against current docs, because these CLIs move fast and a
persona written to a path the harness does not read is a specialist that never
receives its brief.

Rules the guard applies, identically on every harness:

| Condition | Decision |
| --- | --- |
| `AIPE_ROLE` is not `specialist` | allow (the coordinator passes through) |
| specialist, `agentop session <harness>` or `session batch` | **deny**, unless a grant is available |
| specialist, `agentop session kill` | **deny** — nothing in a specialist's job requires killing a session, and a specialist must never be able to kill a sibling's |
| specialist, `agentop session list/attach/rename/note` | allow |

The escape valve is `AIPE_SESSION_GRANT=<n>`, injected into the session
environment by the coordinator at dispatch time. The guard decrements it
against an on-disk counter in the journey directory, using the same lock
mechanism as `aipe dispatch claim` (`src/dispatch/lock.ts`) — without an
atomic counter, a grant of 1 becomes unbounded spawning.

### Session identity, cost attribution, and talking to a specialist

A dispatched session must be legible in the agentop cockpit and reachable by the
PE. Three things make that true:

**Naming.** Every session is started with `--name "<repo>/<persona>"` and filed
under `--task aipe/<journey>`, so the cockpit groups a wave together and each row
says who is working on what.

**Where it runs — the worktree, and that is not a compromise.** The cwd stays
`<repo>/.worktrees/<journey>-<persona>`, which is **already inside the repo**
(`createWorktree`, `src/worktree/run.ts:65`; `ensureExcluded` keeps it out of the
PE's `git status`). Running at the repo root instead would cost:

- **parallelism inside a monorepo** — the law serializes by *package*
  (`packageFqid`, `law.ts:20`) and deliberately allows two packages of one repo
  to run at once. One working tree means one HEAD and one index; they would
  `checkout` over each other;
- **the QA gate** — QA reviews the dev's branch in its own tree, concurrently.
  Sharing a tree turns an independent skeptic into a queue;
- **the PE's own checkout** — it would become the agent's workbench;
- **physical isolation** — `dispatch claim` would go from belt-and-suspenders to
  the only thing preventing corruption. A lock is an agreement; a worktree is
  physics.

The coordinator loses no *authority* either way — decompose, dispatch, gate,
escalate are unchanged. What the repo-root variant would cost is *guarantees*.
So: keep the worktree, and get the observability another way.

**Cost attribution is an agentop concern, not a cwd concern.** A session whose
cwd is a worktree should be attributed to the parent repository, resolved via
`git rev-parse --git-common-dir`, not to the worktree path. Fixing it there fixes
attribution for every worktree-based tool, not only AIPe.

**Attach is first-class.** `agentop session attach <id>` already works regardless
of cwd — the PE can open a live conversation with any specialist mid-flight, and
the ledger carries the `sessionId` needed to find it. Nothing in AIPe needs to
change to enable this. What it needs is a rule.

### MUST: a redirect through attach is recorded before it is obeyed

When the PE talks to a specialist directly and changes its direction, the
approved Orientation Spec and the ledger stop describing what is being built —
and the QA gate would then validate against acceptance criteria nobody is
following any more. That is a silent divergence, the most expensive kind.

So, as a hard rule carried in every dispatched persona:

> **A specialist that receives any instruction from outside its brief MUST record
> it before acting on it:**
> `aipe journey record --journey <id> … --status redirected --reason "<what the PE asked for>"`
> **and only then continue.**

`redirected` joins the ledger's status set. `aipe session collect` surfaces it as
its own phase, and the coordinator MUST, on seeing one, either fold the change
into the Orientation Spec (bumping its version) or escalate to the PE. A
delivery whose unit was redirected and whose spec was never reconciled MUST NOT
pass the QA gate.

This is the exchange that makes direct conversation safe: the PE gains a live
channel to every specialist, and pays for it with one recorded line.

### Awareness: the rule is told, not just enforced

A deny the session runs into is a wall it discovers by hitting. Every session
agentop opens is therefore **briefed** on its relationship to agentop, up front:

- what it **may** do — `list`, `attach`, `rename`, `note`, including to orient
  itself about the sibling sessions filed under the same task;
- what it **may not** do — open or kill a session;
- its grant, if the coordinator issued one, and what it is for.

The hook then becomes the safety net under a rule the session already knows,
rather than the only thing standing between intent and a token fork-bomb. The
briefing is a property of an agentop-managed session, so it belongs in agentop
itself and applies to sessions AIPe did not start.

### The one change agentop needs

Stamp `AGENTOP_SESSION_ID` into the environment of the `tmux new-session` it
already runs (agentop spawns via `tmux new-session -d -s <id> -c <cwd> -- <argv>`
on its own socket, and stamps nothing today).

This is **not** for the deny — `AIPE_ROLE=specialist`, injected by the
coordinator, already answers "should this be blocked". It is for the **grant
counter**: decrementing a per-session quota requires knowing *which* session is
spending it, and from inside the session there is currently no way to tell.

Because containment depends on this stamp, the minimum agentop version rises to
the first release carrying it.

## Flow: a session-mode wave

Steps 0–3 of `/operate` are unchanged (read the ledger, open the journey,
decompose into per-package tasks, sequence into waves).

**3.5 — the Orientation Spec gains three fields per unit:** `mode`, `intensity`
and `harness`. All go through the PE's existing approval gate. The PE is the
role that approves budget in AIPe's model, so turning on `ultracode` — which
multiplies token spend via Workflow — belongs to the gate they already sign.
The coordinator executes what was approved; it does not raise intensity on its
own judgement.

**4 — provisioning is identical for both modes:** `aipe dispatch claim`
(physical per-repo lock), `aipe worktree create`, `aipe journey record --status
dispatched`.

**5 — dispatch.** `aipe session dispatch` reads the ledger for units marked
`dispatched` with `mode: session` and, for each, composes a prompt file:

1. the persona body, read from the path the target harness's adapter reports via
   `personaTarget(slug)` (for Claude Code,
   `<repo>/.claude/skills/<slug>/SKILL.md`) — the same source the coordinator
   already reads for subagent dispatch, inlined into the prompt, so it does not
   depend on the worktree carrying the harness's skill directory;
2. that unit's slice of the approved Orientation Spec (scope, acceptance,
   relevant files, relations, definition of done);
3. the **return contract** (below).

When `intensity: ultracode`, the composed prompt includes the literal keyword
`ultracode` — that is how the opt-in actually works; there is no CLI flag for
it.

Prompt files are written to `.aipe/journeys/<id>/prompts/<unit-fqid>.md` and
**kept** — they are the audit trail of exactly what each specialist was told,
which the in-memory subagent brief never left behind.

Then one `agentop session batch --task aipe/<journey> --json` for the whole
wave. The returned session ids are written back to the ledger.

**Ledger fields added by this spec** (per unit): `mode`, `intensity`, `harness`
and `sessionId`. Nothing else in the ledger schema changes.

### The return contract

A detached session does not return a value. The contract that replaces the
subagent's return is appended to every dispatched prompt:

- operate strictly inside `<worktree>` (for a monorepo package: stay within
  `<package-path>`);
- run spec-driven first (`aipe skill match`), then TDD;
- verify before claiming done, and gather evidence;
- push `<branch>` and open the PR;
- **then record the result in the ledger:**
  `aipe journey record --journey <id> … --status delivered --pr <url>
  --evidence-cmd "…" --evidence-summary "…"`;
- then stop;
- you are `AIPE_ROLE=specialist`; opening sessions is forbidden.

The ledger remains the source of truth. The session does not *return* — it
*records*.

**Harness-neutral phrasing is required.** The contract must not name Claude Code
constructs: `/verify-before-done` is a slash command a Codex or Gemini session
does not have. Every step is phrased as an outcome ("verify before claiming
done") or as an `aipe` subcommand, which is harness-agnostic by construction.
The adapter supplies the harness's own idiom for the flow-skills where one
exists.

**6 — collection.** `aipe session collect --journey <id> --timeout <s>` polls,
cross-referencing `agentop session list --json` with the ledger, and classifies
each unit:

- `landed` — a record with evidence exists;
- `running` — session alive, no record yet;
- `dead-silent` — session gone, nothing recorded.

The coordinator waits actively and reports to the PE once the wave closes — one
interaction for the PE, same as today.

**7 — QA gate, unchanged.** Every delivery still goes through an independent QA
persona in its own worktree, which may itself be subagent- or session-mode.
Then `journey record --status verified`, then `aipe dispatch release`.

## Failure modes

| Failure | Response |
| --- | --- |
| agentop absent or below minimum version | `validateBatch` rejects `mode: session`; preflight prints install instructions; subagent mode unaffected |
| `dead-silent` unit | `collect` returns worktree + branch. The coordinator inspects the branch read-only (`git log`) and either re-dispatches with a brief that says *continue from what is on the branch*, or escalates to the PE. **Never a blind re-dispatch** — the same ledger law that forbids re-dispatching a `merged` unit applies |
| Session still `running` past the timeout | `collect` returns it with its session id; the **PE** decides whether to wait or `agentop session kill`. The coordinator does not kill sessions |
| `delivered` recorded without evidence | Already REJECTed by the ledger. Unchanged |
| Two sessions on the same repo | Already blocked physically by `aipe dispatch claim` |
| Coordinator dies mid-wait | Sessions survive — they are detached. On return, `/operate` already mandates reading the ledger first, and `collect` reconciles via the `aipe/<journey>` task |

That last row is a genuine gain, not just a mitigation: under subagent
dispatch, a dead coordinator takes the work with it. Under session dispatch it
does not.

## Testing

agentop enters through an injectable runner; no test executes the binary.

- **Prompt composition** — persona body + spec slice + return contract are all
  present; the `ultracode` keyword appears if and only if
  `intensity: ultracode`.
- **argv assembly** — the batch argv is well-formed, and specifically **no
  brief content appears in argv** (it goes by file).
- **agentop `--json` parsing** — started ids and `session list` output.
- **State classification** — `landed` / `running` / `dead-silent` against a
  fake ledger.
- **`probe()`** — absent binary, below-minimum version, ok.
- **`validateBatch`** — rejects session mode without agentop; rejects above the
  session cap; rejects a non-containable harness; existing rejections unchanged.
- **`session guard`** — allow/deny table across command shapes, plus the grant
  counter decrementing and exhausting under concurrent calls. The guard is one
  function, so this table is written **once**, not per harness.
- **`containmentHook()` per adapter** — each adapter renders a config its
  harness actually accepts: the right file (`.claude/settings.json`,
  `~/.codex/hooks.json`, Gemini settings, Copilot config), the right event name
  (`PreToolUse` / `BeforeTool` / `preToolUse`), the right matcher, and a command
  that invokes `aipe session guard`. Asserted against a golden fixture per
  harness, since a silently malformed hook config is a guardrail that looks
  installed and denies nothing.
- **Harness-neutral contract** — the composed prompt contains no Claude
  Code-only construct (no `/`-prefixed slash commands) for a non-claude target.

## Out of scope

- Replacing subagent dispatch.
- Session-mode dispatch on `antigravity` and `kimi` — their blocking mechanisms
  were not verified, so their adapters cannot implement containment and
  `validateBatch` rejects them.
- Running a specialist session at the repo root instead of its worktree — the
  costs are enumerated under "Session identity"; the observability it was meant
  to buy is obtained through naming, attach, and agentop-side attribution.
- A dedicated supervisor session per journey (the coordinator waits actively
  instead, so the PE's session is occupied during a wave).
- Any change to worktree lifecycle, the relations graph, the QA gate, or the
  ledger's schema beyond the new per-unit fields.

## References

Harness containment mechanisms, verified 2026-08-14 — re-check before
implementing an adapter, since these CLIs move fast:

- Codex CLI hooks — <https://learn.chatgpt.com/docs/hooks>
- Gemini CLI hooks — <https://geminicli.com/docs/hooks/>
- Gemini CLI policy engine — <https://geminicli.com/docs/reference/policy-engine/>
- Copilot CLI hooks reference — <https://docs.github.com/en/copilot/reference/hooks-reference>
- Copilot CLI allow/deny tools — <https://docs.github.com/en/copilot/how-tos/copilot-cli/use-copilot-cli/allowing-tools>
