# Consolidate: package model + web console UX + SDD/PDD kits — design spec

**Status:** approved-in-principle (PE: blpsoares) · **Branch:** `feat/consolidate-package-sdd`
**Base:** `claude/aipe-web-console-aownq8` (the rich line — web console, detect, rich unit model).

## Problem

The v0.1.0 release (cut from `main`) is missing finished, tested work that lives on an
unmerged branch: the **web console** (`aipe serve`), `detect-modules`, `toolbox uninstall`,
and the **spec-first + specialist-SDD** operation flow. The two lines also **forked on the
monorepo-unit data model**:

- **Rich (branch, 2026-07-05):** units declared up front in the brain — `{ name, path,
  group, kind }`; web console + detect depend on it.
- **Simple (`main`, 2026-07-06):** units discovered late in `relationship`, keyed by `id` +
  `repo/module` fqid.

The rich model is required for the org-chart grouping and detect the PE wants, so it is
**canonical**. `main`'s simpler model is superseded.

## Decisions (locked with the PE)

1. **Canonical unit model = the rich one** (`name`/`path`/`group`/`kind`).
2. **Rename `module` → `package`** everywhere (domain, CLI, web). A "package" = any
   workspace member (pnpm/turbo sense), regardless of folder: `packages/cli`, `apps/web`,
   `services/billing`. `path` holds the real folder; `kind` (api|web|lib|service) the type.
   - `ModuleEntry → PackageEntry`, `modules → packages`, fqid `repo/package`,
     `aipe detect-modules → aipe detect-packages`.
3. **SDD is two tiers, routed by `aipe skill match`:**
   - `sdd-lite` — **AIPe-native**, always-on floor: short spec + evidence (screenshots) +
     task doc. No external runtime. Installed by default in every package.
   - `sdd` — **GitHub Spec Kit** (`/speckit.*`), for non-trivial tasks only.
4. **Spec Kit is vendored, not depended-on.** AIPe bundles the `specify init` output
   (the `.specify/` templates + `/speckit.*` command files + POSIX scripts) as binary
   assets; `aipe skill add spec-kit --repo X` materializes them. **No `uv`/Python/network.**
   Re-vendor via a build script when bumping the pinned Spec Kit version (MIT; attributed).
5. **PDD = the PE's Parity-Driven Development plugin** (`blpsoares/parity-driven-development`).
   A **routable kit for migration/parity tasks** (legacy → new), not always-on.
6. **Install UX = curated registry + automatic floor + one preset prompt:**
   - Curated registry knows `sdd-lite`, `spec-kit`, `pdd` → `aipe skill add <name>` "just
     works" (no JSON for known kits; JSON stays for custom).
   - `sdd-lite` installed automatically in every package (no prompt).
   - After `hire-specialists`, the coordinator offers **one preset**: "enable spec-kit on
     non-trivial packages + PDD on migration repos?" — PE says yes/adjusts.

## Per-package SDD execution (no heavy user interaction)

Spec Kit scaffolds **once per repo** at install. On dispatch, each specialist runs in its
own worktree (which carries `.specify/`), and its hiring brief routes it: trivial → `sdd-lite`;
non-trivial → `/speckit.specify` scoped to its package → plan → tasks → implement, committed
into its PR. **The only human gate is the existing Orientation Spec approval.** Wiring detail:
Spec Kit writes specs into the package slice without fighting AIPe's worktree/branch.

## Work streams

- **A — Integration base.** From the rich base, forward-port `main`'s unique features
  (model-policy, harness-adapter, validate-personas, version guard, release chore) + the 4
  QA fixes (coordinator wording, awareness identity, url-hallucination guard, local-path
  validator). Gate: full suite + build green. Land on `main` when green.
- **B — Rename `module → package`** across types/CLI/web/tests. Gate: suite green.
- **C — Web console UX.** Group org chart **by package** (path shown); pan + zoom; click a
  specialist → open their CV (persona detail).
- **D — SDD/PDD kits.** Vendored `spec-kit`; native `sdd-lite`; `pdd` registry entry;
  curated kit registry + `aipe skill add <known>`; default `sdd-lite`; coordinator preset
  step after `hire-specialists`.

## Non-goals (now)

- Reviving `main`'s discovered-late unit model.
- Bundling the Python `specify` CLI (vendored templates only).
- Making PDD always-on (routed by task kind).

## Carry-over QA findings (fold in, not blockers)

Install channel (mitigated: repo public), `install.sh` integrity check (SHA256SUMS unused),
misleading "run INSIDE your project folder" message.
