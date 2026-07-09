// The live `aipe serve` server: the pure GET handler + a realtime SSE snapshot
// stream (`/api/stream`) + a live specialist-monitor stream (`/api/monitor`),
// all on Bun's built-in HTTP server. Zero external dependencies.
//
// Realtime with no loss, low complexity (the PE's call): the SSE stream pushes a
// fresh snapshot the instant `.aipe/` changes (fs.watch, debounced) AND reconciles
// on a slow timer so a missed filesystem event can never leave the UI stale.
import { watch } from "node:fs";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import type { Server } from "bun";
import { buildSnapshot } from "../dashboard/snapshot";
import { buildClient } from "./app/build-client";
import { handleRequest } from "./handler";
import { startMonitor } from "./monitor";

export interface ServeOpts {
  workspace: string;
  port: number;
  host: string;
}

export function isLoopback(host: string): boolean {
  return host === "127.0.0.1" || host === "::1" || host === "localhost";
}

// Compilado: bundle pré-buildado embutido (gerado por scripts/build.ts antes do
// `--compile`). Dev: rebuild on-the-fly com cache por mtime de main.tsx. The
// dynamic import + try/catch keeps module load from failing in dev, where the
// generated asset does not exist on disk.
let PREBUILT: string | null = null;
try {
  // @ts-expect-error - asset gerado, ausente em dev
  PREBUILT = (await import("./app/app.generated.html", { with: { type: "text" } })).default;
} catch {
  PREBUILT = null;
}

let devCache: { html: string; key: number } | null = null;
function isCompiled(): boolean {
  const p = Bun.main || process.argv[1] || "";
  return p.startsWith("/$bunfs/") || p.startsWith("~BUN") || p.startsWith("B:\\");
}

export async function getAppHtml(): Promise<string> {
  if (isCompiled() && PREBUILT) return PREBUILT;
  const entry = new URL("./app/main.tsx", import.meta.url).pathname;
  const key = (await stat(entry)).mtimeMs;
  if (!devCache || devCache.key !== key) {
    devCache = { html: await buildClient({ minify: false }), key };
  }
  return devCache.html;
}

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

export function startServer(opts: ServeOpts): Server<undefined> {
  const { workspace, port, host } = opts;

  return Bun.serve({
    port,
    hostname: host,
    // The SSE snapshot/monitor streams are long-lived; Bun's default 10s idle
    // timeout would cut the stream before the 25s heartbeat. 255s is Bun's
    // max — the heartbeat keeps the SSE connection alive under it.
    idleTimeout: 255,
    async fetch(req) {
      const url = new URL(req.url);

      if (url.pathname === "/api/stream") {
        return snapshotStream(workspace);
      }

      if (url.pathname === "/api/monitor") {
        return monitorStream(workspace);
      }

      return handleRequest(req, { workspace, getHtml: getAppHtml });
    },
  });
}
