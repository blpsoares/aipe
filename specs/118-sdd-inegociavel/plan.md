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
  se instalado e a task cumpre o limiar; senão `sdd-lite` (piso); senão `null`.
  **O limiar vem do CONTRATO do kit no registry (`resolveKit(spec-kit).routing`),
  NUNCA da entry do toolbox.yaml.** Motivo (achado do Heisenberg): um
  `skill add spec-kit` pré-#118 (v1.16.0) gravou a entry SEM bloco `routing:`;
  ler o limiar da entry fazia `skillApplies` passar todo tamanho, e um
  `?? "medium"` fabricava no TEXTO um limiar que nenhuma comparação usou
  (`--size small` jurando "small ≥ medium"). Com o contrato no registry, o
  limiar é real e a `reason` afirma só a comparação que de fato ocorreu; se não
  houver limiar aplicado, a linha diz isso — nunca inventa um número.
- `skill match` emite uma linha `ROUTE sdd=<kit> — <reason>` além dos `MATCH`, e
  a inclui no `--json`. É a decisão que o coordenador registra no dispatch.

### T3 — Recusa no ledger (`ledger.ts` + `journey record`)
- Tipos: `JourneyDispatch.sddKit?`, `size?`, `taskType?`;
  `STICKY_DISPATCH_FIELDS += sddKit, size, taskType` (um `delivered` que omite
  as flags preserva o que foi gravado no dispatch).
- Gate em `recordDispatchGuarded`, code `sdd-artifacts-required`: quando
  `status === "delivered"` e a unidade cai no fluxo completo (`spec-kit`), exige
  `specs/**/spec.md` **e** `specs/**/plan.md` commitados no worktree. Inerte sem
  resolver injetado (reconciler/testes), como o gate de CI.
- **A ROTA é DERIVADA, não uma flag lembrada no fim** (conserto do elo aberto —
  o portão do 2509001 era código correto que nunca rodava porque o prompt real
  de despacho nunca punha `--sdd`). Ordem: (1) `--sdd` explícito (nesta escrita
  ou sticky) vence — decisão assinada, incl. `sdd-lite` para reivindicar
  trivial; (2) senão a rota é derivada do `--size`/`--task-type` gravados na
  unidade, pelo mesmo roteador (`routeSddForGate`) que o `skill match` imprime;
  (3) silêncio NÃO compra o piso — `routeSddForGate` difere do `routeSdd` num
  ponto: sem tamanho declarado, cai no fluxo COMPLETO (não declarado ≠
  estabelecido como trivial). O `--size`/`--task-type` são fatos sticky do
  ledger, então a obrigação mora no registro. A recusa nomeia QUAL dos três
  caminhos trouxe a unidade ao fluxo completo (só o silêncio é escapável
  declarando). Honestidade inversa: workspace sem spec-kit no catálogo nunca é
  barrado (não se exige artefato de um fluxo que o repo não alcança).
- Resolver real `resolveSddArtifactsGit(worktree)` via `git ls-tree HEAD`
  (commitado = no PR). Router real `workspaceSddRouter` lê o toolbox do
  workspace → `routeSddForGate`. CLI injeta ambos; testes injetam fakes.
- O **prompt** (`session/prompt.ts`) obriga os DOIS ARTEFATOS (`specs/**/spec.md`
  + `plan.md`), nunca `/speckit.*` — regra do PE "obrigue o artefato, nunca o
  mecanismo" (o guard `prompt.test.ts` recusa citar slash command de um harness).
- CLI `journey record` ganha `--sdd`, `--size` (validado), `--task-type`.

## Arquivos tocados
- `src/toolbox/types.ts` — (nada novo; `SkillRouting` já basta)
- `src/toolbox/routing.ts` — `skillApplies`, `routeSdd`, `routeSddForGate`, `SddRoute`
- `src/session/prompt.ts` — prompt obriga os dois artefatos, não `/speckit.*`
- `src/toolbox/cli.ts` — `skillPreset` materializa spec-kit; `skillMatch` imprime ROUTE
- `src/toolbox/sdd.ts` — `resolveSddArtifactsGit` (resolver real, sem rede)
- `src/rehydrate/toolbox.ts` — repara spec-kit por FORMA (entry sem `routing` é
  defasada → reinstala do registry, curando o bloco `routing`) + re-materializa
  `.specify/`; e instala do zero se ausente. Reparo por nome só (o guard antigo)
  nunca dispararia numa entry rasa.
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
