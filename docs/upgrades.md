# Upgrades & releases

Two halves of one loop: how a release gets cut (automatic, from `main`) and how
an installed `aipe` moves onto it (`aipe upgrade`, which also puts the machine
back the way it found it).

Release mechanics for maintainers live in [`RELEASING.md`](../RELEASING.md).
This document is the runtime side.

## For users

```sh
aipe upgrade        # the whole job, in one command
aipe check-update   # silent when current; prints a banner when not
```

Every `aipe` command also notices a new release and offers the upgrade, unless
stdout is not a TTY (hooks, pipes, CI) or `AIPE_NO_UPDATE_CHECK` is set.

### What `aipe upgrade` actually does

1. **Resolve.** Ask GitHub for the published releases and compare with the
   installed version.
2. **Gate on platform/arch.** Refuse *before* downloading anything if no binary
   is published for this host — downloading the x64 build onto an arm64 box
   would replace a working binary with one the kernel cannot exec.
3. **Download and verify.** Size, executable magic (ELF / Mach-O / PE), and
   then the strongest cheap check there is: run the downloaded file and make it
   identify itself with `--version`.
4. **Back up, then swap.** The working binary is moved to `<binary>.bak` first
   — that is the rollback copy — and the verified file is renamed into place.
   A post-install check runs at the final path; anything wrong restores the
   backup.
5. **Apply.** Run `aipe rehydrate` in every workspace this machine knows about,
   and restart every running `aipe serve` console, both driven through the
   **new** binary.

Exit code is `0` only when all five happened. A rehydrate or restart that
failed is reported item by item, because "installed" and "in effect" are not
the same thing and claiming the second while only the first is true is how a
bad upgrade hides.

### Why not `curl … | sh`

That is what `aipe upgrade` used to do, and it is broken by construction:
`install.sh` writes with `curl -o ~/.local/bin/aipe`, which truncates the
executable you are currently running. The observable failure is

```
curl: (23) Failure writing output to destination
```

— ETXTBSY, with the binary left half-written. Staging beside the target and
renaming avoids it entirely: a rename over a running executable is safe (the
old inode stays mapped until the process exits) and atomic (there is no moment
where `aipe` is a partial file).

The installer script is still the right tool for a **first** install, and for a
source checkout — where `process.execPath` is the Bun runtime, and installing
over it would clobber the user's `bun` rather than aipe. `aipe upgrade` detects
that case and delegates.

### What "apply" restarts, and how it knows

`~/.aipe/` holds the machine-level state that makes this possible:

| Path | Holds |
|---|---|
| `workspaces.json` | Workspaces seen on this machine (recorded by any command run in one, throttled to once an hour) |
| `serve/<pid>.json` | One entry per live `aipe serve`, removed on every exit path |
| `upgrade.lock` | Held for the whole install, so two upgrades cannot interleave |
| `upgrade-failure.json` | Consecutive failures per target version, for the backoff |
| `auto-upgrade.log` | Output of an unattended critical install |

A workspace whose `.aipe/` is gone is dropped from the answer rather than
producing a failure; a `serve` entry whose process is dead is deleted as it is
found.

### Critical releases

A release whose notes contain a line consisting only of `[critical]` (outside
any code fence) is flagged critical. By default that only makes the banner
louder. Set `AIPE_AUTO_UPGRADE=1` to let such a release install itself in a
detached background process, logged to `~/.aipe/auto-upgrade.log`.

Unattended install is opt-**in**, deliberately. The install path is hardened,
but flipping this default does not inconvenience one user — it reaches every
install that opens a terminal.

### Update checks never block a prompt

`check-update` reads its verdict from a shared cache and refreshes it in a
detached process. The two verdicts do not expire at the same rate, and that
asymmetry is the point:

| Verdict | TTL | Why |
|---|---|---|
| "an update exists" | 3h | Stale costs nothing — the release still exists and the banner keeps saying the same true thing |
| "you are up to date" | 30min | Stale is the machine telling you you are current while a release sits there, *silently* |

Refresh **attempts** are additionally spaced 15 minutes apart, so twenty shells
opening at once — or an offline machine — never become twenty GitHub calls.

### Environment variables

| Variable | Effect |
|---|---|
| `AIPE_NO_UPDATE_CHECK=1` | No update checks at all |
| `AIPE_AUTO_UPGRADE=1` | Let a `[critical]` release install itself unattended |
| `AIPE_DOWNLOAD_BASE` | Where binaries are fetched from (default `https://aipe.openvibes.tech/cli`) |
| `AIPE_HOME` | Machine state directory (default `~/.aipe`) |

## For maintainers

Releases are automatic: merging to `main` computes the next version from the
conventional-commit subjects since the last tag, stamps it onto the five files
that hardcode it, builds all five targets, tags and publishes.

Nobody pushes a tag by hand. The full procedure — including the version
single-source-of-truth, the manual `workflow_dispatch` valve, and the
Cloudflare redirect rules — is in [`RELEASING.md`](../RELEASING.md).
