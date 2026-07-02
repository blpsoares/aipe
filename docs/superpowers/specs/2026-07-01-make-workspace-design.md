# AIPe — `/make-workspace`

**Data:** 2026-07-01
**Status:** Design aprovado
**Sub-projeto:** etapa 2 do pipeline de onboarding (ver
`2026-07-01-aipe-context-brain-design.md`)

---

## 1. Propósito & escopo

A `/make-workspace` é a **etapa 2** do pipeline de onboarding: transforma o mapa
factual (o `brain.yaml`) em **código presente na máquina**. Ela lê
`<workspace>/.aipe/brain.yaml`, materializa cada repositório no `path` declarado (via
`git clone`) e atualiza `<workspace>/.aipe/state.yaml`.

### Faz
- Lê e valida `<workspace>/.aipe/brain.yaml`.
- Clona cada repo declarado no seu `path` relativo ao workspace.
- Atualiza a fase `workspace` em `state.yaml`.
- Reporta ao PE, por repo, o que foi clonado / pulado / falhou.

### NÃO faz (fronteiras explícitas)
- **Não** cria worktree por jornada → é um **sub-projeto fundacional próprio**
  (removido do escopo desta skill).
- **Não** detecta stack → responsabilidade da `/relationship`, que lê o código a fundo
  (fecha a questão em aberto §8 do spec de fundação: quem preenche `stack` é a
  `/relationship`).
- **Não** edita `brain.yaml` → só lê. O brain é fonte de verdade da `/context-brain`.
- **Não** injeta contexto de sessão → isso é o hook `SessionStart`, próximo
  sub-projeto fundacional (ver §7).

---

## 2. Fluxo (skill orquestra, CLI executa)

Mesmo padrão da `/context-brain`: a **skill** é conversacional e orquestra; o trabalho
determinístico (ler/validar/clonar/serializar) vive num **CLI tipado e testável**.

1. A skill confirma o **workspace** (por padrão, diretório atual; deve ser uma pasta
   `aipe-<contexto>`).
2. A skill checa `state.phase.brain == done`. Se o brain ainda não existe ou não está
   `done`, orienta o PE a rodar `/context-brain` antes — não faz sentido clonar sem
   mapa.
3. A skill executa:
   ```bash
   bun <caminho-do-plugin>/src/make-workspace/cli.ts --workspace <workspace>
   ```
4. O CLI faz o trabalho e imprime **status por repo**.
5. A skill lê a saída e **reporta ao PE** em linguagem natural: o que clonou, o que já
   estava presente, o que falhou e por quê. Nada de YAML editado à mão.

---

## 3. CLI tipado — comportamento

### Entrada
- Flag `--workspace <path>` (default: diretório atual).
- Lê `<workspace>/.aipe/brain.yaml` e **valida** contra os tipos existentes em
  `src/context-brain/types.ts` (`BrainFile`, `RepoEntry`). Brain ausente ou malformado
  → erro claro, nada é clonado.

### Materialização (sequencial, repo a repo)
Para cada `repo` do brain, na ordem do arquivo:

| Situação do `path` | Ação | Status |
|---|---|---|
| Não existe | `git clone <url> <path>` | `cloned` |
| Existe, é git repo do **mesmo** remote | não toca | `skipped` |
| Existe, mas **diverge** (não é git, ou remote diferente) | não toca | `error` (path ocupado) |
| Clone falha (auth/rede) | — | `error` (mensagem do git) |

- **Sequencial** por escolha de design: saída limpa e previsível, alinhado com a
  prioridade de confiabilidade.
- Usa as **credenciais git/ssh já configuradas** do usuário. **Nunca** pede senha
  interativamente nem tenta contornar autenticação — em falha de auth, falha limpo e
  reporta a mensagem do git.
- **Idempotente e não-destrutivo:** nunca sobrescreve nem apaga nada. Re-rodar completa
  só o que falta.

