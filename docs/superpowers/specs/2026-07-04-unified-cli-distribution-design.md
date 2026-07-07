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

6. **Delivery via a custom domain.** `AIPE_DOWNLOAD_BASE` defaults to
   `https://aipe.openvibes.tech/cli` (a Cloudflare redirect to the release
   assets built by `.github/workflows/release.yml`). `scripts/install.sh`
   (`curl … | sh`) and `install.ps1` fetch the right binary onto `$PATH`.

7. **`aipe start` — project-scoped, per-harness install.** An interactive
   command (run inside the project folder) that installs the harness
   integration into the **workspace**, not globally. For Claude Code it writes
   a purely project-scoped setup: `.claude/settings.json` with a `SessionStart`
   hook that calls the on-PATH `aipe session-context`, plus the onboarding
   skills. The skill contents are embedded in the binary as text imports (they
   survive `--compile`), so no marketplace/global plugin and no source checkout
   are needed. Cursor/generic harnesses are scaffolded as "coming soon".

8. **Awareness lives in the binary.** The coordinator-awareness logic moved out
   of the bash hook into `aipe session-context` (single source of truth, pure +
   unit-tested). Both the plugin's bash hook and the installed
   `.claude/settings.json` hook delegate to it, and any other harness can reuse
   it. Onboarding is coordinator-driven: the hook tells the coordinator to start
   each step itself and, on completion, to ask the PE to open a new session for
   the next step.

## 3. Out of scope / open

- The *final* binary-delivery channel (GitHub Releases + download-on-first-run
  is implemented, but committing via Git LFS or a package-manager install were
  not pursued). See `OPEN-DECISIONS.md`.
- Install UX for non-Claude harnesses beyond "put `aipe` on `$PATH`". See
  `OPEN-DECISIONS.md`.
- `--bytecode` compilation (faster cold start) — not enabled; portability
  favored over the marginal startup win.
