---
name: make-workspace
description: Use na etapa 2 do onboarding AIPe para materializar (git clone) os repositórios declarados no .aipe/brain.yaml dentro do workspace, de forma idempotente. Não cria worktree, não detecta stack, não edita o brain.
---

# /make-workspace

Materializa na máquina os repos do brain de um contexto. Você (coordenador) NÃO clona
à mão — delega ao CLI tipado, que decide por repo (clonar / pular / erro), nunca
sobrescreve nada e atualiza o `state.yaml`.

## Fluxo

1. **Confirme o workspace.** Por padrão é o diretório atual (deve ser uma pasta
   `aipe-<contexto>` com `.aipe/brain.yaml`).

2. **Cheque a pré-condição.** O brain precisa existir. Se não houver
   `<workspace>/.aipe/brain.yaml`, oriente o PE a rodar `/context-brain` primeiro —
   não faz sentido clonar sem o mapa.

3. **Execute o CLI:**
   ```bash
   bun <caminho-do-plugin>/src/make-workspace/cli.ts --workspace <workspace>
   ```

4. **Traduza a saída ao PE** (uma linha por repo):
   - `OK cloned <repo>` → clonado agora.
   - `SKIP <repo> (já presente)` → já estava lá, nada tocado.
   - `ERRO <repo>: <mensagem>` → falhou (auth, rede, ou path ocupado por conteúdo
     diferente). Explique e sugira a correção (ex: dar acesso ao repo, mover a pasta
     ocupada, ou corrigir a URL no brain via `/context-brain`).
   - `STATE workspace=done|pending` → estado agregado.

5. **Próximo passo:** se `workspace=done` (todos presentes), o contexto está pronto
   para a `/relationship`. Se `pending`, liste ao PE o que falta; re-rodar é seguro e
   completa só o que faltou.

## Regras

- Nunca clone nem edite `brain.yaml`/`state.yaml` à mão — sempre pelo CLI.
- Não crie worktrees aqui (é outro sub-projeto).
- Falha de autenticação nunca é contornada: reporte a mensagem do git ao PE.
