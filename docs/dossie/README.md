# AIPe Dossier

A durable, version-controlled record of **how AIPe was built** — every sub-project,
step by step. Specs describe *what* to build and plans describe *how*; this dossier
captures the **narrative of execution and review**: the decisions taken (and why), what
each implementation step delivered, what code review caught, how it was fixed, and the
final verified state. It exists so the whole journey can later feed a documentation
site, an architecture overview, and onboarding material — the intended reader is
someone who did **not** follow the day-to-day and must reconstruct the architecture
from these pages alone.

## Convention (applies to every session, including future ones)

When a sub-project (or a distinct phase) is completed, add or update a dossier entry
before the working ledger is discarded. The early chapters record, in order:

1. **Decisions** — the questions raised during brainstorming and the choices made,
   with the reasoning.
2. **Plan** — the task breakdown.
3. **Execution** — what each task delivered.
4. **Review** — findings from task reviews and the final whole-branch review:
   Important/Critical issues fixed, and Minor issues consciously accepted (with why).
5. **Final state** — merge commit and test/type-check evidence.

The recent chapters (from [08-web-console](08-web-console.md) onward) shift to an
**architecture-as-built** form — what the subsystem is for, the mechanism, and the
file or commit that backs every claim — because the reader needs to reconstruct the
system, not relive the review. Both forms are "the house form"; new chapters may use
either, but the **rule that does not bend is backing**: no claim without the file or
commit that sustains it. AIPe is physical; its documentation is verifiable too.

Every artifact in this repository — code, comments, strings, specs, plans, skills, the
hook, docs, and commit messages — is written in **English**. (Interaction with the PE
may happen in another language, but the repository is English-only.)

## Index

> **Numbering note.** Chapter *file* numbers and the sub-project `#` column drifted
> apart during a finalization session that landed several chapters at once, so a few
> file numbers repeat (`08-`, `09-`, `10-`). Rather than renumber and break every
> cross-reference, the table below lists **every** chapter file that exists; trust the
> filename in the Entry column, not the `#`.

