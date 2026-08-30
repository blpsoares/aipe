# Contributing to AIPe

Thanks for considering a contribution. Before opening a PR, read this
end-to-end — AIPe's own development process is unusual, and a generic
"fork, branch, PR" mental model will leave you confused about why some
things in this repo look the way they do.

## What this repository is

AIPe is a Claude Code plugin (`.claude-plugin/plugin.json`, `skills/`,
`hooks/`) coupled to a unified TypeScript/Bun CLI (`src/cli.ts`, ~28
subcommands under `src/<command>/`) that compiles to standalone binaries via
`bun build --compile`. The guiding invariant: **everything past the raw
output of an agent is deterministic, tested CLI** (`bun:test`, one
`__tests__/` directory per module); **judgement lives in `SKILL.md` prose**,
never in ad hoc code. New code with no test is treated as a project
regression here, not a coverage nitpick.

## How AIPe itself gets built (read this before you assume a normal PR flow)

AIPe is dogfooded: the maintainers develop this very repository *using*
AIPe's own `/operate` skill (see `skills/operate/SKILL.md`,
`src/dispatch/`, `src/journey/`). That shapes the codebase in ways an
external contributor won't guess from the code alone:

- **A dispatch law, not a suggestion.** A coordinator persona decomposes a
  demand into per-package tasks and dispatches a specialist for each — the
  coordinator **never edits a repository directly**. `skills/operate/SKILL.md`
  spells out a table of non-exceptions: "it's simple", "it's urgent", "it's
  one line", "I already know the fix" — none of these justify the coordinator
  editing inline. Only an explicit human instruction does.
- **Isolated worktrees.** Each dispatched specialist works inside its own git
  worktree (`aipe worktree create`), on its own branch, never touching the
  primary checkout.
- **A QA gate before anything is called done.** Every delivery is reviewed
  by an independent QA persona against the diff and the acceptance criteria —
  not against the author's own report — before it is reported upstream as
  finished.
- **Evidence-gated ledger.** Work is tracked in a durable per-demand ledger
  (`aipe journey record`). A delivery recorded as `delivered` **without**
  attached evidence (the commands run and what their output showed) is
  rejected by the ledger outright — that rejection is deliberate, not a bug.
- **Path-granular concurrency.** Two specialists only coexist in the same
  repository when their declared paths are disjoint (`src/dispatch/paths.ts`,
  `src/dispatch/lock.ts`); anything else serializes so two agents never write
  the same file at once.

You do not need any of this tooling to send a PR from GitHub — that
machinery exists for the AI-coordinated side of development. But it explains
two things you will see in history and in code: commits and PRs that read as
if written to a brief (they were), and a codebase that is unusually strict
about tests and evidence for its size (the ledger enforces it internally, and
review holds outside PRs to the same bar).

## Branches: `dev` and `main`

This repository runs a two-branch flow, mirrored from `agentistics`:

- **`dev` is the integration branch.** Branch from `dev`, and open your PR
  against `dev` — not `main`. Every push to `dev` runs the same CI gate as a
  PR (`.github/workflows/ci.yml`), so what accumulates there stays verified
  continuously, not just at promotion time.
- **`main` only receives promotion PRs**, and every push to `main` publishes
  a release automatically (`.github/workflows/release.yml`) — the next
  version is computed from the conventional-commit subjects merged since the
  last tag. `main` is never the target of a contribution PR.
- **Who promotes `dev` → `main`, and when.** The coordinator persona
  (`skills/operate/SKILL.md`) opens the promotion PR — not on every merge to
  `dev`. A promotion goes out when either (a) at least one complete feature
  has landed on `dev`, or (b) there is a fix the PE needs to consume with
  urgency. That's deliberate, not lag: promoting on every merge is what
  produced five releases in a single day for this repository, several of
  them a single feature sliced across patch bumps. `agentistics` set the
  precedent — the coordinator held back one commit's promotion to bundle it
  with two other specialists' work into one release with actual content,
  instead of three releases in a row.
