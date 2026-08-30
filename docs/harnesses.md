# Harnesses

AIPe is not a Claude Code tool that happens to compile. The whole product is a
CLI (`aipe`) plus a thin, replaceable layer per agent harness. This document is
the reference for that layer: what a harness adapter owns, which harnesses are
supported today and how they differ, and how to add another.

## The seam

Everything harness-specific lives behind one interface —
[`HarnessAdapter`](../src/harness/types.ts). A workspace records its choice in
`.aipe/harness`, and `resolveAdapter(workspaceDir)` is how every other module
asks "where does this go, for *this* workspace".

| Member | Answers |
|---|---|
| `id` / `label` | The adapter's AIPe id and its human name |
| `agentopHarness` | What `agentop` calls this harness (a *different* namespace from `id`), or `null` when it has no equivalent |
| `installIntegration(workspaceDir)` | Write the harness's native integration into the workspace |
| `ensureStartupHook(targetDir)` | Install the awareness delivery into **any** directory — the workspace or a single repo |
| `startupDelivery(awareness)` | How the awareness text reaches a session: a live `hook`, or a static `file` |
| `containmentHook(role?)` | How this harness is told to block a command, or `null` when it cannot be contained |
| `personaTarget(slug)` | Where a persona's skill lives inside its repo |
| `agentTarget(slug)` | Where a persona's *agent type* lives, or `null` when the harness has no such concept |
| `wrapPersona(body, meta)` | Wrap a persona body so **this** harness auto-loads it |
| `flowSkillTarget(name)` | Where a named skill file goes (coordinator flow-skills *and* toolbox skills) |
| `integrationPaths()` | The paths this harness owns in a workspace — drives the publish allowlist and the scaffolded `.gitignore`/README |
| `mcpConfigPath(scope, repo?)` | Where MCP servers are registered |
| `resolveModel(tier)` | Map an abstract tier to a concrete model id, or `null` |

Two rules keep the seam honest, and both are enforced by
[`src/harness/__tests__/parity.test.ts`](../src/harness/__tests__/parity.test.ts):

1. **Nothing outside `src/harness/` hardcodes a harness path.** If you find
   yourself typing `.claude/` anywhere else, the adapter is missing an accessor.
2. **Every harness offered as `supported` in the picker has its own adapter.**
   `getAdapter` falls back to Claude Code for an unknown id, so a missing
   adapter does not fail loudly — it silently installs the *wrong* integration
   under another harness's name.

## Supported harnesses

| Harness | `id` | Workspace integration | Persona skills | Agent types | Containable | Session-mode dispatch |
|---|---|---|---|---|---|---|
| Claude Code | `claude-code` | `.claude/settings.json` | `.claude/skills/<slug>/SKILL.md` | `.claude/agents/<slug>.md` | ✅ | ✅ |
| Gemini CLI | `gemini` | `.gemini/settings.json` | `.agents/skills/<slug>/SKILL.md` | — | ✅ | ✅ |
| OpenAI Codex CLI | `codex` | `.codex/hooks.json` | `.agents/skills/<slug>/SKILL.md` | — | ❌ | ❌ |
| GitHub Copilot CLI | `copilot` | `.github/hooks/aipe.json` | `.agents/skills/<slug>/SKILL.md` | — | ❌ | ❌ |
| Generic / `AGENTS.md` | `generic` | `AGENTS.md` + `.aipe/flows/` | `.aipe-personas/<slug>.md` | — | ❌ | ❌ |

Listed in the picker but **not** implemented: `antigravity`, `cursor`. They are
marked `coming-soon`, which means exactly one thing — no adapter exists yet.
That label is about *implementation*, not *containment*: "no adapter" and
"cannot be contained" are different facts, and the containment ledger below
keeps them apart (`antigravity` and `cursor` share the `coming-soon` label but
land in different containment states).

### Why three harnesses share `.agents/skills/`

Codex, Gemini and Copilot all follow the emerging `AGENTS.md` / `.agents/`
convention, so one persona file serves all three. That sharing is deliberate,
not duplication to be cleaned up. What must *not* be shared is the file that
tells a harness how to **behave** — each keeps its own config path, or
installing one harness would rewrite another's settings.

### Why only Claude Code gets agent types

A **skill** is loaded into the session you are already in. An **agent type** is
something the coordinator can *dispatch* as its own separate context. Only
Claude Code models the second one. Elsewhere `agentTarget()` returns `null` and
no file is written — writing an `agents/` file a harness never reads would look
installed and do nothing, which is worse than not installing it.

### Containment and session-mode eligibility

