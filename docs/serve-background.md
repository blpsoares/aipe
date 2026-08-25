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

## Access control off loopback

`aipe serve` binds `127.0.0.1` by default and on loopback nothing below
applies — the console is reachable only from the machine already running it.

Any other host is different. The console serves the entire workspace over
`/api/snapshot` (repos, personas, journeys) and streams the code specialists
are writing over `/api/monitor`, `Write` file contents included. Both were
answering anyone on the network, unauthenticated: `isLoopback()` existed in
`src/serve/server.ts` and was tested, and was never called.

So off loopback every request carries a token:

```sh
aipe serve --host 0.0.0.0
# aipe serve — web console at http://localhost:4317/?token=b0jU-xdf…
# aipe serve — bound to 0.0.0.0 (reachable from the network), so a token is required.
```

The token is accepted from three places, because each is the only one that
works for its caller:

| Source | Who uses it |
|---|---|
| `?token=…` | The operator opening the printed URL, once |
| `aipe_serve_token` cookie | The SPA's own fetches and SSE streams — they carry no query string |
| `Authorization: Bearer …` | Scripts and `curl` |

A correct URL token is promoted to an `HttpOnly`, `SameSite=Strict` cookie. It
is deliberately **not** `Secure`: the console runs over plain HTTP on a LAN, and
marking it Secure would make the browser silently never send it, locking the
operator out rather than protecting anything.

Comparison is constant-time, and a missing token and a wrong token get the
identical 401 — distinguishing them is a free oracle.

### Pinning the token

```sh
AIPE_SERVE_TOKEN=my-own-token aipe serve --host 0.0.0.0
```

Worth doing for a long-lived console. `aipe upgrade` restarts running consoles
onto the new binary, and it reuses the recorded token precisely so that restart
does not invalidate the cookie every open browser is holding — the restart is
unattended, with nobody watching to re-open the printed URL. The token is
persisted in `~/.aipe/serve/<pid>.json`, written `0600`, and passed to the
restart through the environment, never an argv (an argv is visible in `ps` to
every user on the machine).

### Opting out

```sh
aipe serve --host 0.0.0.0 --insecure
```

For a genuinely trusted network. It has to be typed, and it warns:

```
aipe serve — WARNING: --insecure on 0.0.0.0: anyone who can reach this port can read
aipe serve —          your workspace and the code your specialists are writing.
```
