# Open decisions — for the PE

Things I did **not** decide alone. None block the current build (everything
implemented is tested and committed); these are forks where your input changes
direction. Updated after your install/onboarding clarifications.

## Resolved by you (now implemented)

- **Binary delivery = a custom domain.** The launcher and installers fetch from
  `AIPE_DOWNLOAD_BASE`, default `https://aipe.blpsoares.dev/cli` (your
  Cloudflare redirect). Install via `curl -fsSL https://aipe.blpsoares.dev/cli | sh`.
  → **You still need to create the Cloudflare rules** (see "Cloudflare setup"
  below) and cut a `v0.1.0` release so the redirect targets exist.
- **Onboarding is coordinator-driven, one step per session.** Implemented in
  the SessionStart hook: the coordinator starts each step itself when the PE
  greets it, then announces completion and asks the PE to open a new session
  for the next step. Just opening the workspace and saying "hi" is enough —
  no slash commands after the first.

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

### 2. Division of labor: `aipe start` vs. the initial skill

You said the initial **skill** asks the workspace name and creates the
`aipe-<name>` folder. But `aipe start` (terminal) also "installs into the
workspace folder". So which creates the folder?
- My current assumption: `aipe start` installs the harness integration into the
  **current** project folder; then, in-harness, the `/context-brain` skill asks
  the workspace **name** and creates `aipe-<name>/` (writing the brain there).
  Confirm, or tell me if `aipe start` itself should create `aipe-<name>/`.

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

## Cloudflare setup (for the download domain to work)

Once a GitHub release exists with the built assets, point the redirects at it:
- `aipe.blpsoares.dev/cli` (exact) → the raw `install.sh`
  (e.g. the release asset or `raw.githubusercontent.com/.../scripts/install.sh`).
- `aipe.blpsoares.dev/cli/install.ps1` → the raw `install.ps1`.
- `aipe.blpsoares.dev/cli/aipe-<os>-<arch>[.exe]` → the matching release asset
  (labels: `linux-x64`, `linux-arm64`, `darwin-x64`, `darwin-arm64`,
  `windows-x64.exe`).

---

*Everything above is safe to defer. The onboarding pipeline (steps 1–4) is
complete and green; the plugin runs today via the compiled binary or the Bun
dev fallback.*