### Saída (legível pela skill)
Uma linha por repo, prefixo estável para a skill parsear e traduzir ao PE. Exemplos:
```
OK cloned embark
SKIP prontuario (já presente)
ERRO faturamento: Permission denied (publickey)
```
E uma linha final de agregação de estado, ex.:
```
STATE workspace=pending (1 erro de 5 repos)
```

### Fronteira injetável para teste
O `git clone` de verdade fica atrás de uma abstração injetável (um "cloner": função/
interface que recebe `url`+`path` e devolve sucesso/erro, além de um "inspetor" de repo
existente que informa se um path é git e qual o remote). Assim os testes rodam sem rede
e sem tocar em repositórios reais.

---

## 4. `state.yaml`

- A fase `workspace` vira `done` **somente se todos** os repos do brain estão
  materializados (`cloned` **ou** `skipped`). Qualquer `error` → permanece `pending`.
- Semântica **binária**, mantendo o enum atual `Phase = "pending" | "done"` sem
  ampliar o schema. Sem status granular por-repo no state (o granular vive só na saída
  da execução, para o PE).
- Consequência: `/relationship` (etapa 3) só deve rodar com `workspace == done`, isto é,
  com todos os repos presentes.

---

## 5. Erros & robustez

- **Brain ausente/malformado:** aborta antes de clonar, com mensagem apontando o
  problema. `state` não é alterado.
- **Path ocupado divergente:** reportado como `error`; nada é tocado. O PE decide
  (mover a pasta, corrigir o brain, etc.) e re-roda.
- **Falha de auth/rede em um repo:** não interrompe os demais — o CLI continua os
  outros repos e agrega o resultado; a fase fica `pending` enquanto houver erro.
- **Re-execução:** sempre segura (idempotência da §3).

---

## 6. Testes (`bun test`, padrão do repo)

- Validação: brain ausente / malformado → erro claro, sem clonar.
- Clone feliz: path inexistente → `cloned` (via cloner fake).
- Idempotência: path presente com mesmo remote → `skipped`, sem chamar o cloner.
- Path ocupado divergente (não-git ou remote diferente) → `error`, sem sobrescrever.
- Falha do cloner (auth/rede) → `error`, demais repos seguem.
- Agregação de state: todos ok → `workspace=done`; qualquer erro → `workspace=pending`.
- Preservação: `brain.yaml` nunca é modificado pela execução.

---

## 7. Impacto no roadmap (registrado no doc de fundação)

Duas decisões desta sessão que atualizam o spec de fundação:

1. **`/make-workspace` = clone-only.** O setup de worktree por jornada **sai do escopo**
   desta skill e vira sub-projeto fundacional próprio.
2. **Hook de injeção de contexto (`SessionStart`)** entra como sub-projeto fundacional.
   Ideia central (a ser especificada no seu próprio ciclo): quando uma sessão abre num
   `aipe-<contexto>/` com o plugin instalado em escopo de pasta, o hook lê `.aipe/`
   (`brain.yaml` + `state.yaml`) e **injeta a "consciência" do coordenador** — quem ele
   é (nome), qual o contexto, os repos, a fase do pipeline e o próximo passo sugerido.
   **Por padrão é ativo** (instalar ali significa "é pra operar assim"); só deixa de ser
   injetado/seguido se o PE **explicitamente** pedir para sair do modo AIPe (opt-out).

Ordem sugerida dos próximos ciclos: **`/make-workspace`** (este) → **hook de contexto
(`SessionStart`)** → **worktree-por-jornada** → **`/relationship`** →
**`/context-brain-generator`** → **`/aipe-add-repo`**.

---

## 8. Estrutura de código proposta

Espelha `src/context-brain/`:

```
src/make-workspace/
  ├── types.ts        # reusa BrainFile/RepoEntry de context-brain; tipos de resultado por-repo
  ├── read.ts         # lê + valida brain.yaml do workspace
  ├── clone.ts        # cloner + inspetor injetáveis; lógica de decisão por-repo
  ├── run.ts          # orquestra: lê brain → materializa cada repo → agrega state
  ├── cli.ts          # parse de flags, chama run, imprime status por-repo + STATE
  └── __tests__/
skills/make-workspace/SKILL.md
```
