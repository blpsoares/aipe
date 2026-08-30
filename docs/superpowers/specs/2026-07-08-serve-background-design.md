# `aipe serve --background` — spec + plan (PR-B)

## Problem (QA)

`aipe serve --background|-d|--detached` should detach the server as an
independent child, print the PID + how to kill it, and **return**. In the
compiled STANDALONE binary (`dist/aipe-<target>`) the command was
**blocking/broken**: it printed a PID but the port never came up — the child
died immediately.

## Root cause

`spawnDetached` reconstructed the child command as:

```
[process.execPath, process.argv[1], ...foregroundArgs(args)]
```

Two defects, both fatal in the compiled binary:

1. **Lost `serve` subcommand.** `run(args)` only receives the args *after*
   `serve` (e.g. `["--background","--port","4321"]`). The reconstructed
   command never re-added `serve`, so the child received `[--port, 4321,
   ...]` as if `--port` were the subcommand → `unknown command`.
2. **Virtual entry passed as an argument.** In a Bun single-file
   executable, `process.argv` is `["bun", "/$bunfs/root/<exe>", "serve",
   ...]`. `process.argv[1]` is the entry embedded in the virtual filesystem
   (`/$bunfs/…`). When re-running the binary, Bun itself re-injects that
   entry; passing it again pushed everything one position over and the
   child saw `/$bunfs/root/<exe>` as the subcommand → `unknown command "…"`
   → `exit 1`.

Reproduction (compiled binary):

```
$ ./dist/aipe-linux-x64 "/\$bunfs/root/aipe-linux-x64" --port 4321 --workspace X
ERROR command: unknown command "/$bunfs/root/aipe-linux-x64"
```

Also, the spawn didn't use `detached: true`, so even with the correct
command the child stayed in the same terminal session/group (vulnerable to
SIGHUP when the TTY closes).

The foreground lifecycle was **not** coupled to stdin/TTY (nothing reads
`process.stdin` in serve; the process stays alive via `Bun.serve` + `await
new Promise(() => {})`), so (a) is already honored — the child runs with
`stdin: "ignore"` and doesn't treat stdin EOF as shutdown.

## Fix

In `src/serve/cli.ts`:

- `isCompiled()` — detects the Bun single-file executable by the virtual
  entry prefix (`/$bunfs/…` on posix, `~BUN` on windows).
- `childCommand(args)` — correctly reconstructs the child command:
  - always re-adds the `serve` subcommand + the foreground flags (without
    the background flags);
  - **compiled**: `[<exe>, "serve", ...]` (the binary re-injects its own
    entry);
  - **dev**: `[<bun>, <script-entry>, "serve", ...]`.
- `spawnDetached` — spawn with `stdin/stdout/stderr: "ignore"` +
  `detached: true` + `unref()`: a new session (survives terminal SIGHUP),
  no coupling to stdin/TTY, and the parent can exit immediately.

Nothing in `server.ts` changes because of background mode — serve already
binds via `Bun.serve` and doesn't read stdin.

## Validation (real, standalone binary)

`bun run scripts/build.ts host` → `dist/aipe-linux-x64 serve --background
--port <n> --workspace <dir>`: prints PID + `kill`, returns; 5–10 s later the
PID is alive, `ss -ltnp` shows the port, `curl / = 200` and `curl
/api/monitor = 200`; `kill <pid>` stops it. Foreground unchanged.

## Fanout note (cross-dependency)

`server.ts` (this PR's slice) contains the `/api/monitor` endpoint,
which imports `./monitor` (`src/serve/monitor.ts`). That file belongs to
the sibling monitor PR and is **not** committed here (disjoint ownership to
avoid merge conflicts). Local validation uses an untracked copy of
`monitor.ts` just to compile. The two PRs need to be integrated together
for the build to go green.

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
