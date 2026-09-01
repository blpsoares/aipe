# Plan — #118

## Abordagem técnica

Três dentes, cada um no ponto onde a força é estrutural, não prosa.

### T1 — Instalação automática (`aipe skill preset` + `rehydrate`)
- `skillPreset` (src/toolbox/cli.ts) hoje instala `sdd-lite` + reliability-floor e
  **sugere** `spec-kit`. Passa a **materializar** o `spec-kit` em todos os repos
  (reusando `materializeSpecKit` + `installSkillContent`, o mesmo caminho do
  `aipe skill add spec-kit --all`). O `preset` é chamado pelo `hire-specialists`
  no onboarding → todo workspace novo nasce com o kit completo.
- `rehydrate/toolbox.ts` já re-sincroniza skills instaladas; garante que
  `spec-kit` (SKILL.md + `.specify/` + `.claude/commands/speckit.*`) esteja
  presente ao reidratar um workspace que não o tem.

### T2 — Rota SDD única e visível (`routing.ts` + `skill match`)
- Extrair `skillApplies(skill, task)` de `matchSkills` (predicado por skill).
- `routeSdd(toolbox, task): { kit, reason }` — decide **um** piso SDD: `spec-kit`
  se instalado e a task cumpre seu `routing` (`size >= minSize`, não em `skipFor`);
  senão `sdd-lite` (piso); senão `null`. O limiar é o `minSize` já declarado no
  kit — **estabelecido, não adivinhado** — e a `reason` o nomeia.
- `skill match` emite uma linha `ROUTE sdd=<kit> — <reason>` além dos `MATCH`, e
  a inclui no `--json`. É a decisão que o coordenador registra no dispatch.

### T3 — Recusa no ledger (`ledger.ts` + `journey record`)
- Tipo: `JourneyDispatch.sddKit?: string`; `STICKY_DISPATCH_FIELDS += "sddKit"`
  (um `delivered` que omite `--sdd` preserva o valor gravado no dispatch).
- Gate em `recordDispatchGuarded`, novo code `sdd-artifacts-required`: quando
  `status === "delivered"` e a unidade foi roteada para `spec-kit`
  (`dispatch.sddKit ?? current.sddKit`), exige `specs/**/spec.md` **e**
  `specs/**/plan.md` presentes/commitados no worktree. Inerte sem resolver
  injetado (reconciler/testes), como o gate de CI — nunca fabrica um passe.
- Resolver real `resolveSddArtifactsGit(worktree)` via `git ls-files` no worktree
  (arquivos rastreados = no PR). CLI injeta o real; testes injetam fake.
- CLI `journey record` ganha `--sdd <kit>` (grava `sddKit`) e injeta o resolver.

## Arquivos tocados
- `src/toolbox/types.ts` — (nada novo; `SkillRouting` já basta)
- `src/toolbox/routing.ts` — `skillApplies`, `routeSdd`, `SddRoute`
- `src/toolbox/cli.ts` — `skillPreset` materializa spec-kit; `skillMatch` imprime ROUTE
- `src/toolbox/sdd.ts` — `resolveSddArtifactsGit` (resolver real, sem rede)
- `src/rehydrate/toolbox.ts` — garante/repara spec-kit + re-materializa `.specify/`
- `src/rehydrate/exclude.ts` — exclui `.specify/` do git local (novo, ver Riscos)
- `src/session/cli.ts` — `--sdd` no comando de recuperação de dispatch (round-trip)
- `src/journey/types.ts` — `sddKit?`
- `src/journey/ledger.ts` — gate `sdd-artifacts-required` + sticky
- `src/journey/cli.ts` — `--sdd`, injeta resolver
- `skills/hire-specialists/SKILL.md` — prosa: preset instala o SDD completo
- `skills/operate/SKILL.md` — registrar `--sdd` no dispatch + o gate

## Riscos / invariantes
- **Não quebrar o loop de conserto** (A4): o gate só morde `delivered`; um
  `blocked`/`failed`/`redirected`/`dispatched` de conserto passa. Só o
  claim-de-pronto exige artefatos.
- **Sem rede no gate**: o resolver é `git ls-files` local, nunca forge.
- **Round-trip de ledgers legados**: `sddKit` ausente ⇒ ausente (sticky só
  preserva, nunca inventa); unidades não-SDD não são afetadas.
- **`.specify/` suja o tree (classe do #87)**: materializar o spec-kit adiciona
  `.specify/` não-rastreado, e o upgrade recusa tree sujo. `.specify/` é tooling
  re-materializável (como `.claude/`), então entra no `.git/info/exclude` via
  `ensureReposExcludeClaude`. Os artefatos reais do specialist ficam em `specs/`
  (commitado, e o que o gate T3 checa) — nunca em `.specify/`. Descoberto pela
  regressão do `upgrade-real-scenario.test.ts`; conserto no mesmo commit.