| # | Sub-project | Status | Entry |
|---|---|---|---|
| 1 | `/context-brain` — factual map of a context | Merged | [01-context-brain.md](01-context-brain.md) |
| 2 | `/make-workspace` — clone the repos | Merged | [02-make-workspace.md](02-make-workspace.md) |
| 3 | `SessionStart` hook — coordinator context injection | Merged | [03-session-hook.md](03-session-hook.md) |
| 4 | `/relationship` — cross-repo relationship discovery (also backfills `stack`) | Ready to merge | [04-relationship.md](04-relationship.md) |
| 5 | `/hire-specialists` — persona skills (renamed from `/context-brain-generator`) | Implemented | [05-hire-specialists.md](05-hire-specialists.md) |
| — | Unified `aipe` CLI + zero-dependency distribution | Implemented | [06-unified-cli-distribution.md](06-unified-cli-distribution.md) |
| 6 | Phase B (Operation): worktree, dispatch, journey, operate, dashboard + portability, toolbox, add-repo | Merged | [07-phase-b-operation.md](07-phase-b-operation.md) |
| 7 | AIPe Web Console (`aipe serve` — responsive org chart, pipeline, detail, embedded terminal, live over SSE) | Built | [08-web-console.md](08-web-console.md) |
| — | Module granularity — relationship graph + hiring by fqid (finalization frente 1) | Built | [08-module-granularity.md](08-module-granularity.md) |
| — | Persona load-order validation — static preflight built; one live observation still pending | Preflight built | [09-persona-load-order.md](09-persona-load-order.md) |
| — | Release + distribution readiness — automatic release from `main`, Cloudflare download wiring | Built | [10-release-distribution.md](10-release-distribution.md) |
| 8 | Monorepo module granularity (`module` as the unit of work) + toolbox uninstall | Built | [09-module-granularity.md](09-module-granularity.md) |
| 9 | Spec-first operation (coordinator Orientation Spec + PE gate + specialist SDD) | Built | [10-spec-first-operation.md](10-spec-first-operation.md) |
| 10 | Model policy (`aipe model` — model selection by tier + authorization/volume gates) | Built | [12-model-policy.md](12-model-policy.md) |
| 11 | Harness adapters (`HarnessAdapter` seam — Claude Code extraction + `generic` demonstrator) | Built | [11-harness-adapters.md](11-harness-adapters.md) |
| 12 | `/handoff` (portable `CLAUDE.md` export for a collaborator who won't install AIPe) | Built | [13-handoff.md](13-handoff.md) |
| 13 | Execution-envelope recommendation (`aipe capabilities probe\|show\|confirm`, `aipe execution propose\|plan`) | Built | [14-execution-envelope.md](14-execution-envelope.md) |
| 14 | Session-mode dispatch (`aipe session dispatch\|collect\|grant\|doctor\|guard` via `agentop`) | Built | [15-session-dispatch.md](15-session-dispatch.md) |
| 15 | **Atomic claim** — the same-repo law becomes physical (`aipe dispatch claim`) · parallelism chain 1/3 | Merged (#27) | [16-atomic-claim.md](16-atomic-claim.md) |
| 16 | **Identity per task** — `Persona · task`; concurrency for non-writing roles · parallelism chain 2/3 | Merged (#28) | [17-identity-per-task.md](17-identity-per-task.md) |
| 17 | **Path-lock** — the lock descends from repo to path · parallelism chain 3/3 | Merged (#32) | [18-path-lock.md](18-path-lock.md) |
| 18 | `aipe status` — who/what/repo/status, the delta after each change, and the SessionStart state block | Merged (#29) | [19-status.md](19-status.md) |
| 19 | `repos/` layout fixes (dispatch/migrate/propose) + the `agentop events` channel | Merged (#30) | [20-repos-layout-events.md](20-repos-layout-events.md) |
| 20 | Autonomous upgrade — `aipe upgrade` executes the migration instead of recommending it | Merged (#31) | [21-autonomous-upgrade.md](21-autonomous-upgrade.md) |
| 21 | Web Console redesign — Agora / Equipe / Histórico, the 4-column board, org fit-to-view | Merged (#34) | [22-console-redesign.md](22-console-redesign.md) |

## The parallelism chain

Chapters 15–17 (files [16](16-atomic-claim.md) → [17](17-identity-per-task.md) →
[18](18-path-lock.md)) are **not three loose features** — they are one progression
with strict dependency, and each link only became buildable after the one before it.
Read them in order; this is the most interesting thing that happened to the product.

The problem: AIPe runs **N coordinator sessions and N specialists in parallel**, and
the "same-repo law" (at most one writer per repo at a time) was only a convention,
adjudicated over a single in-memory batch. Three journeys turned it into physics and
then relaxed it exactly as far as is safe:

1. **[Atomic claim](16-atomic-claim.md)** (`#27`) — *How do two coordinators avoid
   both provisioning the same repo at once?* The law stops being a convention and
   becomes an operating-system fact: `.aipe/locks/<repo>.lock` created with an atomic
   `link()` (`O_CREAT|O_EXCL`), so among N racers exactly one wins; plus stale
   reconciliation (orphan lock / dead pid / a 10-minute freshness grace) so a crashed
   coordinator does not freeze the repo forever, and a `--force` that requires a
   recorded PE authorization.
2. **[Identity per task](17-identity-per-task.md)** (`#28`) — *Now that the claim is
   physical, how does one QA review PR #24 while another reviews PR #23, same repo,
   same time?* A new `task` axis makes the addressable identity `Persona · task`. The
   rule is stated in terms of **writes**: roles that **do not write** (QA) run N
   concurrently on one unit as long as each carries a distinct task; **two devs stay
   forbidden** because there is a write to conflict over. This is only *safe* because
   the same task still resolves to one winner under the atomic claim of link 1.
3. **[Path-lock](18-path-lock.md)** (`#32`) — *And two devs in one repo on disjoint
   files?* The lock descends from repo to **path**: a pure overlap engine decides
   whether two path specs can match a file in common, a per-unit mutex guard
   serializes the scan-decide-write between processes, and overlap becomes a **managed
   exception** (wait → rebase → resolve → review-over-merge), not a hard rejection.
   Declared paths are reconciled against what the branch *actually* touched, so an
   ageing declaration cannot hide a real collision.

**What has not fallen yet — on purpose.** Path-lock lets two devs coexist in one repo,
but the console still does **not** visualize work at *sub-task* grain. The 4-column
board of [dossier 22](22-console-redesign.md) is a kanban of *dispatches*, not of the
sub-tasks a dispatch may fan into; "sub-task" today lives only in the lock mechanics,
not in any UI. That view is held back deliberately — the physical layer had to be
proven before a view could be trusted to render it. It remains a
[roadmap item](#roadmap--verified-against-code).

## Roadmap — verified against code

Reconciled item by item **against the code** on 2026-08-29 (the previous "not yet
built" list had gone stale and actively mis-described the product — it listed shipped
harness adapters as unbuilt and described parallelism as it was *before* path-lock).
Each verdict cites what proves it.

**Removed — built, and it was wrong to still list these:**

- ~~Harness adapters beyond Claude Code~~ — **BUILT.** `src/harness/` ships four real
  adapters besides `claude-code.ts`: `gemini.ts` (18.8K, real containment via
  `.gemini/settings.json`), `codex.ts` (15.4K) and `copilot.ts` (17.3K) (both full
  adapters, deliberately non-containable — see next bullet), and `generic.ts`
  demonstrator; all registered in `src/harness/registry.ts`. See
  [dossier 11](11-harness-adapters.md) and [15](15-session-dispatch.md).
- ~~Release + Cloudflare wiring~~ — **BUILT.** `RELEASING.md` opens "Releases are
  automatic. Merging to `main` cuts one"; `.github/workflows/release.yml` computes the
  version from conventional commits, cross-compiles five targets, and publishes the
  GitHub Release with binaries + `SHA256SUMS.txt`. The download domain
  (`aipe.openvibes.tech/cli`, overridable via `AIPE_DOWNLOAD_BASE`) and its seven
  Cloudflare Redirect Rules are documented in `RELEASING.md`. See
  [dossier 10 — release-distribution](10-release-distribution.md).

**Re-worded — no longer "not built", but genuinely not fully done:**

- **Persona load-order validation** — the deterministic **preflight is built**
  (`aipe validate-personas`, `src/validate-personas/`; [dossier 09 —
  persona-load-order](09-persona-load-order.md)). What is still pending is the single
  **live human observation** it needs (open a real interactive session, layer a
  third-party skill, watch the persona survive) — the container it was built in cannot
  run that.

**Kept — verified genuinely pending:**

- **Follow-ups at module grain** — `/relationship` discovery of intra-monorepo edges,
  and per-module persona-*body* prose, are still coordinator-prose follow-ups, not
  deterministic code (`docs/dossie/09-module-granularity.md`, "Deferred").
- **Codex/Copilot session-mode containment** — `codexAdapter.containmentHook()` and
  `copilotAdapter.containmentHook()` still return `null` (`src/harness/codex.ts:240`,
  `src/harness/copilot.ts:261`); Codex trusts hooks only through interactive `/hooks`,
  Copilot gates on a directory-trust prompt. (Copilot *does* have a config-file
  `trustedFolders` bypass, deliberately unused as "silently wrong is worse than
  ineligible" — so this bullet is slightly understated for Copilot, but the net state,
  not containable, is correct.) See [dossier 15](15-session-dispatch.md).
- **`aipe session grant` redemption** — the quota is implemented and tested
  (`src/session/grants.ts`) and the consumer already reads `AGENTOP_SESSION_ID`
  (`src/session/cli.ts:142`), but `agentop` still does not stamp that variable, so the
  quota cannot be consumed; the command prints that caveat itself
  (`src/session/cli.ts:883`). See [dossier 15](15-session-dispatch.md).
- **Sub-task visualization** — deliberately blocked; see [the parallelism
  chain](#the-parallelism-chain) and [dossier 18](18-path-lock.md). No `sub-task`
  kanban exists in `src/serve/`; the dispatch-grain pipeline kanban does
  ([dossier 22](22-console-redesign.md)).

## What this dossier does not yet cover (honest gaps)

Mechanisms that are real in the code but have **no dedicated chapter** — an honest
index is worth more than silence. A future session should fill these:

- **`aipe dispatch` law engine as a whole** — `src/dispatch/law.ts` (`validateBatch`,
  the `MAX_CONCURRENT`/`SESSION_MAX_CONCURRENT` caps, the cross-repo dependency gate)
  is described piecewise across [16](16-atomic-claim.md)–[18](18-path-lock.md) but has
  no single reference chapter.
- **`aipe dispatch reconcile` / `resolve-overlap` operator workflow** — the
  path-drift reconciliation and the wait→rebase→resolve→review-over-merge exception
  are documented in [18](18-path-lock.md) from the mechanism side, not as an operator
  runbook (that lives in `skills/operate/SKILL.md`).
- **The `agentop events` channel end-to-end** — [20](20-repos-layout-events.md)
  covers the states/producers/consumer, but the producer lifecycle (`agentop server`
  vs `agentop events run`) is an `agentop` (cross-repo) concern with no chapter here;
  see also `docs/superpowers/specs/2026-07-08-pr-c-monitor-design.md`.
- **The SessionStart hook's full field set** — [03](03-session-hook.md) predates the
  status state-block and awareness clauses that [19](19-status.md) added to it; the
  hook's current rendered output is split across the two.
- **`aipe serve` transport internals** — the SSE snapshot/stream and terminal
  WebSocket are named in [08](08-web-console.md) and [22](22-console-redesign.md) but
  the server (`src/serve/server.ts`, `docs/superpowers/specs/2026-07-08-serve-background-design.md`) has no chapter.

## Appendix — divergences (escalated, not cosmetic)

Documenting the new work surfaced places where **the code and its own SDD disagree**,
or where a documented guarantee is narrower than it reads. Per the dossier's rule
these are **escalated, not papered over**, and this dossier documents the **code's
actual behavior**. They are code/spec matters for the coordinator, outside a
docs-only scope to fix:

1. **Autonomous upgrade — promised TTY consent does not exist.** The SDD says other
   legacy workspaces are reached by "`--migrate-all` *or consent when there is a
   TTY*" (`docs/upgrade-autonomo-sdd.md:94`), but `migrationTargets`
   (`src/update/apply.ts:256`) has no TTY branch and `aipe upgrade` never prompts —
   `--migrate-all` is the only escape hatch. Either grow the prompt or drop the
   claim. See [dossier 21](21-autonomous-upgrade.md).
2. **Console board — `unknown` liveness is placed under "Working".** The redesign SDD
   §11.3 (`docs/serve-console-redesign-sdd.md:406`) says liveness `unknown` "never
   becomes 'working' nor 'dead'", but `columnOf` falls through to `working` for
   `unknown` (`runtime/board.ts:66`), shown in Agora's "Happening now"
   (`views/agora.view.tsx:50`) with only a "can't verify right now" caption. Soft
   (labeled, not silent) but in tension with the honesty rule the SDD itself states.
   See [dossier 22](22-console-redesign.md).
3. **`aipe status config` strips YAML comments from `brain.yaml`.** The write path
   rewrites the brain via `stringify` (`src/status/config.ts:69`), preserving key
   order but dropping comments — the same way every context-brain writer touches the
   file. The SDD's "byte-for-byte" guarantee is scoped to the *read* paths only
   (`docs/status-cli-sdd.md:66`). A characteristic to know, not clearly a regression;
   escalate only if a real brain carries comments that must survive a preference
   change. See [dossier 19](19-status.md).
4. **The `agentop events` watch is silent without a producer that `aipe` never
   starts.** `agentop events watch --on waiting …` fires nothing unless an `agentop`
   screen-monitor producer (`agentop server` / `agentop events run`) is running; the
   dependency is documented in `skills/operate/SKILL.md` but not enforced or started
   by `aipe` — an operational footgun by construction, and a cross-tool (`agentistics`)
   matter. See [dossier 20](20-repos-layout-events.md).

See the foundation design at
`docs/superpowers/specs/2026-07-01-aipe-context-brain-design.md`.
