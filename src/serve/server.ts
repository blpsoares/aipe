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
import { buildServePayload, startPrMergeRefresher, startReleaseRefresher } from "./payload";
import { buildClient } from "./app/build-client";
import { authorize, requiresAuth, unauthorized } from "./auth";
import { handleRequest } from "./handler";
import { startMonitor } from "./monitor";

export interface ServeOpts {
  workspace: string;
  port: number;
  host: string;
  /** Required off loopback: the token every request must present. */
  token?: string;
  /** Deliberately serve an open console off loopback. Must be typed. */
  insecure?: boolean;
  /**
   * Called with the current count of live SSE clients whenever one connects or
   * disconnects, so the attached CLI can show a live "N clients connected" line.
   * Optional — the server behaves identically when it is absent.
   */
  onClients?: (count: number) => void;
}

/** A subscription hook: call to register a live SSE client; the returned fn releases it. */
type Track = () => () => void;

// Re-exported from ./auth, where the rest of the access control lives.
export { isLoopback } from "./auth";

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
  if (isCompiled()) {
    if (!PREBUILT) {
      throw new Error("client asset not embedded — build via scripts/build.ts");
    }
    return PREBUILT;
  }
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
function snapshotStream(workspace: string, track?: Track): Response {
  let watcher: ReturnType<typeof watch> | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let reconcile: ReturnType<typeof setInterval> | null = null;
  let debounce: ReturnType<typeof setTimeout> | null = null;
  let release: (() => void) | null = null;
  let lastKey = "";
  let closed = false;

  const stream = new ReadableStream({
    async start(controller) {
      release = track?.() ?? null;
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
        const snapshot = await buildServePayload(workspace);
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
      release?.();
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
function monitorStream(workspace: string, track?: Track): Response {
  let tail: ReturnType<typeof startMonitor> | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let release: (() => void) | null = null;
  let closed = false;

  const stream = new ReadableStream({
    start(controller) {
      release = track?.() ?? null;
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
      release?.();
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

  // The ONE PR-merge poller for this server (re-gate B2): it refreshes the merge
  // cache off the render path so buildServePayload never touches the network. Its
  // timer is unref'd, so it never keeps the process alive on its own.
  startPrMergeRefresher(workspace);

  // The ONE release-state poller for this server: it refreshes the publication
  // cache (merged ≠ published, src/release) off the render path via LOCAL git, so
  // buildServePayload never shells out per SSE frame. Unref'd, same as above.
  startReleaseRefresher(workspace);

  // Off loopback the console is reachable by anyone on the network, and it
  // serves the whole workspace (/api/snapshot) plus the code specialists are
  // writing, file contents included (/api/monitor). So off loopback, every
  // request carries a token. On 127.0.0.1 — the default — nothing changes.
  const guarded = requiresAuth(host, opts.insecure === true);
  const token = opts.token ?? "";

  // Live SSE-client accounting, shared by both streams, surfaced to the CLI so
  // the attached banner can show "N clients connected" as they come and go.
  let clients = 0;
  const track: Track = () => {
    clients += 1;
    opts.onClients?.(clients);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      clients -= 1;
      opts.onClients?.(clients);
    };
  };

  return Bun.serve({
    port,
    hostname: host,
    // The SSE snapshot/monitor streams are long-lived; Bun's default 10s idle
    // timeout would cut the stream before the 25s heartbeat. 255s is Bun's
    // max — the heartbeat keeps the SSE connection alive under it.
    idleTimeout: 255,
    async fetch(req) {
      const url = new URL(req.url);

      let setCookie: string | undefined;
      if (guarded) {
        // An empty token with auth on would accept `?token=`-less requests
        // against "" — refuse outright rather than serve wide open.
        if (token === "") return unauthorized();
        const decision = authorize(url, req.headers, token);
        if (!decision.ok) return unauthorized();
        setCookie = decision.setCookie;
      }

      // The checks run BEFORE the streams: an SSE response is committed the
      // moment it is returned, so authorising afterwards would be too late.
      if (url.pathname === "/api/stream") {
        return withCookie(snapshotStream(workspace, track), setCookie);
      }

      if (url.pathname === "/api/monitor") {
        return withCookie(monitorStream(workspace, track), setCookie);
      }

      return withCookie(await handleRequest(req, { workspace, getHtml: getAppHtml }), setCookie);
    },
  });
}

/** Promotes a one-time `?token=` into a session cookie, so the SPA's own
 *  fetches and SSE streams keep working without carrying the secret. */
function withCookie(res: Response, setCookie: string | undefined): Response {
  if (!setCookie) return res;
  const headers = new Headers(res.headers);
  headers.append("set-cookie", setCookie);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}
