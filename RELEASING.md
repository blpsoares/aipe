# Releasing AIPe

**Releases are automatic, and `main` is never written to.** The version number
is decided and committed on `dev`; merging `dev` into `main` cuts the release.
Nobody bumps a version by hand and nobody pushes a tag — the two jobs in
`.github/workflows/release.yml` do it.

This is **path 4** (the PE's decision; the discarded alternatives are in
[`OPEN-DECISIONS.md`](OPEN-DECISIONS.md)). It exists because `main` is protected
by a ruleset the release bot cannot bypass on this personal repo, so the old
design — a direct push of the bump commit to `main` — was rejected every time
and left orphan tags. Path 4 removes the push to `main` entirely: the bump lives
on `dev`, and the release job on `main` only tags the merge commit and publishes.

The download domain is **`openvibes.tech`** (the open-source umbrella),
overridable at runtime via `AIPE_DOWNLOAD_BASE`.

## Two jobs, split by branch

### `bump` — on every push to `dev`

`dev` has no ruleset, so the bot can commit to it. On each push the `bump` job:

1. **Skips its own bump commit** (author is `github-actions[bot]` **and** the
   subject is `chore(release): …`; the commit also carries `[skip ci]`, and
   pushes made with `GITHUB_TOKEN` do not trigger workflows — three independent
   reasons it cannot loop).
2. **Computes the next version** from the conventional-commit subjects since the
   last `v*` tag: a `!` or `BREAKING CHANGE` → major, any `feat` → minor, else
   patch. Scopes count — `feat(session): …` is a feature, not a patch. If there
   are no new commits since the last tag, it stops.
3. Takes the **higher** of that number and the version already in
   `.claude-plugin/plugin.json`. This makes a deliberate manifest bump
   (0.3.x → 1.0.0) win over tag arithmetic **and** makes the accumulating bump
   monotonic: once `dev` has earned a minor, later patch commits don't undo it.
4. **Stamps the version** onto all five files with `bun run
   scripts/bump-version.ts` and re-verifies with `version:check`.
5. Commits `chore(release): vX.Y.Z [skip ci]` and pushes it to `dev`. If dev is
   already at that version there is nothing to commit — the bump has converged.
   **If the push is ever refused, the job fails loud** (`::error::` + non-zero
   exit): a computed-but-unlanded bump would make the next promotion ship the
   wrong number, so it must never fail in silence.