A specialist dispatched under session mode runs as its own detached `agentop`
session. AIPe **never starts a session it cannot govern**, so a harness whose
adapter returns `containmentHook(): null` is rejected from session mode by
`aipe dispatch validate`. This is the eligibility rule working as designed, not
a gap to patch quietly.

- **Codex** — project hooks only load after a human interactively trusts them
  via `/hooks` (trust is per-hook-hash, with no config-file way to self-declare
  it). AIPe's dispatch is fully non-interactive, so the containment hook would
  be on disk and inert.
- **Copilot** — the same shape of problem, via default-on directory trust.

Both write their containment hook anyway, so the moment either CLI ships a
non-interactive trust path the adapter is a small change. The reasoning is kept
in full at the top of `containmentHook` in
[`src/harness/codex.ts`](../src/harness/codex.ts).

Note that this is a *unit* question, not a *workspace* question: a
`claude-code` workspace can still dispatch a unit to `gemini`, because that only
needs the `gemini` binary present.

### Containment across the ten agentop harnesses — investigated 2026-08-30

`isContainable()` is a *binary* the dispatch law needs at runtime. But the
product had collapsed a *wider* question into it: for every harness `agentop`
can host — not just the four with an adapter — **does a reliable
non-interactive interception hook exist at all?** "No adapter yet" and "cannot
be contained without a human" were both surfacing as one undifferentiated
"coming soon". That flattening is the defect the PE flagged for Antigravity.

The eligibility rule is one question, asked of each tool's **own**
documentation: *is there an interception hook that blocks a command reliably,
with no human present to trust or approve it?* The answer needs **three**
states, not two, and each "proven" line cites a primary source (URL + the date
it was read). Where the docs do not answer, the state is **unestablished** and
says so — a confident tenth line with no source would just repeat the defect.

The machine-readable ledger lives in
[`src/harness/compat.ts`](../src/harness/compat.ts) (`HARNESS_CONTAINMENT`,
`containmentFor`, `harnessesInState`). Its four adapter-backed rows are locked
to what `isContainable(getAdapter(id))` actually returns by
[`src/harness/__tests__/compat.test.ts`](../src/harness/__tests__/compat.test.ts),
so prose and behavior cannot drift apart. It adds **no** id to the dispatch
union and changes **no** eligibility rule.

| Harness (`agentop` id) | Adapter? | State | Why (one line) |
|---|---|---|---|
| `claude-code` | ✅ | **containable-proven** | PreToolUse deny in `settings.json`; user-level hooks run with no trust prompt |
| `gemini` | ✅ | **containable-proven** | BeforeTool deny; folder trust *disabled by default*, so a fresh worktree loads hooks |
| `codex` | ✅ | **non-containable-proven** | non-managed hook inert until a human trusts it via `/hooks` (per-hook-hash) |
| `copilot` | ✅ | **non-containable-proven** | default-on directory trust; repo hooks not stated exempt |
| `cursor` | — | **non-containable-proven** | `beforeShellExecution` deny exists, but project hooks load only in a *trusted workspace* |
| `antigravity` | — | **unestablished** *(candidate)* | config-file `decision:"deny"` hard-block, **no** documented trust gate — but headless auto-load unconfirmed |
| `factory-droid` | — | **containable-proven** | `commandBlocklist` "can never run… holds even under `--skip-permissions-unsafe`" + PreToolUse deny |
| `kimi-code` | — | **containable-proven** *(fail-open)* | PreToolUse deny in `config.toml`, no trust gate — but only exit-2 blocks; everything else defaults to allow |
| `opencode` | — | **containable-proven** | `permission:"deny"` for `bash`, still enforced under `--auto`; config/plugins auto-load |
| `pi` | — | **containable-proven** | `beforeToolCall`/`tool_call` block before execution; user/global/`-e` extensions load with no trust gate |

Read the ledger for the verbatim quotes and the per-harness caveats. Three
things worth stating plainly here:

