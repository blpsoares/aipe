# Spec — SDD tem que vir instalado e ter dentes (issue #118)

**Feature branch:** `aipe/j-20260831-o6/jesse`
**Kit roteado:** `spec-kit` (medido: `aipe skill match --task-type feature --size large` → `MATCH spec-kit`)
**Origem:** ordem do PE em 2026-08-31, repassada pelo COORDENADOR — *"o sdd deve vir automaticamente instalado junto com o aipe, isso é inegociável"*.

## Problema

Em 2026-08-31, **7 de 7 PRs mescladas no dia** chegaram sem spec e sem plano. Não
foi indisciplina dos specialists — eles rodaram `aipe skill match`, receberam o
piso leve `sdd-lite`, e seguiram o que a ferramenta ofereceu. O fluxo completo do
SDD estava **inalcançável**. Três defeitos encadeados, todos medidos:

1. **O `spec-kit` nunca foi instalado.** A CLI o conhece (`registry.ts`), mas o
   onboarding só instala `sdd-lite` (via `aipe skill preset`) e *sugere* o
   spec-kit em prosa. Nenhum workspace nasceu com ele; ele existia só como menção
   dentro da descrição do `sdd-lite` no `toolbox.yaml`.
2. **`skill match --size` era decorativo.** `small`/`medium`/`large` devolviam a
   mesma coisa — porque o único kit com `routing.minSize` (`spec-kit`,
   `minSize: medium`) não estava no toolbox para filtrar. A flag existia, era
   aceita, e não tinha efeito: `menção-confundida-com-uso`.
3. **O SDD era sugestão, não recusa.** O `journey record --status delivered`
   aceita entrega sem nenhum artefato de spec/plano. O gate de evidência tem
   dentes (recusa `delivered` sem evidência); o de spec não tinha nenhum — por
   isso falhou 7 de 7.

## O que NÃO resolve (já tentado e falho)

- Escrever no brief que o specialist deve rodar `skill match` — já estava lá.
- Deixar o spec-kit como kit opcional do toolbox — foi assim que passou dias sem
  existir.
- Confiar no coordenador para conferir — ele não conferiu nenhuma das 7.

## Escopo (o slice do repo `aipe`)

### Dentro
- **T1 — Instalação automática.** Um workspace novo nasce com o `spec-kit`
  materializado em **todos** os repos. `aipe skill preset` (rodado no onboarding
  pelo `hire-specialists`) passa a materializar o spec-kit, não só sugeri-lo.
  `aipe rehydrate` repara um workspace existente que não o tem.
- **T2 — `--size` roteia de verdade, com o limiar visível.** `aipe skill match`
  passa a emitir uma **decisão de rota SDD única** (`ROUTE sdd=<kit>`), não só uma
  lista aditiva de matches. O limiar é **estabelecido** a partir do `routing`
  já declarado no kit (`spec-kit.minSize = medium`), e a linha de rota nomeia
  por que aquele kit foi escolhido. Abaixo do limiar → piso `sdd-lite`; no/acima
  → `spec-kit`.
- **T3 — Recusa, não lembrança.** Quando uma unidade foi despachada como
  spec-kit (rota SDD gravada no ledger), `journey record --status delivered`
  **recusa** a entrega sem os artefatos de spec **e** plano commitados no
  worktree — exatamente como já recusa `delivered` sem evidência.

### Fora (declarado, não omisso)
- **`aipe doctor` (#95)** apontar o spec-kit ausente é a onda 7 e é outra issue;
  aqui o reparo fica no `rehydrate`. O gate do `doctor` entra quando #95 existir.
- Tornar o `dispatch` **recusar** um despacho sem `--size` é enforcement
  adjacente; aqui o dispatch que não declara tamanho simplesmente não ativa o
  gate T3 (degrada ao piso), e isso fica anotado como follow-up.

## Critério de aceite (cada um com prova)

- **A1 (T1).** Após `aipe skill preset` num workspace de teste, `aipe skill list`
  mostra `spec-kit` em todos os repos e os arquivos `.specify/` +
  `.claude/commands/speckit.*` existem em disco. Prova: saída do comando + `ls`.
- **A2 (T2, por consequência).** **Em cima de `/home/mithrandir/aipe-blpsoares`,
  com a entry rasa (sem `routing`) que está lá hoje**, `--size small` e
  `--size large` produzem rotas **DIFERENTES** (`sdd-lite` vs `spec-kit`), e a
  `reason` afirma só a comparação de fato feita — nunca "small ≥ medium". Prova:
  as duas linhas divergentes coladas, rodadas nesse diretório. Regressão fixa a
  entry rasa como fixture (o defeito nasce de workspace envelhecido, a config de
  todo usuário existente).
- **A3 (T3, a metade que importa) — no FLUXO REAL, sem flag no fim.** Uma unidade
  cujo despacho declara `--size large` (a rota é DERIVADA disso; ninguém precisa
  lembrar `--sdd` na entrega — foi esse o elo que deixou o portão inerte):
  - `journey record --status delivered` (comando limpo, como o prompt compõe)
    **sem** artefatos → **REJECT** `sdd-artifacts-required`, mensagem nomeando o
    que falta **e** por qual dos três caminhos a unidade caiu no fluxo completo;
  - com `specs/**/spec.md` **e** `plan.md` commitados no worktree → **aceita**.
  - Provado por **mutação** (código): sem o gate, os testes de recusa falham.
  - **Silêncio não escapa:** uma unidade sem `--size` declarado cai no fluxo
    COMPLETO (não declarado ≠ trivial); o caso trivial é o que precisa se
    declarar (`--size small` ou `--sdd sdd-lite`), e a reivindicação fica no
    ledger.
- **A4 (loop de conserto não quebra).** Só o claim-de-pronto `delivered` é
  barrado. Uma unidade `dispatched` (conserto), `blocked`, `failed`,
  `redirected` ou o QA `verified` não é barrada pelo gate T3.
- **A5 (auto-refutação).** Esta própria entrega chega com `specs/118-…/{spec,
  plan,tasks}.md` commitados. Se a jornada que torna o SDD obrigatório chegasse
  sem spec, ela se refutaria.
