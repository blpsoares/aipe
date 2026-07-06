# Dossier 10 — Release + distribution readiness

**Status:** Prepared on `claude/aipe-finalize-i6443p` (frente 3 of 4). The two
PE-owned steps — the download domain and the tag push — are intentionally left
to the PE (see "Left to the PE").

## Context

The distribution machinery already existed (dossier 06): a unified `aipe` CLI,
`scripts/build.ts` cross-compiling five standalone targets, `bin/aipe` +
`bin/aipe.cmd` launchers with a resolution ladder, `scripts/install.sh` +
`install.ps1`, and `.github/workflows/release.yml`. This frente audited all of
it for a v1 release and closed the one real gap (version drift) plus wrote the
runbook, without touching the PE-owned decisions.

## What was verified

- **All 5 cross-compile targets build** here (`bun run scripts/build.ts`):
  linux-x64/arm64, darwin-x64/arm64, windows-x64.exe — so the release workflow
  will produce every asset. (Cross-compiling downloads the per-target Bun
  runtime, which needs network — CI has it.)
- **`bin/aipe` resolution ladder** and the compiled binary run every subcommand
  (exercised throughout frentes 1–2 via the compiled `dist/aipe-linux-x64`).
- Version was consistent at `0.1.0` across all references.

## What shipped

- **`scripts/version.ts` + test (`bun run version:check`).** The version is
  hardcoded in five places; the plugin manifest (`.claude-plugin/plugin.json`)
  is the single source of truth and the guard asserts `src/cli.ts`, `bin/aipe`,
  `bin/aipe.cmd`, and `scripts/install.sh` all match it. Closes OPEN-DECISIONS
  item 5 (version SoT) without a build-time codegen step — a guard is enough and
  can't silently drift.
- **`release.yml` hardened.** Before building it now (1) runs `version:check`
  and (2) asserts the pushed tag equals `v<manifest version>`, so a mistagged or
  drifted release fails fast instead of publishing wrong artifacts.
- **`RELEASING.md`.** A copy-paste runbook: version bump + `version:check`, merge
  to `main`, tag + push, the **exact** Cloudflare `latest/download` rules (repo
  slug `blpsoares/aipe`), and the verify curl. Consolidates the release steps
  that were scattered in `OPEN-DECISIONS.md`.

**Verification:** repo-wide 213 pass / 1 known env-only fail; `tsc` clean;
`version:check` in sync; `build:host` OK; all 5 targets cross-compile.

## Left to the PE (unchanged by this session)

1. **Download domain — still the PE's call.** `blpsoares.dev` is the committed
   default (and is recorded as chosen in `OPEN-DECISIONS.md`); the open fork is
   whether to keep it or switch to `openvibes.tech`. Switching is a single
   find/replace across `bin/aipe`, `bin/aipe.cmd`, `scripts/install.sh`,
   `install.ps1`, `README.md`, `RELEASING.md`. This session did **not** change
   the domain — it only made the runbook concrete for the current default and
   documented the switch. (The finalization session tried to confirm this
   interactively but the session was non-interactive, so nothing was changed.)
2. **Publishing the tag/release.** A session has no tag-push permission. The PE
   runs `git tag v0.1.0 && git push origin v0.1.0` (after merge to `main`); CI
   does the rest. Then create the Cloudflare rules (release first, rules second).
