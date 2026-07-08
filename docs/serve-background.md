# `aipe serve --background` — spec + plano (PR-B)

## Problema (QA)

`aipe serve --background|-d|--detached` deveria destacar o servidor como um filho
independente, imprimir o PID + como matar, e **retornar**. No binário STANDALONE
compilado (`dist/aipe-<target>`) o comando era **bloqueante/quebrado**: imprimia um
PID mas a porta nunca subia — o filho morria imediatamente.

## Causa-raiz

`spawnDetached` reconstruía o comando do filho como:

```
[process.execPath, process.argv[1], ...foregroundArgs(args)]
```

Dois defeitos, ambos fatais no binário compilado:

1. **Subcomando `serve` perdido.** `run(args)` recebe apenas os args *depois* de
   `serve` (ex.: `["--background","--port","4321"]`). O comando reconstruído nunca
   readicionava `serve`, então o filho recebia `[--port, 4321, ...]` como se `--port`
   fosse o subcomando → `unknown command`.
2. **Entry virtual passado como argumento.** Num executável single-file do Bun,
   `process.argv` é `["bun", "/$bunfs/root/<exe>", "serve", ...]`. `process.argv[1]`
   é o entry embutido no filesystem virtual (`/$bunfs/…`). Ao re-executar o binário,
   o próprio Bun re-injeta esse entry; passá-lo de novo empurrava tudo uma posição e
   o filho via `/$bunfs/root/<exe>` como subcomando → `unknown command "…"` → `exit 1`.

Reprodução (binário compilado):

```
$ ./dist/aipe-linux-x64 "/\$bunfs/root/aipe-linux-x64" --port 4321 --workspace X
ERROR command: unknown command "/$bunfs/root/aipe-linux-x64"
```

Além disso o spawn não usava `detached: true`, então mesmo com o comando certo o
filho ficava na mesma sessão/grupo do terminal (vulnerável a SIGHUP ao fechar o TTY).

O lifecycle do foreground **não** estava acoplado a stdin/TTY (nada lê `process.stdin`
no serve; o processo se mantém vivo por `Bun.serve` + `await new Promise(() => {})`),
então (a) já é honrado — o filho roda com `stdin: "ignore"` e não trata EOF de stdin
como shutdown.

## Fix

Em `src/serve/cli.ts`:

- `isCompiled()` — detecta o executável single-file do Bun pelo prefixo do entry
  virtual (`/$bunfs/…` no posix, `~BUN` no windows).
- `childCommand(args)` — reconstrói o comando do filho corretamente:
  - sempre readiciona o subcomando `serve` + os flags de foreground (sem os flags de
    background);
  - **compilado**: `[<exe>, "serve", ...]` (o binário re-injeta o próprio entry);
  - **dev**: `[<bun>, <script-entry>, "serve", ...]`.
- `spawnDetached` — spawn com `stdin/stdout/stderr: "ignore"` + `detached: true` +
  `unref()`: nova sessão (sobrevive a SIGHUP do terminal), sem acoplamento a stdin/TTY,
  e o pai pode sair imediatamente.

Nada em `server.ts` muda por causa do background — o serve já faz bind via `Bun.serve`
e não lê stdin.

## Validação (real, binário standalone)

`bun run scripts/build.ts host` → `dist/aipe-linux-x64 serve --background --port <n>
--workspace <dir>`: imprime PID + `kill`, retorna; 5–10 s depois o PID vive, `ss -ltnp`
mostra a porta, `curl / = 200` e `curl /api/monitor = 200`; `kill <pid>` para. Foreground
inalterado.

## Nota de fanout (dependência cruzada)

`server.ts` (fatia desta PR) contém o endpoint `/api/monitor`, que importa
`./monitor` (`src/serve/monitor.ts`). Esse arquivo pertence à PR irmã do monitor e
**não** é commitado aqui (ownership disjunto para evitar conflito de merge). A validação
local usa uma cópia untracked de `monitor.ts` só para compilar. As duas PRs precisam ser
integradas juntas para o build ficar verde.
