# AIPe — AI Product Engineer

**Data:** 2026-07-01
**Status:** Design aprovado (fundação) — spec focado na `/context-brain`

---

## 1. Visão

AIPe é um framework (distribuído como **plugin** do Claude Code) que transforma o
Claude num **coordenador geral** de engenharia e o usuário num **Product Engineer
(PE)**. O PE traz demandas (bugs, features, tarefas de escopos e repos diferentes);
o coordenador decompõe, distribui para **especialistas** que trabalham em paralelo,
e devolve entregas (PRs) — sempre respeitando as relações entre os repos.

A analogia central é a de uma **empresa**:

| Papel | Quem é | Mecânica real |
|---|---|---|
| **PE** | O usuário. CEO/Product: define missão, prioridade, aprova orçamento, decide cross-repo. | Usuário no comando, aprovando entre fases |
| **Coordenador** | O Claude principal. Gerente/Head: recebe demanda, decompõe, contrata, revisa, escala. Tem **nome** definido pelo PE. | Workflow + o loop principal lendo resultados |
| **RH** | Trava de contratação: valida vaga contra teto e disponibilidade. | Função de política aplicada antes de abrir agente |
| **Especialistas (PJ)** | Devs contratados por tarefa. Escopo isolado, não tocam outro repo, escalam pra cima. Têm **nomes**. | Subagentes (`agent()`) disparados pelo coordenador |

---

## 2. Terminologia

- **Contexto / time** — um agrupamento de repos que pertencem ao mesmo time/empresa.
- **Workspace** — a pasta-guarda-chuva de um contexto, na raiz do usuário, nomeada
  `aipe-<contexto>` (ex: `aipe-opvibes`). É onde a sessão é aberta com o plugin AIPe
  instalado no **escopo de pasta**, e onde vivem os artefatos de contexto e os repos.
- **Jornada** — uma sessão de expediente do PE com um coordenador. Pode haver várias
  jornadas em paralelo; por isso o trabalho roda em **worktrees** isolados.
- **Brain file** — o mapa factual do contexto (repos, URLs, paths, stacks).
- **Especialista / persona** — um "dev" com nome, materializado como skill instalada
  **dentro do repo** que ele domina.

---

## 3. Modelo de persistência (híbrido)

Artefatos têm naturezas diferentes e moram em lugares diferentes:

```
aipe-<contexto>/                    ← workspace (raiz do usuário, plugin em escopo de pasta)
  ├── .aipe/
  │    ├── brain.yaml               ← mapa (URLs, paths, stacks)      [cross-repo]
  │    ├── relations/               ← saída da /relationship          [cross-repo]
  │    ├── personas.yaml            ← registro (coordenador + PJs)     [cross-repo]
  │    └── state.yaml               ← fase do onboarding
  ├── <repo-a>/                     ← clonado pelo /make-workspace
  │    └── .claude/skills/<joaquim>/  ← skill-persona instalada NO repo
  └── <repo-b>/
       └── .claude/skills/<maria>/
```

- **Artefatos de contexto** (brain, relations, personas, state) → `.aipe/` no workspace.
- **Skills-persona** → dentro de cada repo, para que abrir uma sessão direto no repo
  carregue automaticamente a persona daquele especialista.
- **O plugin AIPe** (as skills `/context-brain`, `/make-workspace`, etc.) é a
  *ferramenta*; os artefatos acima são os *dados* que ela produz.

---

## 4. Pipeline de onboarding (ordem por dependência de dados)

```
1. /context-brain          → URLs + paths + stacks (sem clonar)      [não precisa de código]
2. /make-workspace (clone) → materializa os repos na máquina          [precisa das URLs do brain]
3. /relationship           → dispara N agentes que LEEM o código,
                             cada um descobre relações do seu repo,
                             coordenador SINTETIZA e documenta         [precisa dos repos presentes]
4. /context-brain-generator → gera skills-persona                     [precisa de stacks + relações]
```

Concluídas as 4 etapas, o "onboarding do coordenador" está completo e começa o
**expediente** (jornadas / sessões N).

---

## 5. `/context-brain` — spec detalhado (sub-projeto atual)

### Propósito
Produzir o **brain file**: o mapa factual de um contexto, gravado em
`<workspace>/.aipe/brain.yaml`. É só conhecimento — **não clona, não analisa código**.
É a fonte de verdade que as outras 3 skills leem.

### Entrada (interativa)
A skill roda de forma conversacional e **o PE declara** os repos:
1. Pergunta o **nome do contexto** (`context.name`).
2. Pergunta o **nome do coordenador** (`context.coordinator`).
3. Recebe os **repos** (URL + path pretendido). O PE pode colar uma lista.
4. **Valida** o que dá sem clonar (URL bem formada, paths sem colisão).
5. Grava `brain.yaml` e inicializa `state.yaml`.

