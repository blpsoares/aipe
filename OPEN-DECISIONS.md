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

## DECISION NEEDED — how the release bump reaches protected `main`

**Status:** blocking automatic publishing. Merging to `main` no longer cuts a
release. Everything that does **not** depend on your choice is already done and
tested (loud failure + no orphan tag + the two orphan tags cleaned + the docs
now tell the truth). What is left is this one policy fork — I stopped here on
purpose because three of the four paths change `main`'s protection permanently.

### Why the push fails today (demonstrated, not guessed)

`.github/workflows/release.yml` step 8 pushed **two refs in one plain
`git push`** — `HEAD:main` and the tag. The active ruleset **"Require PR +
green CI on main"** (`21821077`) rejects the branch ref but does not touch tag
refs, so the tag landed and the branch bounced:

```
remote: error: GH013: Repository rule violations found for refs/heads/main.
remote: - Changes must be made through a pull request.
remote: - Required status check "check" is expected.
 * [new tag]         v1.11.0 -> v1.11.0            ← tag won
 ! [remote rejected] HEAD -> main (push declined…) ← branch lost
error: failed to push some refs to 'https://github.com/blpsoares/aipe'
```

(run `33283748102`, the merge of #43 → orphan `v1.11.0`; run `33274404519`,
#38 → orphan `v1.10.3`). **Key finding:** the ruleset already carries an admin
`RepositoryRole` bypass, and it does **not** help — a RepositoryRole bypass does
not cover the Actions bot's `GITHUB_TOKEN`, and GitHub refuses an `Integration`
(GitHub Actions app) bypass actor on a **personal** repo with `422 … must be
part of the ruleset source or owner organization`. So on this repo there is no
valid way to hand the bot a bypass without a human's PAT.

### My recommendation: **path 4 — release what is already merged; bump in `dev`**

The release workflow **stops writing to `main` entirely**. The version is bumped
on `dev` before promotion; the promotion PR carries the bumped manifest into
`main` through the normal, already-gated PR path; the workflow on `main` then
only builds, tags the merge commit, and publishes. Because it never writes to
the protected branch, **the ruleset is never in the way — `main`'s protection
stays fully intact, no bypass, no PAT, no extra PR.** It fits the dev→main model
you just adopted, and it makes "the version in `main` is the published version"
true by construction (main got the bump via the promotion PR).

Cost: the bump must happen on `dev` before promotion. `dev` has **no** ruleset,
so the bot can push there — the clean form is a tiny **dev-side step** that, on
push to `dev`, computes the next version and commits the bump to `dev`. That is
the follow-up work I would do once you say "path 4".

### Alternatives I discarded, and why

- **Path 1 — bypass the ruleset for the bot.** *Rejected: not actually
  possible here.* Proven above — the admin-role bypass is already present and
  the bot is still rejected, and an Integration bypass is refused on a personal
  repo (422). The only way to make a direct push work is to push with a **PAT**
  owned by an admin user: a standing high-privilege credential to store and
  rotate, and it *still* leaves a permanent hole in `main`'s protection. Worst
  trade of the four.
- **Path 2 — the bump becomes a PR with auto-merge.** *Viable, but heavy.*
  Honors "every change to `main` is a PR", but adds a bot-authored PR **per
  release**, needs repo-level auto-merge enabled, needs the `check` to run and
  pass on that PR, and the eventual merge re-triggers `release.yml` (needs the
  guard to compute "nothing to release" so it doesn't loop). Real machinery and
  churn on top of the promotion PR that already gated the same content. This is
  my runner-up if you'd rather not add any dev-side automation.
- **Path 3 — stop pushing the bump to `main`; version lives only in `dev`.**
  Mechanically the same win as path 4 (no write to protected `main`), but it
  changes the meaning of "the version in `main`" — `main` would trail until the
  next promotion. Path 4 is the same idea with the bump *arriving through the
  promotion PR*, which keeps `main`'s version equal to what shipped. I prefer 4
  for that reason.

### If you pick a path that needs a click, here is exactly what to click

- **Path 4 (recommended):** **nothing** in GitHub settings. `main`'s ruleset
  stays exactly as it is. The change is code-only (workflow + a dev-side bump
  step) and I do it in a follow-up PR.
- **Path 2:** GitHub → repo **Settings → General → Pull Requests → enable
  "Allow auto-merge"**. No ruleset change. I wire the rest in the workflow.
- **Path 1 (not recommended):** create a fine-grained **PAT** (Settings →
  Developer settings → Personal access tokens) owned by an admin, scoped to
  this repo with **Contents: Read and write**, store it as repo secret
  `RELEASE_PAT` (Settings → Secrets and variables → Actions), and I switch the
  push to use it. The admin-role bypass then applies because the push is a
  human admin, not the bot. (Still a permanent bypass — flagged for the record.)

*Tell me the path and I'll implement it; until then the workflow fails safe.*

---

*Everything above is safe to defer. The onboarding pipeline (steps 1–4) is
complete and green; the plugin runs today via the compiled binary or the Bun
dev fallback.*
