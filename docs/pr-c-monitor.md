# PR-C — Monitor: sem duplicação SSE + lanes por especialista ativo

Escopo estrito: `src/serve/monitor.ts`, `src/serve/__tests__/monitor.test.ts` e a
view **Monitor** em `src/serve/app.html`. Não toca `server.ts` nem `cli.ts`.

> Dependência de fora do escopo (reportada, não editada): o endpoint
> `/api/monitor` e o `monitorStream()` que chama `startMonitor` moram em
> `src/serve/server.ts`. A base desta branch (`brand-green`) ainda **não** traz
> essa rota. Para o Monitor funcionar ponta-a-ponta, `server.ts` precisa ganhar a
> rota `/api/monitor` (já existe pronta na branch `brand`). Isso é de outro stream.

## Defeito 1 — duplicação SSE (bug)

`drain()` calculava `from = offsets.get(path)` (bytes já lidos) mas **nunca usava**:
relia o arquivo inteiro com `readFile` e re-emitia todas as linhas a cada
crescimento do transcript → cada linha saía N vezes.

**Fix:** ler só o trecho novo `[from, size)` via `Bun.file(path).slice(from, size)`,
consumir apenas até o **último `\n`** (uma linha parcial ainda sendo escrita fica
para o próximo drain, evitando emitir JSON incompleto), e avançar o offset pelo
número de bytes realmente consumidos. Um guard `draining` serializa drains
concorrentes (watcher + timer) no mesmo path, fechando a última janela de dup.

Aceite: teste `growing-transcript` — 3 linhas chegando em 3 momentos ⇒ cada
evento emitido exatamente 1 vez (1/1/1), zero repetição.

## Defeito 2 — UX "bagunça" (multiplexação de tudo)

Antes: um stream único interleava **todos** os transcripts (incl. concluídos e os
agentes-helper do coordenador), com um seletor "All" que misturava todo mundo.

Reespecificação:

- **Só especialistas ATIVOS por default.** "Ativo" = transcript tocado dentro de
  `activeWindowMs` (mtime recente). Agente já concluído/histórico entra no roster
  como `active:false`; a UI o esconde por default (toggle "Todos" revela).
  Agentes-helper de exploração do coordenador (`agentType === "Explore"`) ficam
  fora das lanes por default.
- **Uma lane por especialista ativo**, identidade `Persona · branch/task` (o
  rótulo vem do sidecar `.meta.json`, que já carrega persona + contexto da tarefa).
- **Esquerda = stream daquele agente** (raciocínio + comandos); **direita =
  arquivos que AQUELE agente altera**. Nada de interleave entre agentes.
- **Agrupado por tipo de atividade**: raciocínio (`say`), comando (`tool`),
  edição (`file`).
- **Empty state claro** quando nenhum especialista está ativo.

Para a UI montar as lanes sem correlacionar por conta própria, `startMonitor`
passa a emitir, além dos eventos de conteúdo, um evento de **roster**
(`kind: "agent"`) por agente com `{persona, agentType, active}`, dedupado (só
quando muda). Backlog de um agente já-histórico-na-descoberta **não** é re-emitido
(registra o offset e segue), mantendo o stream enxuto e coerente com "só ativos".

Read-only: aipe não escreve nenhum JSONL; só lê/tail.
