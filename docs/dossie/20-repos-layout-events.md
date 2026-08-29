# Dossier 20 — `repos/` layout fixes + the events channel (`agentop events`)

**Status:** Merged (`930f671`, PR #30, 2026-08-28; journey `j-20260828-sr`).
**Spec:** [`docs/bugs-campo-sdd.md`](../bugs-campo-sdd.md).

## What this is for

This is a **field-bug triage** — six issues found once real parallel journeys ran
against the new workspace layout — plus the documentation of an operational
channel the coordinator depends on but nothing in `aipe` starts. It matters to a
reader because it exposes a whole-system fault line: `aipe upgrade` was actively
*recommending* a workspace migration that then broke the central dispatch flow
(`docs/bugs-campo-sdd.md`, "Problem"). Four items were fixed in code/docs; two
were investigated and closed with a written verdict and no change.

## The `repos/` layout (context, from PR #17)

The **legacy/flat** layout cloned each repo as a direct child of the workspace
(`<workspace>/<name>/`), so the framework's own `.aipe/`/`.claude/` shared a
namespace with team code — a repo literally named `docs` or `README.md` collided
with a workspace file. PR #17 (`b812665`) introduced the **`repos/` layout**
(`<workspace>/repos/<name>/`), isolating team code from the brain.
`normalizeRepoPaths` fills `./repos/<name>` when the PE gives no path; **`repo.path`
in `brain.yaml` is the only source of truth** and nothing at runtime should assume
the prefix; the legacy layout stays valid forever; migration is opt-in via `aipe
workspace migrate-layout [--apply]` (`b812665` commit message;
`src/context-brain/layout.ts`).

## The three code fixes

**1 — `session dispatch` could not read the persona under `repos/`.** Dispatch
resolved the persona body with the repo *name* as a path segment
(`join(workspace, d.repo, …)`); under `repos/` the persona lives at
`repos/<name>/…`, so the read failed and the specialist "could not read the
persona." Every other consumer already resolved via `repo.path`; dispatch was the
sole offender (`docs/bugs-campo-sdd.md`, item 1). The fix adds a pure helper
`repoDir(repos, name)` (`src/context-brain/layout.ts:57`) that returns the brain's
normalized `repo.path`; `src/session/cli.ts` now reads the brain once and resolves
each persona via a `repoRelDir` closure (`src/session/cli.ts:418`) that **falls
back to the bare name** when there is no brain on disk (legacy behavior preserved).
The load site is `join(workspace, repoRelDir(d.repo), …)` (`src/session/cli.ts:473`).

**2 — `migrate-layout` moved the repos but not `personas.yaml`.** A persona's
registry `path` embeds its repo dir; moving repos under `repos/` staled every
persona path, and `validate-personas` then reported every persona broken (0/N
ready) with no clue why. The fix adds `reconcilePersonaPaths(brain, entries,
adapter)` (`src/hire-specialists/registry.ts:63`), recomputing each canonical path
byte-for-byte the way `buildRegistry` writes it; `migrate-layout` reconciles
against the **post-migration** brain and rewrites `personas.yaml` when anything
changed. Crucially, this also repairs a **workspace already migrated by an older,
persona-blind migration** (zero moves, stale registry): `migrate-layout` no longer
early-returns `nothing-to-do` when only persona paths drift, and `validate-personas`
now emits an actionable issue naming the exact fix command (`aipe workspace
migrate-layout`) instead of a bare failure (`src/validate-personas/check.ts:84`).

**3 — `execution propose` was circular.** `propose` (the pre-choice envelope
pricing of [dossier 14](14-execution-envelope.md)) iterated the ledger's
`dispatches`, so a journey with an approved spec but **zero dispatches** errored
"has no units yet" — yet propose is meant to run *before* dispatch. The fix adds a
pure `parseOrientationUnits(md)` (`src/journey/spec.ts:60`), scoped to the `##
Per-package scope` section (`PER_PACKAGE_SCOPE`, `src/journey/spec.ts:47`) so prose
`###` headings elsewhere are not miscounted as units; `resolveProposeUnits`
(`src/execution/cli.ts:155`) reads units from the spec, falling back to the ledger
only when the spec declares none. Both `propose` and `plan` error messages became
actionable, pointing at `aipe journey spec` / `journey record` instead of a dead
end.

The remaining two triaged items were closed **without a code change** and are
recorded so a reader does not mistake them for open bugs: item 3 (a composed prompt
saying `--workspace .`) did not reproduce — `resolve(opts.workspace)` makes the
path absolute and a regression test asserts the absence; item 4 (the containment
hook blocking the specialist's own file reads) was refuted — the `PreToolUse` hook
matches `Bash` and governs only `agentop session` spawn/kill, never Read/Edit/Write
(`src/harness/claude-code.ts`), and the residual "sits idle" symptom was attributed
to **agentop's** initial-prompt delivery — a cross-repo matter escalated to the
coordinator, explicitly not an `aipe` fix (`docs/bugs-campo-sdd.md`, item 4).

## The events channel — and its silent prerequisite

The second half of the PR is documentation, in `skills/operate/SKILL.md`: it
teaches `agentop events` as the standard step right after `session dispatch`.
Understanding it matters to any reader trying to reconstruct how the coordinator
learns a specialist has paused.

- **The states**: `waiting`, `waiting-approval`, `exited` — plus a separate
  `turn-end`.
- **The producers**: `waiting` / `waiting-approval` / `exited` are read off the
  screen by **agentop's five-second screen monitor** — that monitor *is* the
  producer. `turn-end` comes from a different producer, the Claude Code `Stop`
  hook.
- **The consumer**: `agentop events watch --task aipe/<id> --on
  waiting,waiting-approval,exited --notify <session>` — a push channel that
  delivers each transition to the coordinator by socket. The watch is a **file,
  not a process** (it survives a reboot); `agentop events tail --since <when>`
  recovers missed events.

The load-bearing correction — and the whole reason the second commit exists — is
that **the watch has a producer prerequisite that nothing in `aipe` starts.** The
PR's first draft claimed the watch warns "the instant a unit changes state." That
was false and failed *silently*: with no producer running, the watch is armed and
no `waiting`/`waiting-approval`/`exited` event ever fires. A coordinator had turned
off polling trusting `--notify` and sat blind for ~40 minutes with specialists
stalled (`930f671` commit message). The doc now names how to bring the producer
up (`agentop server`, or `agentop events run`) and how to confirm it (`agentop
events status`), draws the channel distinction (`turn-end` is exact, instant and
producer-free but "turn ending ≠ pausing for you", so it is no substitute for
`waiting`), and states the rule "do not trade redundancy for elegance" — keep the
`session collect` sweep running under the watch as a safety net.

This is a **hard cross-tool dependency on `agentop` that `aipe` documents but does
not enforce or start** — an operational footgun by construction. Because it lives
on the `agentop` side, it is coordinator/cross-repo matter, recorded here so the
architecture is honest about it and cross-referenced from the dossier's
[divergences appendix](README.md#appendix--divergences-escalated-not-cosmetic).
One boundary the doc draws is worth repeating: a `waiting-approval` session is
waiting on a **person** (the PE) — neither the coordinator nor any session may
attach and approve for it, which would forge a human approval the audit trail
depends on.

## Left open / notes for a reader

- The events producer is not owned by `aipe`; a coordinator must start it and
  confirm it with `agentop events status`. Escalated as a cross-tool dependency.
- Item 4's idle-on-start symptom depends on `agentop`'s prompt delivery — an
  open `agentistics` matter, not an `aipe` fix.