- **Antigravity — the PE's question, answered.** The official docs
  ([antigravity.google/docs/ide/hooks](https://antigravity.google/docs/ide/hooks/),
  read 2026-08-30) document a config-file `PreToolUse` hook whose
  `decision:"deny"` "Hard blocks execution immediately", configured in a
  `hooks.json`, with **no** human-trust precondition anywhere — materially
  unlike Codex/Copilot/Cursor. What the docs do **not** state is whether that
  `hooks.json` loads automatically or needs a manual activation step, and
  whether it runs in a fully headless no-human session. So the honest answer is:
  *the documentation does not fully resolve it.* Antigravity is a genuine
  adapter **candidate** — **not** proven non-containable, and not the same as
  the harnesses it was lumped with under "coming soon". The number was
  misleading; this ledger is where that stops.

- **Codex and copilot — reconfirmed, unchanged.** Read fresh on 2026-08-30
  against
  [learn.chatgpt.com/docs/hooks](https://learn.chatgpt.com/docs/hooks) and
  [docs.github.com/…/hooks-reference](https://docs.github.com/en/copilot/reference/hooks-reference).
  Both still require a human trust step AIPe's unattended dispatch cannot clear.
  One thing to watch on Codex: third-party writeups describe a `codex hooks
  trust request` programmatic-trust command, but **no such command appears in
  the official docs** — only a GitHub feature request. If OpenAI ships an
  official non-interactive trust path, that flips Codex, and the adapter is a
  small change (the hook is already written to disk, inert).

- **Four harnesses look containable per docs, but are not yet AIPe-verified.**
  `factory-droid`, `kimi-code`, `opencode`, and `pi` each document a
  non-interactive deny hook with no trust gate — a real, sourced finding — but
  none has an adapter, and each carries a documented reservation (fail-open,
  default-permissive, headless-applicability-not-verbatim, extension-scope).
  They are candidates, recorded as such; **implementing an adapter is out of
  scope for this investigation** and is the PE's call. `kimi-code`'s fail-open
  design in particular should give any future adapter pause: the vendor itself
  says the hook "should not be used as the sole security barrier."

### Model tiers

`resolveModel(tier)` maps AIPe's four abstract tiers onto each harness's real
models. `generic` returns `null` for every tier — the session default applies.
The tier's authorization and volume gates still run either way; see
[`aipe model`](../src/model/cli.ts).

### Flow-skill path tokens

The coordinator flow skills in [`skills/`](../skills/) are prose the model
reads, and that prose names real paths ("read that repo's persona body from
…"). Embedded verbatim they would install the *Claude Code* paths into every
harness, so the paths are tokens resolved per adapter at install time by
`renderFlowSkills`:

| Token | Claude Code | Gemini / Codex / Copilot | Generic |
|---|---|---|---|
| `{{PERSONA_FILE}}` | `.claude/skills/<slug>/SKILL.md` | `.agents/skills/<slug>/SKILL.md` | `.aipe-personas/<slug>.md` |
| `{{SKILL_FILE}}` | `.claude/skills/<name>/SKILL.md` | `.agents/skills/<name>/SKILL.md` | `.aipe/flows/<name>.md` |
| `{{SKILL_DIR}}` | `.claude/skills/<name>/` | `.agents/skills/<name>/` | `.aipe/flows/` |

When you write a flow skill, use the token — never a literal path. A leftover
`{{…}}` in an installed skill is caught by
`src/rehydrate/__tests__/flow-skills.test.ts`.

## Choosing a harness

```sh
aipe start                      # interactive picker
aipe start --harness gemini     # explicit, non-interactive
```

The picker annotates any supported harness that cannot be contained, because
finding that out after onboarding a whole context is far more expensive than
reading it at the moment of choice.

`aipe capabilities probe` detects which harness binaries this machine actually
has (`claude`, `gemini`, `codex`, `copilot`) and records it; `aipe capabilities
show` flags drift.

## Changing a workspace's harness

The published source of truth for personas — `.aipe/personas/<repo>/<slug>/` —
is stored harness-neutrally. So:

```sh
printf 'gemini\n' > .aipe/harness
aipe rehydrate
```

re-installs every persona in the new harness's shape. The old harness's files
are left in place; delete them by hand if you want them gone.

## Adding an adapter

1. Create `src/harness/<id>.ts` exporting a `HarnessAdapter`. Copy the closest
   existing one — `gemini.ts` for a hook-based harness, `generic.ts` for a
   file-based one.
2. Register it in `ADAPTERS` in
   [`src/harness/registry.ts`](../src/harness/registry.ts).
3. Add it to `HARNESSES` in [`src/start/start.ts`](../src/start/start.ts) with
   `status: "supported"`.
4. If the harness has a detectable binary, add it to `PROBED_HARNESSES` in
   [`src/capabilities/probe.ts`](../src/capabilities/probe.ts).
5. Run `bun test src/harness` — the parity suite checks the new adapter against
   every member of the seam, asserts it does not write a `.claude/` directory,
   and asserts its config path collides with no other harness.

Return `containmentHook(): null` unless containment genuinely works
end-to-end and unattended. Reporting containable while nothing actually blocks
a command is worse than being ineligible.
