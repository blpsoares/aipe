# Dossier 21 — Autonomous upgrade (`aipe upgrade` — execute, don't recommend)

**Status:** Merged (`e017b3d`, PR #31, 2026-08-28; journey `j-20260828-eh`).
**Spec:** [`docs/upgrade-autonomo-sdd.md`](../upgrade-autonomo-sdd.md); reference
[`docs/upgrades.md`](../upgrades.md).

## What this is for

`aipe upgrade` already downloaded, verified and swapped the binary (PR #166,
`b166129`), but when it found a workspace still on the legacy flat layout it only
**printed a recommendation** — "to move them under `repos/`: run `aipe workspace
migrate-layout`." That is the exact failure of [dossier 20](20-repos-layout-events.md)
seen from the other side: the tool recommended a migration that had bugs, and left
the actual move to a human who might never run it. This journey closes the loop —
the upgrade **executes** the migration itself. The behavioral shift lives in just
two files (`src/update/apply.ts`, 204 changed lines; `src/update/cli.ts`, 11); the
download/verify/install/critical machinery predates it and was not touched
(`git show --stat e017b3d`).

## Recommend → execute

Before, `applyUpgrade` carried a `legacyLayout: string[]` field whose own doc
comment read "DETECTED, never acted on … a silent `mv` here would be unrecoverable
and unlogged" (`e017b3d^:src/update/apply.ts:30`), and printed the recommendation
line. After, that field is gone, replaced by `migrated: MigrationOutcome[]` and
`deferredLegacy: string[]` (`src/update/apply.ts:42`); the header comment now reads
"the upgrade MIGRATES it, it no longer just prints 'you should run migrate-layout'"
(`src/update/apply.ts:10`).

This runs inside the `aipe upgrade` **command** (not SessionStart), in the
"Applying the update…" phase after the new binary is installed, and every step is
driven **through the newly-installed binary** (`bin = process.execPath`,
`src/update/cli.ts:214`). Three steps (`src/update/apply.ts:204`):

1. **Rehydrate** every known workspace.
2. **Migrate** the in-scope legacy workspace onto the `repos/` layout — the new
   autonomous act. The command run is `[bin, "workspace", "migrate-layout",
   "--apply", "--workspace", ws]` via `captureRun` (`src/update/apply.ts:171`), and
   the repo count is parsed back from migrate-layout's own `STATE
   migrate-layout=done (N repo(s), …)` line by `parseMigratedRepos`
   (`src/update/apply.ts:102`).
3. **Restart** every running `aipe serve` console — old process stopped,
   `unregisterServe`, wait for the port, respawn detached, passing the console
   token by **env, never argv** so it is not visible in `ps`
   (`src/update/apply.ts:229`).

## The safety model

- **Scope gate (the core stance).** By default it migrates **only the workspace the
  upgrade was invoked from**: `currentWorkspace = enclosingWorkspace(process.cwd())`
  (`src/update/cli.ts:212`), and `migrationTargets` returns `[]` unless
  `--migrate-all` is passed or the current workspace is the legacy one
  (`src/update/apply.ts:256`). Other legacy workspaces are **deferred and named**
  with the exact command to migrate them (`src/update/apply.ts:281`) — the tool
  does not silently rewrite workspaces the operator did not point it at.
- **Whole-upgrade lock.** `acquireUpgradeLock` covers the entire upgrade; a second
  concurrent upgrade exits early (`src/update/cli.ts:142`); the 30-minute-TTL lock
  is adopted by the detached child via `AIPE_UPGRADE_LOCK`.
- **Honest failure.** On any apply failure it exits 1 with "aipe X is installed,
  but not everything was moved onto it" and per-failure lines
  (`src/update/cli.ts:223`); each subprocess failure now surfaces its last output
  line instead of an opaque `exited 1` (`src/update/apply.ts:209`). The report
  states what was **done**, not what remains (`src/update/apply.ts:269`).
- **Critical auto-install (separate, older path).** `check-update`, the
  silent-when-current shell hook, can auto-install a `[critical]` release
  unattended via `startBackgroundUpgrade` **only if `AIPE_AUTO_UPGRADE=1`**
  (`src/update/check.ts:154`); the `[critical]` marker must own its own line. This
  predates #31.

Machine state under `~/.aipe/` (`AIPE_HOME` overrides): `upgrade.lock`,
`upgrade-failure.json` (failure memory + backoff), and `auto-upgrade.log` for the
detached critical install.

## Commands

- **`aipe upgrade [--force] [--no-apply] [--migrate-all]`** — download, verify,
  swap, then rehydrate + migrate (in scope) + restart consoles.
- **`aipe check-update [--now] [--refresh] [--verbose]`** — the update-check hook;
  auto-installs a critical release only under `AIPE_AUTO_UPGRADE=1`.

## Left open / a divergence to escalate

The SDD's scope model says the *other* legacy workspaces are reached by
"`--migrate-all` **or consent when there is a TTY**"
(`docs/upgrade-autonomo-sdd.md:94`), and the final report copy implies the same.
**The TTY-consent half does not exist in the code:** `migrationTargets`
(`src/update/apply.ts:256`) has no TTY branch and `upgrade` never checks `isTTY` or
prompts — `--migrate-all` is the sole escape hatch. This is a doc-vs-code
divergence, not a code fix I can make (I am scoped to `docs/dossie/**`); it is
recorded in the dossier's
[divergences appendix](README.md#appendix--divergences-escalated-not-cosmetic) and
escalated to the coordinator. Either the code should grow the promised TTY prompt
or the SDD should drop the claim; the dossier documents the **code's** actual
behavior (only `--migrate-all` reaches other workspaces).
