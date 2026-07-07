# Open decisions — for the PE

Things I did **not** decide alone. None block the current build (everything
implemented is tested and committed); these are forks where your input changes
direction. Updated after your install/onboarding clarifications.

## Resolved by you (now implemented)

- **Binary delivery = a custom domain, on `openvibes.tech`.** The launcher and
  installers fetch from `AIPE_DOWNLOAD_BASE`, default
  `https://aipe.openvibes.tech/cli` (a Cloudflare redirect to the GitHub release
  assets). Install via `curl -fsSL https://aipe.openvibes.tech/cli | sh`. The
  domain choice (open-source umbrella `openvibes.tech` over the personal portfolio
  `blpsoares.dev`) is settled; portfolio credit links back to `blpsoares.dev`.
  → The release + Cloudflare wiring is the last manual step — see "Deferred debt"
  below and `RELEASING.md`.
- **Onboarding is coordinator-driven, one step per session.** Implemented in
  the SessionStart hook: the coordinator starts each step itself when the PE
  greets it, then announces completion and asks the PE to open a new session
  for the next step. Just opening the workspace and saying "hi" is enough —
  no slash commands after the first.

## Phase B (2026-07-05) — new open items

Phase B (Operation) + portability + toolbox + `/aipe-add-repo` were built
autonomously this session. The doubts to resolve together are collected in
[`docs/NEXT-SESSION-phase-b.md`](docs/NEXT-SESSION-phase-b.md) — most notably
**MCP-config secret validation** (the toolbox catalog is published; today
secrets are kept out by convention only) and the still-pending **persona
load-order live check**.

## Still need your input

### 1. `aipe start` — which harnesses, and how it installs

Built: the `aipe start` interactive picker (emphasizes "install into the
project/workspace folder"). Claude Code is the only wired target; Cursor and
"generic" are listed as coming-soon.
- **Which harnesses should I support next, and in what order?**
- **Install mechanics:** for Claude Code, should the installer (a) copy the
  skills + hook into the project's `.claude/` and drive the hook via the
  on-PATH `aipe` binary (fully self-contained, my lean), or (b) assume AIPe is
  installed as a global Claude Code plugin? (a) is more portable across
  harnesses; confirm.

### 2. Division of labor — RESOLVED

`aipe start` (terminal, no AI) asks the harness + workspace name and creates
`aipe-<name>/` with the integration inside it (one self-contained folder). The
`/context-brain` skill no longer asks the name or creates a folder — it only
collects the coordinator name + repos. Done.

### 3. What "pegar infra" means in the initial skill

I interpreted the initial skill's job as: ask workspace name + gather the repos
(URLs/paths/stacks) = today's `/context-brain`. If "infra" means something more
(cloud/CI/secrets/env detection), tell me and I'll extend it.

### 4. Persona load-order validation (still deferred)

Needs a live interactive session (open a repo with a generated persona, invoke
a third-party skill on top, observe identity survival). I can't do it
autonomously. Want to run it together, or accept the format as-is?

### 5. Version single-source-of-truth

`0.1.0` is hardcoded in the launcher, installers, `src/cli.ts`, and
`plugin.json`. Minor; I can wire it from one place at build time if you want.

## Deferred debt — release + Cloudflare (do near the end, PE's call)

The PE will do this as one of the **last** steps, once most features are in.
Order matters: **publish the release first, then create the rules** — the rules
are just redirects to release assets, so they 404 until the assets exist.

1. **Merge to `main`** (so `scripts/install.sh` is reachable via the raw GitHub
   URL — this one does NOT need a release).
2. **Cut the release:** `git tag v0.1.0 && git push --tags`. CI
   (`release.yml`) builds every target and attaches the binaries +
   `install.sh`/`install.ps1` + `SHA256SUMS`.
3. **Create the Cloudflare rules** (use `latest/download` so they never need
   updating on future releases):
   - `aipe.openvibes.tech/cli` (exact) → raw `install.sh`
     (`raw.githubusercontent.com/blpsoares/aipe/main/scripts/install.sh`).
   - `aipe.openvibes.tech/cli/install.ps1` → raw `install.ps1`.
   - `aipe.openvibes.tech/cli/aipe-<os>-<arch>[.exe]` →
     `github.com/blpsoares/aipe/releases/latest/download/aipe-<os>-<arch>[.exe]`
     (labels: `linux-x64`, `linux-arm64`, `darwin-x64`, `darwin-arm64`,
     `windows-x64.exe`).
4. **Test:** `curl -fsSL https://aipe.openvibes.tech/cli | sh`.

Optional prep I can do before then: switch the installer to the
`latest/download` pattern and write the exact rule values, so step 3 is
copy-paste.

---

*Everything above is safe to defer. The onboarding pipeline (steps 1–4) is
complete and green; the plugin runs today via the compiled binary or the Bun
dev fallback.*
