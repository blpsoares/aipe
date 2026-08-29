# Releasing AIPe

**Releases are automatic.** Merging to `main` cuts one — `dev` never does.
Nobody bumps a version by hand and nobody pushes a tag — the two steps that
used to need the PE (and tag-push permission a session does not have) are now
the workflow's job.

The download domain is **`openvibes.tech`** (the open-source umbrella),
overridable at runtime via `AIPE_DOWNLOAD_BASE`.

## What happens on a merge to `main`

`.github/workflows/release.yml` runs and:

1. **Skips its own bump commit.** The workflow commits `chore(release): vX.Y.Z`
   to `main`; without this guard that push would trigger it again, forever.
2. Runs `bun run version:check`, `bun run typecheck`, `bun test`.
3. **Computes the next version** from the conventional-commit subjects since the
   last `v*` tag: a `!` or `BREAKING CHANGE` → major, any `feat` → minor, else
   patch. Scopes count — `feat(session): …` is a feature, not a patch. If there
   are no new commits since the last tag it stops here.
4. Takes the **higher** of that number and the version already in
   `.claude-plugin/plugin.json`, so a deliberate bump committed to the manifest
   (0.3.x → 1.0.0, say) wins over tag arithmetic that would walk it back.
5. Stamps the version onto all five files with `bun run scripts/bump-version.ts`
   and re-verifies with the same reader `version:check` uses.
6. Cross-compiles all five standalone targets, boots the Linux binary and
   asserts `--version` prints the version being released.
7. Writes `SHA256SUMS.txt`.
8. Commits the bump, tags `vX.Y.Z`, pushes both.
9. Publishes the GitHub Release with the binaries + `install.sh`/`install.ps1` +
   checksums and generated notes.

`concurrency: release-main` serialises runs: two at once would each compute a
version from a tag the other has not pushed yet.

## `dev` never releases

Every push to `dev` runs `ci.yml` — the same gate a PR runs — but `dev` is
deliberately absent from `release.yml`'s trigger (`on: push: branches:
[main]` only). Work accumulates on `dev` and is verified continuously; a
release only happens when a promotion PR merges `dev` into `main`.

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

## Branch protection on `main` — pending

`main` has no branch protection today; a direct push from anyone with write
access still works. The plan, once enabled, is a ruleset requiring an open
PR with `ci.yml`'s `check` run green before merging, with a standing bypass
— because step 8 above (commit the bump, tag, push both) pushes directly to
`main`, outside a PR, right after the promotion PR itself was already
gated. Without that bypass, turning on "require PR" would break this
workflow the first time it ran after being enabled.

That bypass is a `RepositoryRole` actor (`actor_id: 5`, admin) with
`bypass_mode: always` — **not** an `Integration` actor for the
`github-actions` app. This repository is personal, not org-owned, and
GitHub rejects an `Integration` bypass actor on a personal repo's ruleset
with `422 Validation Failed: Actor GitHub Actions integration must be part
of the ruleset source or owner organization` — confirmed by hand against
this repo, not a guess. The workflow's default `GITHUB_TOKEN` push is
authorized through the admin-role bypass instead.

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
