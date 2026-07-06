# Releasing AIPe

Everything here is prepared so a release is copy-paste. The one step that needs
the PE and is **not** done by any session is pushing the tag (a session has no
tag-push permission). The download domain is decided: **`openvibes.tech`** (the
open-source umbrella), overridable at runtime via `AIPE_DOWNLOAD_BASE`.

## What's automated

- `bun run version:check` — asserts the version in `.claude-plugin/plugin.json`
  (the single source of truth) matches `src/cli.ts`, `bin/aipe`, `bin/aipe.cmd`,
  and `scripts/install.sh`. Run before every release; also runs in CI.
- `.github/workflows/release.yml` — on a `v*` tag (or manual dispatch) it:
  1. runs `version:check`,
  2. asserts the tag equals `v<manifest version>`,
  3. type-checks + tests,
  4. cross-compiles all five standalone targets (`bun run scripts/build.ts`),
  5. writes `SHA256SUMS.txt`,
  6. publishes a GitHub Release with the binaries + `install.sh`/`install.ps1`
     + checksums, and auto-generated notes.

## Cutting a release (PE)

1. **Pick/confirm the version.** To bump, edit `.claude-plugin/plugin.json`
   `version`, then propagate it to the four other files (or keep them in sync by
   hand) and verify:
   ```sh
   bun run version:check      # must print "in sync"
   bun test && bun run typecheck
   ```

2. **Merge to `main`.** `scripts/install.sh` must be reachable at the raw GitHub
   URL used by the download domain — that alone needs `main`, not a release.

3. **Cut the release (needs tag-push permission — the PE, not a session):**
   ```sh
   git tag v0.1.0            # must match the manifest version exactly
   git push origin v0.1.0
   ```
   CI builds every target and publishes the release. (Or trigger the
   `release` workflow manually with the tag as input.)

## Download domain

The launcher (`bin/aipe`, `bin/aipe.cmd`) and installers (`scripts/install.sh`,
`scripts/install.ps1`) fetch binaries from `AIPE_DOWNLOAD_BASE`, which defaults to
**`https://aipe.openvibes.tech/cli`** — AIPe lives under the `openvibes.tech`
open-source umbrella (authored by [blpsoares.dev](https://blpsoares.dev)). Set
`AIPE_DOWNLOAD_BASE` to point at a mirror or a local server.

Cloudflare rules on `openvibes.tech` (repo slug `blpsoares/aipe`; use
`releases/latest/download` so they never need touching on future releases):

| Incoming (exact/path)                    | Redirect target                                                              |
|------------------------------------------|------------------------------------------------------------------------------|
| `aipe.openvibes.tech/cli`                 | `raw.githubusercontent.com/blpsoares/aipe/main/scripts/install.sh`          |
| `aipe.openvibes.tech/cli/install.ps1`     | `raw.githubusercontent.com/blpsoares/aipe/main/scripts/install.ps1`         |
| `aipe.openvibes.tech/cli/aipe-linux-x64`  | `github.com/blpsoares/aipe/releases/latest/download/aipe-linux-x64`         |
| `aipe.openvibes.tech/cli/aipe-linux-arm64`| `github.com/blpsoares/aipe/releases/latest/download/aipe-linux-arm64`       |
| `aipe.openvibes.tech/cli/aipe-darwin-x64` | `github.com/blpsoares/aipe/releases/latest/download/aipe-darwin-x64`        |
| `aipe.openvibes.tech/cli/aipe-darwin-arm64`| `github.com/blpsoares/aipe/releases/latest/download/aipe-darwin-arm64`     |
| `aipe.openvibes.tech/cli/aipe-windows-x64.exe`| `github.com/blpsoares/aipe/releases/latest/download/aipe-windows-x64.exe` |

**Order matters:** publish the release first (step 3), *then* create the rules —
they are redirects to release assets and 404 until the assets exist.

## Verify

```sh
curl -fsSL https://aipe.openvibes.tech/cli | sh   # installs the binary onto PATH
aipe --version                                    # prints the released version
```

Anyone can also skip the domain entirely and pull straight from the GitHub
release, or build locally with `bun run build:host`.