- **Branch protection on `main` is PENDING.** As of this writing, `main`
  still accepts a direct push from anyone with write access — there is no
  enforced requirement yet that a change go through a reviewed, green-CI PR.
  Once enabled, `main` will require an open PR with the `ci.yml` check
  passing before a merge is allowed, bypassed only for the release
  workflow's own version-bump commit (which pushes directly to `main`,
  after the promotion PR itself was already gated — see `RELEASING.md`).
  Until then, treat "PR + green CI to touch `main`" as the convention it
  always was, not yet a rule the repository enforces for you.

## Sending a PR

1. **Fork and branch off `dev`** — that's where ongoing work lives; see
   above. There's no special branch naming requirement for external
   contributions.
2. **Work test-first.** Tests live in `src/<module>/__tests__/<subject>.test.ts`,
   next to the module they cover. Preact views under `src/serve/app/` use
   `@testing-library/preact` + `happy-dom`, with the global test setup in
   `src/serve/app/__tests__/setup.ts`. A behavior change with no test is not
   reviewable here.
3. **Keep code, comments, strings, and docs English-only.** That's the
   documented convention (`docs/dossie/README.md`) and it holds throughout
   the source tree; only interaction *with* an AI coordinator may happen in
   another language. Commit **subjects** are a partial exception in this
   repo's own history — many were written in Portuguese by the PE dispatching
   the work — but for an external PR, write yours in English so the log stays
   readable to reviewers who aren't that PE.
4. **Use Conventional Commits.** This is not a style preference: the release
   workflow computes the next version from your commit subjects since the
   last tag (`.github/workflows/release.yml`), and it only recognizes the
   English `type(scope):` keywords below regardless of the language the rest
   of the subject is written in. Concretely:
   - `feat: …` / `feat(scope): …` → minor bump. **Scopes count** — `feat:*`
     and `feat(session):*` are matched separately, so a scoped feature commit
     that doesn't parse ships as a silent patch.
   - `fix:`, `chore:`, `refactor:`, `docs:`, `test:`, etc. → patch bump.
   - A `!` after the type/scope (`feat!:`, `fix(cli)!:`) or a `BREAKING
     CHANGE` footer → major bump.
   - Malformed or unconventional subjects are silently treated as a patch —
     that's a footgun, not a feature, so just follow the convention.
5. **Make sure CI is green before asking for review.** There's no separate
   lint script in this repo — don't add one on your own initiative. The gate
   *is* the CI sequence (`.github/workflows/ci.yml`), and it's the same
   sequence you should run locally:
   ```bash
   bun install                 # deps
   bun run version:check       # single-source-of-truth version guard
   bun run typecheck           # bunx tsc --noEmit -p tsconfig.json (strict)
   bun test                    # bun:test, the whole suite
   bun run build:host          # compiles the host binary
   ./dist/aipe-linux-x64 --version && ./dist/aipe-linux-x64 --help   # boot smoke
   ```
6. **Attach evidence in the PR description**, not just "should work now" —
   the commands you ran and what their output showed. This mirrors the
   evidence discipline the internal ledger enforces on every dispatched
   delivery, and it's what actually gets a PR reviewed quickly. The PR
   template asks for this explicitly.
7. **Don't touch the version.** It has a single source of truth in
   `.claude-plugin/plugin.json`, mirrored into four other files by
   `scripts/bump-version.ts`; `bun run version:check` is what detects drift.
   Version bumps happen automatically on merge to `main` — see `RELEASING.md`
   — never by hand in a contribution.

## Scope notes

- If your change touches `skills/*/SKILL.md`, a persona body, or a hiring
  brief, read `skills/authoring-rules/SKILL.md` first — rule-writing is a
  product deliverable in this repo, not incidental prose.
- Cross-repo concerns (the `agentop` binary this repo consumes from
  `agentistics`, or the `parity-driven-development` marketplace plugin
  `src/toolbox/pdd.ts` installs) are out of scope for a PR to this
  repository — open the issue against the relevant repo instead.

## Code of conduct

Participation in this project is governed by the
[Code of Conduct](CODE_OF_CONDUCT.md).