6. **Runs the same gate `ci.yml` runs and posts the `check` status on the bump
   commit itself.** This is not cosmetic — it is what keeps the promotion PR
   mergeable; see [The bump commit and the required `check`](#the-bump-commit-and-the-required-check)
   below.

The version therefore **lives on `dev`** and rides into `main` through the normal
promotion PR — the same gated path any other change takes. `main` is never
written to by the workflow.

### The bump commit and the required `check`

`main`'s ruleset requires the status check `check` (from `ci.yml`) on the head of
the promotion PR. That head is normally an ordinary `dev` commit that `ci.yml`
already ran on. But when the **bump commit** is the last thing on `dev`, it is
the PR head — and **nothing will ever run `ci.yml` on it**: the bump is pushed
with `GITHUB_TOKEN` (which never triggers a workflow) and carries `[skip ci]` —
the very properties that stop it from re-triggering the release workflow *also*
stop the CI workflow. Left alone, the promotion PR stays `BLOCKED` forever with
an **empty** check list — and an empty list reads as "nothing to report", not
"nothing ran". That silence is exactly how `v1.10.3`/`v1.11.0` masqueraded as
releases; here it would freeze every promotion.

So the `bump` job, right after pushing the bump, **runs the same gate `ci.yml`
runs** (`version:check`, `typecheck`, `bun test`, build-and-boot smoke) **on the
exact commit it pushed, and posts the `check` status itself** via the API
(`POST /repos/…/statuses/{sha}`, `context=check`), using `GITHUB_TOKEN`
(`permissions: statuses: write`).

- **It is legitimate, not a bypass.** The ruleset's `check` requirement stays
  fully in force. The gate genuinely executes; the status carries its real
  result. This is CI actually running and reporting on a commit the platform
  refuses to trigger a workflow for — not loosening the protection on `main`.
- **It never fails silently.** The status is posted with `always()`, deriving its
  state from the gate outcome: a **failed** gate posts a **red** `check` (visible
  on the PR) and fails the job loud (`::error::` + non-zero exit). The promotion
  is never left checkless — the list is green or red, never empty.
- **It cannot loop.** Posting a commit status triggers no workflow (nothing
  listens on the `status` event) and pushes no commit, so the bump's three loop
  guards (`[skip ci]`, bot author, `GITHUB_TOKEN`) are untouched.

The ruleset makes this possible without any repo-config change: `check` is
required by **context name only** (no `integration_id` pinned, and
`strict_required_status_checks_policy: false`), so a commit status named `check`
satisfies it exactly as a workflow check-run would.

### `release` — on every merge to `main`

By the time work reaches `main`, the manifest already carries the version the
`bump` job stamped on `dev`. The `release` job:

1. **Reads the version to publish** — the manifest (`.claude-plugin/plugin.json`),
   or the `workflow_dispatch` `version` input when forced. It computes nothing:
   `main` publishes exactly what `dev` decided.
2. **Stops if that version already has a tag** — a re-push of `main`, or a
   promotion that carried no version change, must not republish the same number.
3. Runs `version:check`, `typecheck`, `bun test`.
4. Cross-compiles all five standalone targets, boots the Linux binary and
   asserts `--version` prints the version being released.
5. Writes `SHA256SUMS.txt` and the release notes.
6. **Creates the tag and the GitHub Release together**, in one API call, from
   the **merge commit** (`github.sha`) — binaries + `install.sh`/`install.ps1` +
   checksums + notes. There is no `git tag` + `git push <tag>` that could strand
   a tag if publishing failed: **no tag exists unless its release exists.** This
   is what makes the orphan-tag bug (`v1.10.3`, `v1.11.0`) structurally
   impossible — the tag is born in the same call as the release, or not at all.

`concurrency: release-main` serialises release runs; `concurrency: bump-dev`
serialises bump runs.

## `dev` bumps but never releases

Every human push and PR merge to `dev` runs `ci.yml` (the same gate a PR runs)
and the `bump` job above. Neither publishes anything — the `release` job is gated
to `main` and to manual dispatch. Work accumulates and is verified continuously
on `dev`; a release only happens when a promotion PR merges `dev` into `main`.
The one commit `ci.yml` does **not** run on is the bump commit itself (pushed by
`GITHUB_TOKEN`, marked `[skip ci]`) — which is precisely why the `bump` job runs
that gate and posts the commit's `check` status directly, as described above.

## Who promotes `dev` → `main`, and when

The coordinator persona promotes — never a specialist, and never
automatically on every merge to `dev`. A promotion PR goes out when either:

- at least one complete feature has landed on `dev`, or
- there's a fix the PE needs to consume with urgency.

Green CI on `dev` is a precondition for promoting, not the trigger — the
point is bundling related, verified work into one release with actual
content. The alternative, releasing on every merge, is what produced five
releases in a single day for this repository, several of them a single
feature sliced across patch bumps. `agentistics` set the precedent: the
coordinator held one commit's promotion until two more specialists' work
landed alongside it, shipping one release instead of three.

### The command: `aipe release promote`

Promotion is a command now, not hand-craft — and, more importantly, so is
**knowing it actually published**. The failure this exists to end is the one
that left the Kanban and the Report stuck on `dev` while the PE watched a
1.12.1 console and concluded they were never built: a promotion that *looked*
done because a workflow exited 0, when nothing had actually shipped.

```sh
aipe release promote                 # READ-ONLY: what would promote, and is it already published?
aipe release promote --execute       # open+merge the dev→main PR, then VERIFY publication
aipe release promote --json          # machine-readable
```

- **Read-only by default.** With no `--execute` it writes nothing: it reads the
  version the bump job stamped on `dev`, asks the **published registry** (the
  `v*` tag on the remote **and** a live, non-draft GitHub Release) whether that
  version is out, and reports. Promotion itself stays the coordinator's
  authority — a specialist runs the read-only form to see where things stand.
- **Its success is drawn from the registry, never from an exit code.** Under
  `--execute` it opens and merges the promotion PR (branch protection stays in
  force — `gh pr merge` refuses an un-green branch), then **polls the registry
  until the tag and live release exist**, up to `--timeout` (default 600s). It
  returns success **only** when the registry confirms; if the deadline passes
  without confirmation it says so plainly and **fails** (`STATE=unestablished`,
  non-zero). A merged PR is not a publication.
- **A fact it cannot read is never assumed.** If the registry can't be reached
  (gh unauthenticated, a network failure), the verdict is `unverifiable`, not
  `published` — the command declines to claim what it could not establish.
- **It refuses to promote on a drifting lockfile.** Before acting it runs `bun
  install --frozen-lockfile` — the exact CI enforcement — so lock drift the
  release would otherwise introduce is caught here, named, and blocked, instead
  of exploding as a red `check` on the next unrelated PR.

## Branch protection on `main` — active, and path 4 works *with* it

`main` **is** protected by an active repository ruleset, **"Require PR + green CI
on main"** (id `21821077`), scoped to `refs/heads/main`. It requires:

- changes to arrive **through a pull request**, and
- the `check` status (from `ci.yml`) to be **green**,

and it blocks `deletion` and `non_fast_forward`. This gates the promotion PR
from `dev` — the good part — and the release workflow now **never fights it**,
because the workflow never writes to `main`.

That is the whole reason for path 4. The old design pushed the bump commit
**directly** to `main`, outside any PR, and the ruleset rejected it:

```
remote: error: GH013: Repository rule violations found for refs/heads/main.
remote: - Changes must be made through a pull request.
remote: - Required status check "check" is expected.
 ! [remote rejected] HEAD -> main (push declined due to repository rule violations)
```

**No bypass could have saved it on this repo.** The ruleset carries a
`RepositoryRole` bypass actor (`actor_id: 5`, admin, `bypass_mode: always`), and
an earlier version of this document claimed the workflow's `GITHUB_TOKEN` push
was "authorized through the admin-role bypass." **That claim was false** — runs
`33274404519` (→ orphan `v1.10.3`) and `33283748102` (→ orphan `v1.11.0`) both
ran *after* the ruleset and its admin bypass were created, and both were
rejected with the message above. A `RepositoryRole` bypass applies to human
collaborators/teams holding that role, **not** to the Actions bot's
`GITHUB_TOKEN`. The only actor type that would cover the bot is an `Integration`
(the GitHub Actions app) — and GitHub **rejects an `Integration` bypass actor on
a personal repo's ruleset** with `422 Validation Failed: Actor GitHub Actions
integration must be part of the ruleset source or owner organization`. So on
this personal repo there is **no valid way to grant the default `GITHUB_TOKEN` a
ruleset bypass** — "just add a bypass for the bot" was never a real option.

Path 4 sidesteps the whole problem: the bump lands on `dev` (unprotected), and
the `release` job on `main` only reads the manifest, tags the merge commit, and
publishes. The protected branch is never pushed to, so the ruleset stays fully
intact with **no bypass, no PAT, and no per-release PR**.

## Version single source of truth

`.claude-plugin/plugin.json` holds the version; four other files hardcode it
(`src/cli.ts`, `bin/aipe`, `bin/aipe.cmd`, `scripts/install.sh`). One list —
`REFS` in `scripts/version.ts` — is shared by the writer
(`scripts/bump-version.ts`) and the guard (`bun run version:check`), so the two
can never disagree about which files to touch.

```sh
bun run version:check              # assert every file agrees
bun run scripts/bump-version.ts 1.1.0   # stamp a version onto all of them
```

## Forcing a specific version

The manual valve, for the one case the computation has no answer for: it got the
number wrong. Run the `release` workflow via **workflow_dispatch** with
`version: 1.1.0`. A forced version skips the tag arithmetic, the "no new
commits" stop and the bump-commit guard entirely — a corrective release exists
precisely because the automatic answer was wrong.

## Marking a release critical

Put a line containing only `[critical]` in the release notes (outside any code
fence). `aipe check-update` then prints the loud banner instead of the ordinary
one, and installs the release unattended on machines that opted in with
`AIPE_AUTO_UPGRADE=1`. The marker lives in the **body**, never in the tag — the
tag has to stay pure semver or the release stops being recognised.

## How users get it

```sh
aipe upgrade   # downloads, verifies, swaps, rehydrates every workspace,
               # restarts every running `aipe serve`
```

First install (or a machine with no `aipe` yet):

```sh
curl -fsSL https://aipe.openvibes.tech/cli | sh
```

## Download domain

The launcher (`bin/aipe`, `bin/aipe.cmd`), the installers
(`scripts/install.sh`, `scripts/install.ps1`) and the self-upgrade
(`src/update/install.ts`) all fetch from `AIPE_DOWNLOAD_BASE`, defaulting to
**`https://aipe.openvibes.tech/cli`**.

Cloudflare **Redirect Rules** on `openvibes.tech` (repo slug `blpsoares/aipe`).
Seven rules, all `URI Full URL` `equals` → `Static` 302 with *Preserve query
string* on. Everything routes through `releases/latest/download`, so the rules
never need touching on future releases:

| Rule name | Incoming (URI Full URL equals) | Redirect target |
|-----------|--------------------------------|-----------------|
| `aipe-cli-install-sh`  | `https://aipe.openvibes.tech/cli`                    | `https://github.com/blpsoares/aipe/releases/latest/download/install.sh` |
| `aipe-cli-install-ps1` | `https://aipe.openvibes.tech/cli/install.ps1`        | `https://github.com/blpsoares/aipe/releases/latest/download/install.ps1` |
| `aipe-bin-linux-x64`   | `https://aipe.openvibes.tech/cli/aipe-linux-x64`     | `https://github.com/blpsoares/aipe/releases/latest/download/aipe-linux-x64` |
| `aipe-bin-linux-arm64` | `https://aipe.openvibes.tech/cli/aipe-linux-arm64`   | `https://github.com/blpsoares/aipe/releases/latest/download/aipe-linux-arm64` |
| `aipe-bin-darwin-x64`  | `https://aipe.openvibes.tech/cli/aipe-darwin-x64`    | `https://github.com/blpsoares/aipe/releases/latest/download/aipe-darwin-x64` |
| `aipe-bin-darwin-arm64`| `https://aipe.openvibes.tech/cli/aipe-darwin-arm64`  | `https://github.com/blpsoares/aipe/releases/latest/download/aipe-darwin-arm64` |
| `aipe-bin-windows-x64` | `https://aipe.openvibes.tech/cli/aipe-windows-x64.exe` | `https://github.com/blpsoares/aipe/releases/latest/download/aipe-windows-x64.exe` |

## Verify a release

```sh
curl -fsSL https://aipe.openvibes.tech/cli | sh   # installs the binary onto PATH
aipe --version                                    # prints the released version
```

Anyone can also skip the domain and pull straight from the GitHub release, or
build locally with `bun run build:host`.
