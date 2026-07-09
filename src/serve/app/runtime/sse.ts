import { applySnapshot, conn, type RawSnapshot, type Dispatch } from "./store";

// ── SSE / snapshot network layer ────────────────────────────────────────────
// Ported from src/serve/app.html: connectSSE (1303-1316) and boot (1292-1301).

export type ConnStatus = "wait" | "live" | "down";

/**
 * GET api/snapshot (equivalent to boot's fetch, app.html:1295-1297).
 * Silent on any failure (non-ok response or thrown error) → null.
 */
export async function fetchInitialSnapshot(fetchImpl: typeof fetch = globalThis.fetch): Promise<unknown | null> {
  try {
    const r = await fetchImpl("api/snapshot", { cache: "no-store" });
    if (r.ok) return await r.json();
    return null;
  } catch (e) {
    return null;
  }
}

/**
 * Opens the SSE connection to api/stream (equivalent to connectSSE,
 * app.html:1303-1316). `ES` is the EventSource constructor, injectable for
 * testing (default `globalThis.EventSource`).
 *
 * - Listens for the NAMED `snapshot` event (not generic `message`).
 * - `onopen` → status "live".
 * - `onerror` marks status "down" only when `readyState===2` (CLOSED).
 */
export function connectSnapshotStream(
  onSnapshot: (s: unknown) => void,
  onStatus: (status: ConnStatus) => void,
  ES: typeof EventSource = globalThis.EventSource,
): EventSource {
  const es = new ES("api/stream");
  es.onopen = () => onStatus("live");
  es.addEventListener("snapshot", (m: any) => {
    if (!m.data) return;
    let s: unknown;
    try {
      s = JSON.parse(m.data);
    } catch (e) {
      return;
    }
    onSnapshot(s);
    onStatus("live");
  });
  es.onerror = () => {
    if (es.readyState === 2) onStatus("down");
  };
  return es;
}

/**
 * Orchestrates the initial snapshot fetch + apply + SSE connection, replacing
 * boot() (app.html:1292-1301). i18n/view routing/DOM concerns stay out of
 * this module (Task 6/19 wire those); `onDispatchesChanged` is a seam for the
 * notify wiring, receiving the `changed` list from each applySnapshot call.
 */
export function bootstrap(onDispatchesChanged?: (changed: Dispatch[]) => void): EventSource {
  conn.value = "wait";

  const apply = (raw: unknown) => {
    const changed = applySnapshot(raw as RawSnapshot, Date.now());
    onDispatchesChanged?.(changed);
  };

  fetchInitialSnapshot().then((raw) => {
    if (raw) apply(raw);
  });

  return connectSnapshotStream(apply, (status) => (conn.value = status));
}
