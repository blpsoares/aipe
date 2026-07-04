# Open decisions — for the PE

Things I deliberately did **not** decide on my own during the autonomous run.
None of these block the current build (everything is implemented, tested, and
committed); they're forks where your input changes the direction. Ordered by
how soon they matter.

## 1. Binary delivery channel (the last mile of "zero dependency")

**Implemented:** the launcher (`bin/aipe`) downloads the right binary from a
**GitHub Release** on first run, and `.github/workflows/release.yml` builds and
attaches all targets on a `v*` tag. This satisfies "any OS, no runtime deps"
**once a release exists**.

**What I need from you:** confirm GitHub Releases is the channel, or pick
another:
- **GitHub Releases + download-on-first-run** (current). Needs `curl`/`wget` +
  network once; no binaries in git. ← my recommendation.
- **Commit binaries via Git LFS** — works offline, but ~95 MB × 5 targets and
  an LFS dependency.
- **Package managers** (Homebrew tap, `npm` wrapper, `curl | sh` installer) —
  best UX per ecosystem, more infra to maintain.

To cut the first release once you approve: tag `v0.1.0` and let CI publish, or
run `bun run build` locally and upload `dist/*` manually.

## 2. Load-order validation for personas (deferred from sub-project 5)

Design spec §8 wants an empirical check: open a **real interactive session**
inside a repo that has a generated persona, invoke a third-party skill
(e.g. `superpowers:brainstorming`) on top, and observe whether the persona
identity survives. I couldn't do this autonomously (needs a live session). The
persona format is built and unit-tested; only the human-in-the-loop
observation is outstanding. **Want me to walk you through running it, or should
we accept the format as-is?**

## 3. "Any harness" install UX beyond Claude Code

The CLI is harness-agnostic and the Claude Code adapter (skills + hook) is
done. For *other* harnesses we've only defined "call the `aipe` binary". Open
question: do you want first-class adapters for specific harnesses (e.g. a
generic MCP server exposing the subcommands, a plain `aipe onboard` wizard for
bare terminals), and if so, which harnesses to target first?

## 4. Historical planning docs still show the old `generator` phase token

I renamed the skill name `context-brain-generator` → `hire-specialists`
**everywhere**, and the live code + the canonical foundation spec now use the
`specialists` phase. But the older, dated per-sub-project **plans/specs**
(`docs/superpowers/plans/2026-07-0{1,2}-*.md`, session-hook design) still
contain frozen code snippets referencing the `generator` phase, because they're
historical records of what those sub-projects looked like when authored.
**Leave them as history (current choice), or do a full sweep to rewrite the old
snippets too?**

## 5. `AIPE_VERSION` / release version wiring

The launcher and `src/cli.ts` hardcode `0.1.0` (matching
`.claude-plugin/plugin.json`). There's no single source of truth yet. Minor,
but if you want, I can wire the version from one place (e.g. generate it into
the launcher at build time) so a release bump touches one file.

---

*Everything above is safe to defer. The onboarding pipeline (steps 1–4) is
complete and green; the plugin runs today via the compiled binary or the Bun
dev fallback.*
