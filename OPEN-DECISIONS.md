# Open decisions — for the PE

Things I did **not** decide alone. None block the current build (everything
implemented is tested and committed); these are forks where your input changes
direction. Updated after your install/onboarding clarifications.

## Resolved by you (now implemented)

- **Binary delivery = a custom domain, on `openvibes.tech`.** The launcher and
  installers fetch from `AIPE_DOWNLOAD_BASE`, default
  `https://aipe.openvibes.tech/cli` (a Cloudflare redirect to the GitHub release
  assets). Install via `curl -fsSL https://aipe.openvibes.tech/cli | sh`. The
  domain is `openvibes.tech` (the open-source umbrella), settled.
  → The release + Cloudflare wiring is the last manual step — see "Deferred debt"
  below and `RELEASING.md`.
- **Onboarding is coordinator-driven, one step per session.** Implemented in
  the SessionStart hook: the coordinator starts each step itself when the PE
  greets it, then announces completion and asks the PE to open a new session
  for the next step. Just opening the workspace and saying "hi" is enough —
  no slash commands after the first.

## Phase B (2026-07-05) — new open items

Phase B (Operation) + portability + toolbox + `/aipe-add-repo` were built
autonomously this session. The doubts to resolve together are collected in
[`docs/NEXT-SESSION-phase-b.md`](docs/NEXT-SESSION-phase-b.md) — most notably
**MCP-config secret validation** (the toolbox catalog is published; today
secrets are kept out by convention only) and the still-pending **persona
load-order live check**.

## Still need your input

### 1. `aipe start` — which harnesses, and how it installs — RESOLVED

**Install mechanics:** (a) — the integration is copied into the project folder
and drives the on-PATH `aipe` binary. Nothing is installed globally and no
marketplace/plugin step is required.

**Harnesses:** five adapters ship — `claude-code`, `gemini`, `codex`,
`copilot`, `generic`. Everything harness-specific lives behind
`HarnessAdapter`, including the *per-repo* install (personas, toolbox skills,
startup hook), which used to bypass the seam and hardcode `.claude/`.
`antigravity` and `cursor` remain `coming-soon` — that flag now means exactly
one thing: no adapter exists yet, enforced by
`src/harness/__tests__/parity.test.ts`.

Codex and Copilot are supported as *workspace* harnesses but are not
session-mode eligible: both gate their hooks behind an interactive trust step
AIPe's unattended dispatch cannot clear. See
[`docs/harnesses.md`](docs/harnesses.md).

### 2. Division of labor — RESOLVED

`aipe start` (terminal, no AI) asks the harness + workspace name and creates
`aipe-<name>/` with the integration inside it (one self-contained folder). The
`/context-brain` skill no longer asks the name or creates a folder — it only
collects the coordinator name + repos. Done.

### 3. What "pegar infra" means in the initial skill

I interpreted the initial skill's job as: ask workspace name + gather the repos
(URLs/paths/stacks) = today's `/context-brain`. If "infra" means something more
(cloud/CI/secrets/env detection), tell me and I'll extend it.

### 4. Persona load-order validation (still deferred)

Needs a live interactive session (open a repo with a generated persona, invoke
a third-party skill on top, observe identity survival). I can't do it
autonomously. Want to run it together, or accept the format as-is?

### 5. Version single-source-of-truth — RESOLVED

`.claude-plugin/plugin.json` is the source; the four other files that hardcode
the version are stamped from it by `scripts/bump-version.ts` and verified by
`bun run version:check`. Both share one list (`REFS` in `scripts/version.ts`),
so writer and guard cannot disagree about which files to touch. The release
workflow runs both.

## Deferred debt — release + Cloudflare — RESOLVED

Releases are automatic: merging to `main` computes the next version from the
conventional commits, stamps it, builds all five targets, tags and publishes.
Nobody pushes a tag by hand. The Cloudflare redirect rules are live and route
through `releases/latest/download`, so they never need touching on future
releases.

The full procedure, the rule table and the manual `workflow_dispatch` valve are
in [`RELEASING.md`](RELEASING.md); the runtime half (`aipe upgrade`) is in
[`docs/upgrades.md`](docs/upgrades.md).

---

*Everything above is safe to defer. The onboarding pipeline (steps 1–4) is
complete and green; the plugin runs today via the compiled binary or the Bun
dev fallback.*
