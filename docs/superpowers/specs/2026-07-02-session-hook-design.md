# AIPe — Hook de injeção de contexto (`SessionStart`)

**Data:** 2026-07-02
**Status:** Design aprovado
**Sub-projeto:** peça fundacional do AIPe (ver
`2026-07-01-aipe-context-brain-design.md`)

---

## 1. Propósito & mecanismo

O que faz o AIPe **ser** um contexto vivo — não só um conjunto de skills executáveis.
Um hook `SessionStart` do plugin AIPe que, ao abrir uma sessão na raiz de um workspace
`aipe-<contexto>/`, injeta **um único bloco** de contexto (`additionalContext`) com a
"consciência" do coordenador: quem ele é, qual o contexto, os repos, a fase do
onboarding e o próximo passo. O coordenador "acorda" já sabendo de tudo, sem o PE
precisar explicar nada.

É **passivo**: `SessionStart` só injeta contexto, não toma decisões nem bloqueia. O
disparo de cada fase do pipeline continua sendo ato deliberado do PE via skills.

---

## 2. Ativação (garantida pela plataforma)

O plugin AIPe é instalado em **escopo de pasta** — `.claude/settings.json` na raiz do
workspace, com `enabledPlugins.aipe: true`. Consequência (documentada do Claude Code):
os hooks de um plugin em escopo de projeto **só disparam quando a sessão abre na própria
pasta** que contém o `.claude/settings.json`. Não sobem para diretórios-pai nem descem
para subpastas.

Portanto:
- **Detecção = raiz do workspace, garantida pela plataforma.** O hook não precisa
  "subir a árvore": lê direto `$CLAUDE_PROJECT_DIR/.aipe/` (o `$CLAUDE_PROJECT_DIR` é a
  pasta de lançamento = raiz do workspace).
- **Fronteira com personas é natural:** abrir uma sessão dentro de um repo
  (`aipe-opvibes/embark/`) **não dispara** este hook — o plugin não está ativo ali. A
  injeção de persona dentro de um repo é responsabilidade do sub-projeto de personas,
  instalado no escopo daquele repo. Zero conflito.

**Matcher:** `startup|resume|clear|compact`. Reaparece após `/clear` e após compactação
automática — senão a "consciência" do coordenador sumiria no meio de uma jornada longa.

**Input disponível ao hook:** variáveis de ambiente `$CLAUDE_PROJECT_DIR` (raiz do
workspace) e `$CLAUDE_PLUGIN_ROOT` (raiz do plugin); JSON no stdin com `cwd`,
`hook_event_name`, `session_id`, etc. A base de leitura é `$CLAUDE_PROJECT_DIR`.

**Output:** JSON em stdout no formato do Claude Code:
```json
{ "hookSpecificOutput": { "hookEventName": "SessionStart", "additionalContext": "<texto>" } }
```
Sair com código 0 e stdout vazio (ou `{}`) injeta nada, de forma limpa.

---

## 3. O bloco único, em 3 estados

O hook emite **exatamente um** `additionalContext` por sessão. Um `switch` sobre o
estado do onboarding escolhe **qual** bloco — nunca dois, nunca acúmulo.

**Estado 1 — sem `brain.yaml`** (bootstrap: plugin ativo, contexto ainda não iniciado)
> Workspace AIPe detectado, mas ainda sem `brain.yaml`. Rode `/context-brain` para
> mapear o contexto e começar.

**Estado 2 — brain existe, alguma fase `pending`** (onboarding em andamento)
> Contexto *\<nome\>* em configuração. Coordenador: *\<coordenador\>* (em formação).
> Estado: brain ✅ · workspace ⏳ · relationship ⏳ · generator ⏳.
> **Próximo passo: `/<primeira-fase-pendente>`.** Conduza o PE para completar o
> onboarding; ainda não opere como coordenador pleno.

O "próximo passo" é derivado da **primeira** fase `pending` na ordem do pipeline
(workspace → relationship → generator), mapeada para sua skill.

**Estado 3 — todas as fases `done`** (coordenador pleno)
> Você É *\<coordenador\>*, coordenador do contexto *\<nome\>*. Repos: \<lista\>.
> Opere assim: decompõe as demandas do PE, contrata especialistas (teto de 16, lei do
> mesmo-repo serializa, repos distintos em paralelo), escala cross-repo ao PE, cada
> especialista abre o PR final. Pronto para receber demandas.

**Comum a todos os estados** — a linha de opt-out:
> Modo AIPe ativo por padrão. Se o PE pedir explicitamente para sair do modo AIPe,
> pare de seguir estas instruções nesta sessão.

**Nota sobre o estado 1 (bootstrap):** o disparo do hook já significa que a pasta é um
workspace AIPe (o plugin em escopo de pasta só dispara onde foi habilitado). Logo, a
**ausência de `brain.yaml` — com ou sem a pasta `.aipe/`** — é o estado 1: a primeira
sessão, antes do `/context-brain`. O hook injeta o estado 1 nesse caso; não fica em
silêncio. O no-op `{}` fica reservado apenas para a defesa em que o workspace é
indeterminável (`$CLAUDE_PROJECT_DIR` vazio).

---

## 4. Componentes & fronteiras

Divisão: **bash orquestra e emite** (preferência de estilo, como o superpowers);
**Bun parseia** o YAML (ponto frágil por o `brain.yaml` ser editável à mão) — o Bun já
é dependência obrigatória do AIPe, então não há dependência nova.

