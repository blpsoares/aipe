# Dossier 06 — Unified `aipe` CLI + zero-dependency distribution

**Status:** Implemented on `claude/project-understanding-review-66rt1w`.
**Spec:** `docs/superpowers/specs/2026-07-04-unified-cli-distribution-design.md`

## Purpose

Remove the two install-time frictions the plugin imposed — requiring Bun on
`$PATH` and a prior `bun install` — so AIPe can be used by **anyone, in any
agent harness, on any OS, with zero runtime dependency**. This was a PE
directive during the `/hire-specialists` cycle, applied across all sub-projects.

## Key decisions

1. **One `aipe` CLI with subcommands** (`context-brain`, `make-workspace`,
   `relationship`, `hire-specialists`, `read-state`). Each module's `cli.ts`
   now exports a pure `run(args): Promise<number>`; `src/cli.ts` is the sole
   entry point and the sole compile target.
2. **Standalone binaries via `bun build --compile`** bundle the Bun runtime +
   code + the `yaml` dependency — no Bun/Node/npm, no `bun install` on the host.
3. **Cross-platform** (linux/darwin/windows × x64/arm64) built from one Linux
   runner (`scripts/build.ts`), output to `dist/` (gitignored; binaries are
   release assets, ~95 MB each, never committed).
4. **Launcher shim** `bin/aipe` (POSIX) + `bin/aipe.cmd` (Windows) resolves the
   right binary: `$AIPE_BIN` → `dist/aipe-<host>` → cached download → Bun dev
   fallback (repo-development only) → best-effort download from the GitHub
   release.
5. **Harness-agnostic core.** The Claude Code skills + `SessionStart` hook are
   one adapter over the CLI; the hook now calls `aipe read-state` and every
   skill calls `<plugin>/bin/aipe <subcommand>`. Any other harness just calls
   the binary.
6. **Delivery via GitHub Releases** (`.github/workflows/release.yml`): a `v*`
   tag builds all targets, writes `SHA256SUMS`, and attaches them — the source
   the launcher downloads from.

## Execution & review findings

- Refactored the four existing `cli.ts` files + `read-state.ts` to export
  `run(args)` behind `if (import.meta.main)` guards; added `src/cli.ts`
  dispatcher with `--version`/`--help`.
- Renamed the `state.yaml` phase `generator` → `specialists` across the shared
  `StateFile` type, `initialState`, the hook (`PHASE_SPECIALISTS`), and every
  affected test (committed separately, `aff3fe9`).
- Verified the compiled binary behaves identically to the source: a full
  `hire-specialists` flow (resolve-names → simulated reports → materialize)
  run through `./bin/aipe` writes the same artifacts as `bun src/cli.ts`. The
  Bun dev fallback (dist absent) and the `$AIPE_BIN` override both work.
- Hook tests (14/14) pass with the hook rewired to `aipe read-state`,
  confirming the launcher resolves correctly when spawned by the hook.

**Known limitation (accepted, tracked in `OPEN-DECISIONS.md`):** the
download-from-release path in the launcher and the release workflow are
implemented but cannot be end-to-end tested until a real `v0.1.0` release is
published. Cross-compiling non-host targets was not exercised in the sandbox
(each downloads a ~90 MB target runtime); the host target (`linux-x64`) builds
and runs, and the script/targets are otherwise standard.

## Final state

Branch `claude/project-understanding-review-66rt1w`. Commits `4fa9088`
(unify CLI), `5ec0194` (compile + launcher), `b7f1ae6` (hook/skills rewire),
`3281c38` (release workflow). Repo-wide: **116 pass / 1 fail** (the same
environment-only git-remote test noted in dossier 05), `bunx tsc --noEmit`
clean.
