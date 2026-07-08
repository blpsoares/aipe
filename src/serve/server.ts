// The live `aipe serve` server: the pure GET handler + a realtime SSE snapshot
// stream (`/api/stream`) + a WebSocket terminal (`/api/terminal`), all on Bun's
// built-in HTTP server. Zero external dependencies.
//
// Realtime with no loss, low complexity (the PE's call): the SSE stream pushes a
// fresh snapshot the instant `.aipe/` changes (fs.watch, debounced) AND reconciles
// on a slow timer so a missed filesystem event can never leave the UI stale.
import { watch } from "node:fs";
import { join } from "node:path";
import type { Server, ServerWebSocket } from "bun";
import appAsset from "./app.html" with { type: "text" };
import { buildSnapshot } from "../dashboard/snapshot";
import { handleRequest } from "./handler";
import { startMonitor } from "./monitor";
import { createTerminalSession, defaultShell, type TerminalSession } from "./terminal";

export interface ServeOpts {
  workspace: string;
  port: number;
  host: string;
  allowRemoteTerminal: boolean;
}

export function isLoopback(host: string): boolean {
  return host === "127.0.0.1" || host === "::1" || host === "localhost";
}

// The import attribute `type: "text"` yields the file's contents as a string at
// runtime (and `--compile` embeds it); the cast just corrects TS, which types
// bare `*.html` imports as an HTMLBundle.
const app = appAsset as unknown as string;

const RECONCILE_MS = 3000;
const HEARTBEAT_MS = 25000;
const DEBOUNCE_MS = 150;

// SSE stream of snapshots. Compares snapshots without their timestamp so we only
// push on a real change, but always converge (safety reconcile) — no lost update.
function snapshotStream(workspace: string): Response {
  let watcher: ReturnType<typeof watch> | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let reconcile: ReturnType<typeof setInterval> | null = null;
  let debounce: ReturnType<typeof setTimeout> | null = null;
  let lastKey = "";
  let closed = false;

  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      const emit = (chunk: string): void => {
        if (closed) return;
        try {
          controller.enqueue(enc.encode(chunk));
        } catch {
          closed = true;
        }
      };
      const maybePush = async (force = false): Promise<void> => {
        const snapshot = await buildSnapshot(workspace);
        const { generatedAt: _ts, ...rest } = snapshot;
        const key = JSON.stringify(rest);
        if (!force && key === lastKey) return;
        lastKey = key;
        emit(`event: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`);
      };

      await maybePush(true);

      try {
        watcher = watch(join(workspace, ".aipe"), { recursive: true }, () => {
          if (debounce) clearTimeout(debounce);
          debounce = setTimeout(() => void maybePush(), DEBOUNCE_MS);
        });
      } catch {
        // .aipe may not exist yet; the reconcile timer still covers it
      }
      reconcile = setInterval(() => void maybePush(), RECONCILE_MS);
      heartbeat = setInterval(() => emit(": ping\n\n"), HEARTBEAT_MS);
    },
    cancel() {
      closed = true;
      watcher?.close();
      if (heartbeat) clearInterval(heartbeat);
      if (reconcile) clearInterval(reconcile);
      if (debounce) clearTimeout(debounce);
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store",
      connection: "keep-alive",
    },
  });
}

// SSE stream of live specialist-monitor events (what each dispatched subagent is
// doing right now). Read-only tail of the harness transcripts — see monitor.ts.
function monitorStream(workspace: string): Response {
  let tail: ReturnType<typeof startMonitor> | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let closed = false;

  const stream = new ReadableStream({
    start(controller) {
      const enc = new TextEncoder();
      const emit = (chunk: string): void => {
        if (closed) return;
        try {
          controller.enqueue(enc.encode(chunk));
        } catch {
          closed = true;
        }
      };
      tail = startMonitor(workspace, (ev) => emit(`event: monitor\ndata: ${JSON.stringify(ev)}\n\n`));
      heartbeat = setInterval(() => emit(": ping\n\n"), HEARTBEAT_MS);
    },
    cancel() {
      closed = true;
      tail?.close();
      if (heartbeat) clearInterval(heartbeat);
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store",
      connection: "keep-alive",
    },
  });
}

interface WsData {
  session?: TerminalSession;
}

export function startServer(opts: ServeOpts): Server<WsData> {
  const { workspace, port, host, allowRemoteTerminal } = opts;
  const terminalAllowed = isLoopback(host) || allowRemoteTerminal;

  return Bun.serve<WsData>({
    port,
    hostname: host,
    // The SSE snapshot stream and the terminal WebSocket are long-lived; Bun's
    // default 10s idle timeout would cut the stream before the 25s heartbeat.
    // 255s is Bun's max — the heartbeat keeps the SSE connection alive under it.
    idleTimeout: 255,
    async fetch(req, server) {
      const url = new URL(req.url);

      if (url.pathname === "/api/terminal") {
        if (!terminalAllowed) {
          return new Response("terminal disabled on a non-loopback host — restart with --allow-remote-terminal", { status: 403 });
        }
        if (server.upgrade(req, { data: {} })) return undefined;
        return new Response("expected a websocket upgrade", { status: 400 });
      }

      if (url.pathname === "/api/stream") {
        return snapshotStream(workspace);
      }

      if (url.pathname === "/api/monitor") {
        return monitorStream(workspace);
      }

      return handleRequest(req, { workspace, html: app });
    },
    websocket: {
      open(ws: ServerWebSocket<WsData>) {
        const session = createTerminalSession({
          cwd: workspace,
          onData: (chunk) => ws.send(JSON.stringify({ t: "out", d: chunk })),
          onTurnEnd: (code) => ws.send(JSON.stringify({ t: "end", code })),
          onExit: (code) => {
            try {
              ws.send(JSON.stringify({ t: "exit", code }));
            } catch {
              // socket already gone
            }
            try {
              ws.close();
            } catch {
              // already closed
            }
          },
        });
        ws.data.session = session;
        ws.send(JSON.stringify({ t: "ready", cwd: workspace, shell: defaultShell() }));
      },
      message(ws: ServerWebSocket<WsData>, raw) {
        const session = ws.data.session;
        if (!session) return;
        try {
          const msg = JSON.parse(typeof raw === "string" ? raw : raw.toString());
          if (msg && msg.t === "run" && typeof msg.d === "string") session.run(msg.d);
        } catch {
          // ignore malformed frames
        }
      },
      close(ws: ServerWebSocket<WsData>) {
        ws.data.session?.close();
        ws.data.session = undefined;
      },
    },
  });
}
