# AIPe architecture

This is the architecture reference for AIPe — the document an engineer reads to
decide whether to adopt it, or to change it without breaking it. It is not a
feature tour. The dossier under `docs/dossie/` narrates how the system was *built*,
chapter by chapter with `file:line` backing every claim; this set answers the
different question the dossier does not: **why is it this way, what was rejected,
and what breaks if you touch it.**

Everything here is English — the canonical version, living next to the code.

## Two readers

- **The contributor** is going to change the code and needs to know what breaks.
  Start with `concurrency.md`, `ledger.md`, and `harnesses.md`
  (`docs/harnesses.md`), then `walkthrough.md` to see the machine run.
- **The evaluator** is deciding whether to adopt, and needs the model and its
  limits without reading `src/`. Start with this page, then `verifiable-truth.md`,
  `unsupported.md`, and `execution-envelope.md`.

Both should read `walkthrough.md` at least once — it is the only document that
shows real commands and their real output.

## The vocabulary

The rest of the docs assume these terms. They are the conceptual model.

- **Demand** — a request from the PE (the human): a bug, feature, or task,
  spanning one or more repos.
- **Journey** — one work session on one demand. It owns a durable **ledger**. One
  demand = one journey; several specialists may run under it.
- **Coordinator** — the persona that decomposes a demand and dispatches
  specialists. It **never edits a repo itself** — its only actions are decompose,
  dispatch, read-only investigate, and escalate.
- **Specialist** — a dev-fullstack or QA persona, dispatched into an isolated git
  worktree to do one unit of work and open a PR.
- **Unit / package / `fqid`** — the addressable thing a task runs on. A flat repo
  is one implicit package (`fqid` = the repo name); a monorepo has one package per
  service (`fqid` = `repo/package`). Distinct packages run in parallel; the same
  package serializes.
- **`Persona · task`** — the identity axis. One persona can run two distinct tasks
  on one unit concurrently, keyed on the task, each with its own QA gate.
- **Ledger** — the per-journey record of what was dispatched and its status. The
  deterministic spine: it survives the coordinator's context being compacted.
  Bookkeeping and audit, never the hiring brief (the brief is never persisted).
- **Gate** — a deterministic refusal the ledger enforces: no done-claim without
  evidence, no re-recording a `merged` unit, no reason-less redispatch/redirect/
  block, no shipping against red or unresolved CI.
- **Execution envelope** — how a unit will run: mode (subagent/session), harness,
  model tier, intensity. Priced before dispatch; some axes are PE-gated.
- **Harness** — the agent tool that runs a specialist (Claude Code, Gemini, …),
  reached through an adapter.
- **Containment** — a block-before-execute hook, trusted with no human present.
  The *dispatch* rule is binary: a harness is session-eligible only if it can be
  contained (`isContainable`). The wider *world* is not binary — a three-state
  ledger (`src/harness/compat.ts`) records, for the ten harnesses `agentop` can
  host, containable-proven vs non-containable-proven vs unestablished (the last
  is the state the old two-way vocabulary could not express).

The load-bearing invariant that ties it together, and that the whole repo is built
to hold: **everything past the raw output of an agent is deterministic, tested
CLI; the judgement lives in the prose of the `SKILL.md` files.**

## The documents

| Document | Serves | What it argues |
|---|---|---|
| `walkthrough.md` | both | one demand traced end to end, with real command output |
| `concurrency.md` | contributor | the chain: atomic claim → identity-per-task → path-lock, and why paths age |
| `ledger.md` | contributor | the states, the gates, immutability, the five-way CI verdict |
| `execution-envelope.md` | evaluator | how a task is priced, and what the PE must authorize |
| `verifiable-truth.md` | evaluator | "an exit code is not proof": four failure forms, and the counter-reflex |
| `unsupported.md` | evaluator | what is refused (which harnesses, and why), and the degraded path |
| `docs/harnesses.md` | contributor | the harness-adapter seam (extended, not duplicated, here) |
| `findings.md` | both | where docs and code disagree, `file:line` on both sides |
| `diagrams/*.yaml` | both | six diagram specs; see below |

`walkthrough.md` is the only document that may run long — it carries pasted command
output. Every other document argues the *why* and stays short; if one grows, it is
probably describing *how* the code works, which the code and the dossier already
do.

## The diagrams

The six specs under `diagrams/` are **specifications, not drawings**. Nothing is
rendered in this repo — an external pipeline generates two versions (English for
the repo, Portuguese for publication) from each single source, so a correction is
made in exactly one place. Do not add Mermaid, ASCII, SVG, or images.

Each `.yaml` has an `id`, a `type` (`graph | sequence | state-machine | matrix`),
an `argument` (what the diagram proves, in `en` and `pt`), a list of `nodes`, and
`edges`. Every node carries:

- a bilingual `label` and `note`;
- a `kind`, which is semantic:
  `deterministic` = tested CLI · `judgment` = `SKILL.md` prose · `gate` = a human
  decision · `denied` = refused by a rule · `structure` = substrate;
- an `evidence` pointer, `file:line`, that **exists** in the tree and adjudicates
  the node. Each was verified — not just that the line exists, but that it says
  what the node claims.

The six:

1. `demand-to-merge` — the mandatory path from a demand to a merged PR.
2. `ledger-state-machine` — the ledger's states and the gates between them.
3. `concurrency-model` — the chain of parallelism and the path-aging reconciler.
4. `harness-containment` — why some harnesses cannot be session-dispatched.
5. `rework-loop` — delivered → failed → re-dispatch (new session) → re-gate.
6. `merge-to-production` — the two steps beyond `merged`: promotion and release.

## The house rule

No claim without backing. Every assertion here is either verifiable in the code it
cites, or explicitly marked as read from code and tests rather than observed
running. Where a trace stops, the text says so. This is the same rule the dossier
holds itself to (`docs/dossie/README.md`), and it is the whole point of the
`file:line` discipline.