### Formato — `brain.yaml`
```yaml
context:
  name: opvibes          # nome do contexto/time
  coordinator: Nicolas   # nome que o PE deu ao coordenador
repos:
  - name: embark
    url: git@github.com:opvibes/embark.git
    path: ./embark         # relativo ao workspace (portátil entre máquinas)
    stack: [typescript, bun]   # opcional aqui; preenchido depois se desconhecido
  - name: prontuario
    url: git@github.com:opvibes/prontuario.git
    path: ./prontuario
```

**Escolha de formato: YAML** — porque o PE vai querer abrir e editar na mão
(adicionar repo, corrigir path). `stack` é opcional nesta fase: detecção real de stack
exige o código presente, então pode ser declarada pelo PE ou preenchida no
clone/relationship.

### Estado — `state.yaml`
```yaml
phase:
  brain: done
  workspace: pending      # clone ainda não rodou
  relationship: pending
  generator: pending
```
Qualquer sessão futura lê isso e sabe "onde o coordenador parou". O disparo de cada
fase continua sendo um ato deliberado do PE (controle + custo).

### Convenção de nome do workspace
`aipe-<context.name>` (ex: `aipe-opvibes`). Amarra ao framework, herda o nome do
contexto, é curto e ordenável.

---

## 6. Decisões de design já fechadas (para as fases seguintes)

Registradas aqui para não se perderem — cada uma vira spec própria no seu ciclo.

- **Isolamento por worktree:** toda jornada trabalha em worktrees; jornadas paralelas
  não colidem. Convenção sugerida:
  `<repo>/.worktrees/<jornada-id>-<especialista>/`.
- **Conflito de mesmo repo = trava física:** tasks no mesmo repo **serializam** (ou
  worktrees separados); repos diferentes rodam em paralelo à vontade. É a única lei
  que o coordenador não pode quebrar.
- **Pool de especialistas (modelo "PJ"):** teto de **16 simultâneos** (limite real de
  concorrência da ferramenta). O especialista **solicita** mais PJs ao coordenador; o
  coordenador **analisa** se a demanda justifica (5? 2? nenhum?) e o **RH** valida
  contra o teto e o custo. Contratação cara sobe pro PE.
- **Persona em dois modos:** a skill-persona precisa funcionar como (A) **subagente**
  disparado pelo coordenador e (B) **persona interativa** — o Claude principal
  "vestindo" a persona ao abrir sessão no repo, para pair direto com o PE.
- **Arquivo de progresso por task:** pasta-padrão de scratchpad por task/especialista,
  contexto de trabalho **descartável**, deletado na resolução final. **Regra de
  guardrail:** nada irreversível vive só nele — a entrega real é o **PR + histórico
  git**.
- **Entrega:** o especialista **sempre abre o PR final**.
- **Registro de personas:** guarda nome do coordenador + nomes dos especialistas por
  área/repo. Na criação, o PE informa quantos nomes quiser; os que faltarem são
  gerados aleatoriamente e salvos.
- **Persona + skills de terceiros (SDD/PDD/superpowers):** carga por ordem — a
  skill-persona carrega primeiro (estabelece o contexto), depois a skill de terceiro
  (ex: `/speckit-specify`) opera dentro desse contexto. **A validar em protótipo.**

---

## 7. Roadmap (sub-projetos, cada um com seu próprio ciclo spec → plano → impl.)

1. **`/context-brain`** — *(este spec)* fundação factual.
2. **`/make-workspace`** — clone inicial + setup de worktree por jornada (possíveis
   dois modos).
3. **`/relationship`** — fan-out de agentes read-only descobrindo relações entre repos;
   coordenador sintetiza e documenta. É um caso legítimo de workflow.
4. **`/context-brain-generator`** — gera as skills-persona (formato dois-modos),
   incluindo especialista-stack e qa-dedicado.
5. **`/aipe-add-repo`** (incremental) — adiciona um repo novo, remapeia só as relações
   afetadas e gera/atualiza o especialista, sem reescrever o brain na mão. Empresas só
   crescem; escrever à mão não escala.

---

## 8. Questões em aberto

- Detecção automática de `stack` (quando o código estiver presente): quem preenche o
  brain de volta — `/make-workspace` ou `/relationship`?
- Formato exato de `personas.yaml` e do "brief de contratação" (o objeto que o
  coordenador entrega ao especialista): será desenhado no ciclo do
  `/context-brain-generator`.
- Protótipo da carga persona + skill de terceiro (ordem de carregamento).
