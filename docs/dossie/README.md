# AIPe Dossier

A durable, version-controlled record of **how AIPe was built** — every sub-project,
step by step. Specs describe *what* to build and plans describe *how*; this dossier
captures the **narrative of execution and review**: the decisions taken (and why), what
each implementation step delivered, what code review caught, how it was fixed, and the
final verified state. It exists so the whole journey can later feed a documentation
site, an architecture overview, and onboarding material.

## Convention (applies to every session, including future ones)

When a sub-project (or a distinct phase) is completed, add or update a dossier entry
before the working ledger is discarded. Each entry records, in order:

1. **Decisions** — the questions raised during brainstorming and the choices made,
   with the reasoning.
2. **Plan** — the task breakdown.
3. **Execution** — what each task delivered.
4. **Review** — findings from task reviews and the final whole-branch review:
   Important/Critical issues fixed, and Minor issues consciously accepted (with why).
5. **Final state** — merge commit and test/type-check evidence.

Every artifact in this repository — code, comments, strings, specs, plans, skills, the
hook, docs, and commit messages — is written in **English**. (Interaction with the PE
may happen in another language, but the repository is English-only.)

## Index

| # | Sub-project | Status | Entry |
|---|---|---|---|
| 1 | `/context-brain` — factual map of a context | Merged | [01-context-brain.md](01-context-brain.md) |
| 2 | `/make-workspace` — clone the repos | Merged | [02-make-workspace.md](02-make-workspace.md) |
| 3 | `SessionStart` hook — coordinator context injection | Merged | [03-session-hook.md](03-session-hook.md) |
| 4 | `/relationship` — cross-repo relationship discovery (also backfills `stack`) | Ready to merge | [04-relationship.md](04-relationship.md) |
| 5 | `/hire-specialists` — persona skills (renamed from `/context-brain-generator`) | Implemented | [05-hire-specialists.md](05-hire-specialists.md) |
| — | Unified `aipe` CLI + zero-dependency distribution | Implemented | [06-unified-cli-distribution.md](06-unified-cli-distribution.md) |
| 6 | Phase B (Operation): worktree, dispatch, journey, operate, dashboard + portability, toolbox, add-repo | Merged | [07-phase-b-operation.md](07-phase-b-operation.md) |
| 7 | Module granularity — relationship + hire-specialists by fqid (`repo/module`) | Implemented | [08-module-granularity.md](08-module-granularity.md) |
| 8 | Persona load-order — preflight (`aipe validate-personas`) + live-step protocol | Preflight done; live step pending PE | [09-persona-load-order.md](09-persona-load-order.md) |
| 9 | Release + distribution readiness — version guard, hardened `release.yml`, `RELEASING.md` | Prepared; domain + tag pending PE | [10-release-distribution.md](10-release-distribution.md) |

### Roadmap (not yet built)

- **AIPe Web Console** — responsive desktop+mobile visualization of the org
  chart, workers, and pipeline (`specs/2026-07-05-web-console-design.md`).
  **Build LAST**, once the pipeline data model is fully settled.
- Persona load-order — the **live** observation still needs a real session
  (preflight + exact steps shipped; see dossier 09).
- Skill/MCP uninstall; harness adapters beyond Claude Code; release + Cloudflare

See the foundation design at
`docs/superpowers/specs/2026-07-01-aipe-context-brain-design.md`.
