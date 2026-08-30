# Security Policy

## What AIPe is, from a risk perspective

AIPe dispatches **autonomous coding agents** into git worktrees with access
to a repository's full history, the developer's own git/GitHub credentials
(for `git push` / `gh pr create`), and a shell. That is not the risk surface
of an ordinary library — a bug here can mean an agent doing something
destructive or irreversible with real developer credentials, not just a
wrong return value. The design choices below follow from taking that
seriously.

## The containment model

Session-mode dispatch (`aipe session dispatch`) starts a specialist as a
**detached** process with no human watching every action in real time. Before
any of that, AIPe asks one question: can this harness actually be governed?

- **Claude Code and Gemini CLI** get a real `PreToolUse`-equivalent
  containment hook (`src/harness/claude-code.ts`, `src/harness/gemini.ts`),
  enforced by `src/session/guard.ts`. A dispatched specialist is denied
  outright from ever running `agentop session kill` (killing a session is
  reserved for the coordinator/PE), and anything that would spawn a new
  session is held behind an explicit grant (`needs-grant`) rather than
  allowed silently. Read-only introspection (`session list/attach/note/rename`)
  is allowed. The guard is intentionally conservative: it matches the
  dangerous token sequence *wherever it appears* in a command rather than
  trying to parse shell syntax, because a parser that tries to be clever
  about "is `agentop` in command position" has repeatedly been the thing that
  silently disabled containment (see the comments in `guard.ts` for the
  history of near-misses this pattern closes).
- **Codex CLI and GitHub Copilot CLI are not containable, on purpose.** Both
  require a human to interactively review and trust a project hook before it
  loads (there is no config-file way to self-declare that trust, and the
  documented bypass flags say "dangerously" for a reason). AIPe's dispatch is
  fully non-interactive — nobody is present to ever grant that trust — so a
  hook written to either harness's config is present on disk and **inert**.
  Rather than report these harnesses as governed when nothing would actually
  block a dangerous command, their adapters return no containment hook at
  all, and `aipe dispatch validate` rejects any attempt to session-dispatch
  them with `harness-not-containable`. **AIPe never starts a session it
  cannot govern** — that is the eligibility rule, not a gap to patch quietly.

Two things follow from this:

- If you run one of these harnesses **yourself**, outside AIPe's dispatch
  (e.g. `codex` in your own terminal), none of the above applies — you are
  not inside AIPe's containment model, and you are responsible for that
  harness's own trust and permission model exactly as if AIPe weren't
  involved.
- Killing a live specialist session is always a human decision (the PE's),
  never something the coordinator or another specialist does programmatically
  — this is enforced by the same guard, not just documented as a convention.

## Where secrets live

- **Never in a published/portable artifact.** A workspace's `.aipe/`
  directory (brain, personas, journeys, toolbox catalog) is meant to be
  committed and shared across a team. `.aipe/toolbox.yaml` — the catalog of
  MCP servers a context can use — is scanned by `aipe mcp add`
  (`src/toolbox/secrets.ts`) for anything that looks like a literal secret
  (password/token/API key/credential fields, or `user:pass@host` embedded in
  a URL) and **refuses to write it**. Only environment-variable references
  (`${VAR}`) are accepted in a committed MCP config.
- **Real secrets are supplied at runtime via the environment**, never through
  a file AIPe writes or reads back — e.g. `AIPE_SERVE_TOKEN` for the web
  console below, or an MCP server's own credentials referenced by `${VAR}`
  and resolved from the operator's shell, not from disk.
- **`aipe serve` (the web console)** binds `127.0.0.1` by default, where it
  requires no token because it is reachable only from the machine already
  running it. Bound to any other host, every request must carry a token
  (`src/serve/auth.ts`): the operator's own via `AIPE_SERVE_TOKEN`, or a
  freshly generated 256-bit one, checked with a constant-time comparison and
  handed back as an `HttpOnly` cookie. There is a deliberate, explicitly-typed
  `--insecure` escape hatch for a trusted network — the unsafe state is never
  the default.
- Standard git/GitHub credentials (SSH key, `gh auth`, credential helper) are
  the developer's own, used in place by whatever `git`/`gh` invocation a
  dispatched specialist runs inside its worktree. AIPe does not collect,
  proxy, or transmit them anywhere.

## Scope

**In scope:** the CLI (`src/`), the Claude Code plugin surface
(`.claude-plugin/`, `skills/`, `hooks/`), the web console (`src/serve/`), and
the release/distribution pipeline (`scripts/`, `.github/workflows/`).

**Out of scope:**

- A compromised **host** — shell access on the machine running AIPe reads
  whatever that machine's git credentials and environment already expose.
- A malicious or compromised **PE (the human operator)** — the PE is fully
  trusted by design; AIPe's guarantees are about *specialists* not exceeding
  what the PE authorized, not about defending against the PE itself.
- Vulnerabilities in the underlying AI coding harnesses (Claude Code, Gemini
  CLI, Codex, Copilot) themselves — report those upstream, to their own
  maintainers.
- Physical access to the machine.

## Reporting a vulnerability

**Please do not open a public issue.** Report privately via a
[GitHub Security Advisory](https://github.com/blpsoares/aipe/security/advisories/new)
on this repository — that channel stays private until a fix ships.
Alternatively, contact the maintainer directly through their GitHub profile,
[@blpsoares](https://github.com/blpsoares), rather than filing a public issue.

Useful in a report: the AIPe version or commit, which harness/mode was
involved (subagent vs. session, which underlying CLI), and the smallest
reproduction you have. A proof of concept is welcome but not required — a
clear description of the flaw and its impact is enough.

There is no bounty program. Expect an acknowledgement within a few days.
