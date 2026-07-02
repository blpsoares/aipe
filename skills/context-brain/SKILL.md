---
name: context-brain
description: Use no onboarding de um contexto/time AIPe para mapear os repositórios (URLs, paths, stacks) e gravar .aipe/brain.yaml + .aipe/state.yaml. Não clona nem analisa código — só registra o conhecimento factual.
---

# /context-brain

Coleta interativa do contexto de um time e gravação determinística do brain file.
Você (coordenador) NÃO escreve o YAML à mão — coleta os dados do PE e delega a
gravação ao CLI tipado, que valida e serializa.

## Fluxo

1. **Confirme o workspace.** O brain é gravado em `<workspace>/.aipe/`. Por padrão o
   workspace é o diretório atual. Confirme com o PE se é aqui (deve ser uma pasta
   `aipe-<contexto>`).

2. **Colete os dados, uma pergunta por vez:**
   - Nome do **contexto** (slug: minúsculas, números, hífens — vira `aipe-<nome>`).
   - Nome do **coordenador** (como o PE quer te chamar).
   - Os **repositórios**: para cada um, `name`, `url` (git@, ou https com `.git`
     opcional) e `path`
     relativo (começando com `./`). `stack` é opcional — só preencha se o PE souber;
     senão deixe de fora (será preenchido em fases posteriores). O PE pode colar uma
     lista de uma vez.

3. **Monte o JSON** no formato `ContextInput`:
   ```json
   {
     "context": { "name": "<slug>", "coordinator": "<nome>" },
     "repos": [ { "name": "...", "url": "...", "path": "./...", "stack": ["..."] } ]
   }
   ```

4. **Grave via CLI.** Escreva o JSON em um arquivo temporário e rode:
   ```bash
   bun <caminho-do-plugin>/src/context-brain/cli.ts --input <arquivo.json> --workspace <workspace>
   ```

5. **Trate o resultado:**
   - Saída `OK brain=... / OK state=...` → confirme ao PE os arquivos gravados.
   - Linhas `ERRO <campo>: <mensagem>` → mostre ao PE, corrija o dado apontado e
     rode de novo. Não grave nada à mão.

## Regras

- Nunca edite `brain.yaml`/`state.yaml` diretamente aqui — sempre pelo CLI, para
  garantir formato válido.
- Uma pergunta por vez; não despeje todas de uma vez.
- Se o workspace não existir ou não parecer um `aipe-<contexto>`, pergunte antes de
  gravar.