```
hooks/
  ├── hooks.json          ← registra o SessionStart (matcher startup|resume|clear|compact)
  └── session-start       ← bash: entrypoint
src/session-hook/
  ├── read-state.ts       ← Bun tipado: lê+parseia brain.yaml+state.yaml, imprime campos limpos
  └── __tests__/
```

- **`hooks/hooks.json`** — aponta `SessionStart` para `session-start` via
  `$CLAUDE_PLUGIN_ROOT`.
- **`hooks/session-start`** (bash) — o entrypoint. Passos:
  1. Determina o workspace: `$CLAUDE_PROJECT_DIR` (fallback `$PWD`). Se indeterminável
     (vazio) → emite `{}` e sai 0 (defesa).
  2. Chama `bun $CLAUDE_PLUGIN_ROOT/src/session-hook/read-state.ts --workspace
     $CLAUDE_PROJECT_DIR`, que devolve campos shell-friendly (ver abaixo). Se o bun
     falhar, os campos vêm vazios → tratado como estado 1.
  3. Decide o estado (1/2/3) a partir dos campos: `BRAIN=absent` → estado 1; presente com
     alguma fase ≠ `done` → estado 2; todas `done` → estado 3.
  4. Monta o texto do bloco e o emite como `hookSpecificOutput.additionalContext`,
     com escaping de JSON (mesma técnica do `session-start` do superpowers:
     substituições de barra/aspas/quebras via parameter expansion).
- **`src/session-hook/read-state.ts`** (Bun, tipado, testado) — lê
  `<workspace>/.aipe/brain.yaml` e `state.yaml` com o pacote `yaml`; reusa
  `BrainFile`/`StateFile` de `src/context-brain/types.ts`. Imprime um formato estável e
  fácil de consumir em bash. **Degrada com elegância:** se `brain.yaml` falta → sinaliza
  estado 1; se `state.yaml` falta/malforma → assume fases `pending`; nunca lança de
  forma a quebrar o hook (erros viram um marcador que o bash trata como "sem brain"/
  degradado).

### Contrato de saída do `read-state.ts`
Formato shell-friendly, uma chave por linha (fácil de ler com `while read` / `grep`):
```
BRAIN=present            # ou absent
CONTEXT_NAME=opvibes
COORDINATOR=Nicolas
PHASE_BRAIN=done
PHASE_WORKSPACE=pending
PHASE_RELATIONSHIP=pending
PHASE_GENERATOR=pending
REPOS=embark,prontuario  # nomes, separados por vírgula; vazio se nenhum
```
Se `BRAIN=absent`, os demais campos podem vir vazios — o bash decide estado 1 só com
esse marcador. Valores são saneados (sem quebras de linha) para não corromper o
parsing em bash.

---

## 5. Erros & robustez

- **`$CLAUDE_PROJECT_DIR` vazio/indeterminável:** saída vazia (`{}`), defesa.
- **`brain.yaml` ausente (com ou sem `.aipe/`):** estado 1 ("rode `/context-brain`") —
  é o bootstrap normal da primeira sessão.
- **`brain.yaml` editado à mão com aspas/comentários/estilo flow:** o parse via pacote
  `yaml` (no Bun) absorve — é justamente por isso que o parse não é feito em bash.
- **`brain.yaml`/`state.yaml` malformado a ponto de não parsear:** `read-state.ts`
  captura e devolve um estado degradado (trata como "sem brain" ou fases `pending`) em
  vez de derrubar o hook. O hook **nunca** deve fazer o arranque da sessão falhar.
- **`state.yaml` ausente mas brain presente:** assume todas as fases não-`brain` como
  `pending` → estado 2, próximo passo `/make-workspace`.

---

## 6. Testes (`bun test` + fumaça do bash)

**`read-state.ts` (unitário, robusto):**
- brain+state completos (todas done) → `BRAIN=present`, campos e `REPOS` corretos.
- brain ausente → `BRAIN=absent`.
- state parcial (workspace pending) → flags refletem; próximo passo derivável.
- state ausente com brain presente → fases não-brain viram `pending`.
- brain com aspas/comentário/estilo flow → ainda extrai nome/coordenador/repos.
- brain malformado (YAML inválido) → degrada sem lançar; sinaliza estado tratável.
- saneamento: valores com caracteres estranhos não emitem quebras de linha.

**`session-start` (bash, fumaça):** dado um `.aipe/` fixture, o JSON emitido contém os
marcadores certos de cada estado (1/2/3) e, no caso "sem `.aipe/`", a saída é vazia. O
JSON emitido é válido (parseável).

---

## 7. Impacto no roadmap (doc de fundação)

- Hook de injeção de contexto (`SessionStart`) — **este spec**; peça fundacional.
- A injeção de **persona dentro de um repo** permanece com o sub-projeto de personas
  (`/context-brain-generator`) — este hook nunca dispara dentro de um repo, então não há
  sobreposição.
- Ordem sugerida dos ciclos seguintes permanece: **worktree-por-jornada** →
  `/relationship` → `/context-brain-generator` → `/aipe-add-repo`.

---

## 8. Decisões fechadas nesta sessão

- **Um bloco só**, escolhido por `switch` no estado do onboarding — nunca dois, sem
  acúmulo de contexto.
- **Ativação só na raiz do workspace**, imposta pela plataforma (plugin em escopo de
  pasta); fronteira com personas é automática.
- **Opt-out apenas conversacional** (por sessão): o bloco sempre é injetado e carrega a
  instrução de parar se o PE pedir; sem arquivo de kill-switch persistente.
- **Bash orquestra + emite; Bun parseia o YAML** (robustez para brain editável à mão,
  sem dependência nova).
- **Matcher `startup|resume|clear|compact`** para sobreviver a `/clear` e compactação.
