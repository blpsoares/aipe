# PR-C — Monitor: no SSE duplication + lanes per active specialist

Strict scope: `src/serve/monitor.ts`, `src/serve/__tests__/monitor.test.ts`
and the **Monitor** view in `src/serve/app.html`. Doesn't touch `server.ts`
or `cli.ts`.

> Out-of-scope dependency (reported, not edited): the `/api/monitor`
> endpoint and the `monitorStream()` that calls `startMonitor` live in
> `src/serve/server.ts`. This branch's base (`brand-green`) does **not**
> yet carry that route. For the Monitor to work end-to-end, `server.ts`
> needs to gain the `/api/monitor` route (already ready on the `brand`
> branch). That's another stream's matter.

## Defect 1 — SSE duplication (bug)

`drain()` computed `from = offsets.get(path)` (bytes already read) but
**never used it**: it re-read the whole file with `readFile` and
re-emitted every line on each transcript growth → each line came out N
times.

**Fix:** read only the new slice `[from, size)` via
`Bun.file(path).slice(from, size)`, consume only up to the **last `\n`**
(a partial line still being written is left for the next drain, avoiding
emitting incomplete JSON), and advance the offset by the number of bytes
actually consumed. A `draining` guard serializes concurrent drains
(watcher + timer) on the same path, closing the last duplication window.

Acceptance: `growing-transcript` test — 3 lines arriving at 3 moments ⇒
each event emitted exactly once (1/1/1), zero repetition.

## Defect 2 — "clutter" UX (multiplexing everything)

Before: a single stream interleaved **all** transcripts (including
completed ones and the coordinator's helper agents), with an "All"
selector that mixed everyone together.

Re-specification:

- **Only ACTIVE specialists by default.** "Active" = transcript touched
  within `activeWindowMs` (recent mtime). An already-completed/historical
  agent enters the roster as `active:false`; the UI hides it by default (a
  "All" toggle reveals it). The coordinator's exploration helper agents
  (`agentType === "Explore"`) stay out of the lanes by default.
- **One lane per active specialist**, identity `Persona · branch/task`
  (the label comes from the `.meta.json` sidecar, which already carries
  the persona + task context).
- **Left = that agent's stream** (reasoning + commands); **right =
  files that THAT agent changes**. No interleaving between agents.
- **Grouped by activity type**: reasoning (`say`), command (`tool`),
  edit (`file`).
- **Clear empty state** when no specialist is active.

For the UI to assemble the lanes without correlating on its own,
`startMonitor` now emits, alongside the content events, a **roster**
event (`kind: "agent"`) per agent with `{persona, agentType, active}`,
deduped (only when it changes). The backlog of an agent that is already
historical at discovery time is **not** re-emitted (it records the
offset and moves on), keeping the stream lean and consistent with
"active-only".

Read-only: aipe doesn't write any JSONL; it only reads/tails.
