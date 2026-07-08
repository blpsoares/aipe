# Worktree lifecycle safety (PR-D)

Spec + plano curtos para 3 bugs críticos de lifecycle de worktree.

## Bugs

### A1 — `prune --journey` apaga worktrees ativos
`pruneWorktrees` remove qualquer worktree limpo+pushed do journey, ignorando o
estado do dispatch no ledger. Deve **ler o journey ledger** e só remover
dispatches em estado **TERMINAL** (`merged`, `removed`). Dispatch **ativo**
(`dispatched`, `delivered`, `escalated`) é **PULADO** e só sai com `--force`.
Worktree sem entrada no ledger mantém o comportamento anterior (guardrail de
sujo/unpushed) — o ledger é a fonte de verdade do estado ativo, ausência ≠ ativo.

### A2 — layout bare aninhado → `not-found` no remove/prune
Em repo bare, o git pode materializar o worktree num caminho diferente do
`<repo>/.worktrees/<slug>` calculado. `removeWorktree` recomputa o path via
`deriveSpec` e falha com `not-found`. Fonte única de verdade: **onde o `git
worktree list` diz que o worktree está**. `createWorktree` passa a devolver o
path real (reconciliado com o `list`); `removeWorktree` resolve o path pelo
branch no `git worktree list`, caindo no computado só se não listado. Teste
round-trip create→remove no layout bare.

### A3 — worktree sobre repo bare herda `core.bare=true`
`git add`/`status` dentro do worktree falham com
`fatal: this operation must be run in a work tree`, o que também envenena o
guardrail `isDirtyOrUnpushed`. No `create`, setar `core.bare=false`
worktree-local (via `extensions.worktreeConfig` + `git config --worktree`),
sem des-bare-ar o repo compartilhado.

## Plano
1. `git.ts`: `setWorktreeNonBare(repoAbs, wtAbs)`; `resolvePathByBranch` helper.
2. `run.ts`:
   - `createWorktree`: reconcilia path real via `listPorcelain`, chama
     `setWorktreeNonBare`.
   - `removeWorktree`: resolve path via `listPorcelain` pelo branch.
   - `pruneWorktrees`: lê ledger, pula ativos sem `--force` (status `skipped`).
3. `cli.ts`: render/exit code de `prune` tolera status `skipped` (informativo,
   não é falha).
4. Testes: bare create→add/status, round-trip bare, prune mix terminal+ativo.

## Validação
`bun test` verde + repro manual em repo bare de teste.
