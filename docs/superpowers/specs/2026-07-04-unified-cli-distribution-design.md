# Unified `aipe` CLI + zero-dependency distribution — design spec

**Date:** 2026-07-04
**Status:** Implemented (branch `claude/project-understanding-review-66rt1w`)
**Depends on:** every prior sub-project's `src/<name>/cli.ts` (context-brain,
make-workspace, relationship, hire-specialists) and `src/session-hook/read-state.ts`.

---

## 1. Motivation

Until now every onboarding step shipped as its own `bun src/<name>/cli.ts`
entry point, and the `SessionStart` hook shelled out to `bun`. That imposed
**two frictions on anyone installing the plugin**: they needed Bun on `$PATH`,
and they needed to have run `bun install` (for the `yaml` dependency).

The goal of AIPe is to be usable by **anyone, in any agent harness, on any
OS**. So the runtime dependency has to go to zero, and the portable surface
can't assume Claude Code.

## 2. Decisions

1. **One CLI, subcommands.** All steps become subcommands of a single `aipe`
   binary: `context-brain`, `make-workspace`, `relationship`,
   `hire-specialists` (with its `--resolve-names` mode), and `read-state`
   (the hook's data source). `src/cli.ts` is the only entry point;
   each module's `cli.ts` now exports a pure `run(args): Promise<number>`
   instead of running an unconditional `main()`.

2. **Compile to standalone binaries.** `bun build --compile` bundles the Bun
   runtime + code + the `yaml` dep into one executable per OS/arch. End users
   need **no Bun, Node, or npm, and no `bun install`**.

3. **Cross-platform from one runner.** Bun cross-compiles all targets
   (linux/darwin/windows × x64/arm64) from a single Linux CI runner.
   `scripts/build.ts` drives it; output lands in `dist/` (gitignored — the
   ~95 MB × N binaries are release assets, never committed).

4. **A launcher shim resolves the right binary.** `bin/aipe` (POSIX) and
   `bin/aipe.cmd` (Windows) are what the hook and skills call. Resolution
   order: `$AIPE_BIN` → `dist/aipe-<host>` → cached download →
   **Bun dev fallback** (`bun src/cli.ts`, only when developing in this repo)
   → best-effort download of the matching binary from the GitHub release.

5. **Harness-agnostic core.** The CLI depends on nothing Claude-specific. The
   Claude Code skills + hook are one adapter; any other harness only needs to
   call the `aipe` binary and read its `OK/MISSING/STATE` / `read-state`
   output.

6. **Delivery = GitHub Releases.** `.github/workflows/release.yml` builds every
   target on a `v*` tag, writes `SHA256SUMS`, and attaches them to the
   release — the source the launcher downloads from.

## 3. Out of scope / open

- The *final* binary-delivery channel (GitHub Releases + download-on-first-run
  is implemented, but committing via Git LFS or a package-manager install were
  not pursued). See `OPEN-DECISIONS.md`.
- Install UX for non-Claude harnesses beyond "put `aipe` on `$PATH`". See
  `OPEN-DECISIONS.md`.
- `--bytecode` compilation (faster cold start) — not enabled; portability
  favored over the marginal startup win.
